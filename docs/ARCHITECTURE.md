# 系统架构

## 分层

```text
Svelte pages / components
        │
        ├→ SvelteKit load / actions / internal routes
        │               │
        │               ├→ $lib/server/auth → Neon Auth
        │               └→ $lib/server/queries → request-scoped pg.Client
        │                                      └→ Hyperdrive → Neon financing
        │
        └→ Neon Data API client → short-lived JWT → RLS → editable tables

Local scripts → direct DATABASE_URL → Neon financing
```

## 页面层

- `src/routes/+layout.server.ts` 提供全局身份、数据日期和顶栏提醒。
- 页面 `load` 负责当前路由所需的集合查询；页面 actions 负责校验和事务调用。
- 管理页面只接收变更实体增量并在浏览器就地合并，不在成功后重读整页。
- `src/lib/auto-save.ts` 管理防抖、串行和新旧响应顺序；不要在单页复制状态机。
- `src/lib/project-timeline.js` 负责公共甘特时间轴，项目页和详情页不得各自计算。

## 服务端层

- `src/hooks.server.ts` 统一处理会话、角色写入边界、Server-Timing 和数据库关闭。
- `src/lib/server/db.js` 从当前 request 的 Hyperdrive binding 获取并复用一个连接。
- `src/lib/server/queries.js` 承载 Dashboard、项目、SOP、日历、额度和人员的集合查询。
- `src/lib/server/reminders.js` 承载提醒候选、Resend 调用和发送日志。
- `src/worker.ts` 在 SvelteKit fetch 入口外增加每小时 Cron；`src/lib/server/reminder-scheduler.js` 为每次调度创建并关闭一个 Hyperdrive 连接。
- `src/lib/server/project-deletion.js` 负责项目、任务和提醒的原子删除。
- `src/lib/liability-choice.js` 封装浏览器端负债周报 Choice CTR 请求和服务端入库前校验；用户点击生成后，浏览器直接请求公开 `/data/choice/ctr`，financing 服务端不代理 Choice 请求。
- `src/lib/server/liability-weekly-reports.js` 负责负债周报数据来源状态、历史快照索引和快照保存；保存 action 接收浏览器已取得的 CTR 数据并校验，把缺失项返回给全局系统消息，利率走势由集合查询只读统一 `public.edb`。
- `src/lib/server/auth.js` 与 `neon-auth-client.js` 封装 Neon Auth；业务页面不直接拼 Auth 请求。

## 数据路径

### 页面读写

浏览器导航 → SvelteKit `__data.json` → route load → request-scoped PostgreSQL client。全局链接只在按下时预取；固定主导航允许 hover/focus 预取并复用同一次导航请求，列表、提醒和详情链接仍保持 tap，避免查询放大。`/settings` 复用根布局身份，`/data` 在组件内按需加载 token 与 Data API URL，两者不增加 page server load。

### 数据后台

浏览器请求 `/data/token` → Neon Auth 返回短期 JWT，Worker 同响应提供 HTTPS Data API URL → `src/lib/neon-data-api.ts` 访问 Data API → PostgreSQL RLS 与触发器授权、审计。响应使用 `private, no-store`；长期会话 token 不进入浏览器脚本。

### 本地维护

Excel / SQLite / 手工提醒脚本 → gitignored `.env.database` 直连 Neon；自动提醒由 Worker Cron → Hyperdrive → Neon。`scripts/` 不得被运行时 `src/` 引用，Worker 也不得暴露这些脚本能力。

## 查询约束

- 每个请求最多一个连接，所有查询参数化。
- 禁止按项目、规则、人员或负债执行 N+1。
- Dashboard 主数据、额度和日历当前为 3 次集合查询；根布局数据日期与提醒为 1 次。
- 项目列表首屏 1 次集合查询；人员与启用 SOP 在弹窗打开时通过 `/projects/options` 1 次按需加载。
- 提醒历史使用三字段 keyset 游标，每批最多 50 条，加载更多不重复全量汇总。
- 负债周报首屏使用 1 次负债/快照/现金流/项目集合查询和 1 次额度集合查询；查询同时返回快照与明细勾稽状态，前端不自行重算业务口径。
- 负债周报生成不是页面 load 或 Cron 的副作用：页面从 `public.edb` 读取利率序列；只有用户点击“生成本期周报”后，浏览器才直接读取一次 Choice CTR，再把返回数据提交给 `saveSnapshot` action。该 action 不请求 Choice，只重新读取可信数据库数据、校验 CTR 并保存完整报告 JSON。快照写入现有 `eastmoney` R2 桶的 `liability-report/yyyy-mm-dd.json` 固定 key；同一日重新生成会覆盖该对象和对应索引行，Neon `liability_weekly_report_runs` 保存基准日、来源清单、缺失模块和内容哈希；页眉历史日期选择框只读 R2 快照。`public.edb` 的增量写入由 dashboard 每日定时 Workflow 统一负责，financing Worker 不建立第二套 EDB 调度。

增加查询时必须说明请求级 SQL 次数是否变化，并更新网络效率测试。

## 新功能放置

- 纯 UI 状态 → 页面或可复用组件。
- 跨页面业务派生 → `src/lib/` 纯函数。
- 数据库、Auth、邮件、审计 → `src/lib/server/`。
- 本地批处理、Excel、一次性迁移 → `scripts/`。
- Schema、RLS、触发器、视图 → `migrations/`。
