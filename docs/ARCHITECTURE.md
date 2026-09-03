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

Admin workbook upload → Worker direct parse → Neon temporary JSON
                                      └→ Cloudflare Workflow → Hyperdrive → Neon financing
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
- `src/routes/data/import/+server.ts` 在管理员上传请求内直接读取并解析借入资金汇总表，不保存原始 Excel；`src/lib/server/debt-import-runs.js` 管理单活任务、临时结构化载荷和进度。
- `src/workflows/debt-import.ts` 分步骤执行台账原子写入、`monthly_financing_metrics` 重算、结果审计和临时载荷清理；每个 Workflow step 各自创建并关闭一个 Hyperdrive PostgreSQL 连接。
- `src/lib/server/debt-importer.js` 是本地导入命令与线上 Workflow 共用的 PostgreSQL 写入实现，保留线上独有数据并按稳定业务身份更新工作簿可变字段。
- `src/lib/liability-choice.js` 封装浏览器端负债周报外部数据请求和服务端入库前校验；用户点击生成后，浏览器请求公开 `/data/choice/ctr` 与 `/data/broker-bond-registrations`，后者按报告日所在周周一至报告日分页取数，financing 服务端不代理上游请求。
- `src/lib/neon-data-api.ts` 在生成时通过同一短期 JWT 并行调用 `financing.liability_weekly_report_data(date)` 业务聚合 RPC 与 `financing.liability_market_rate_observations` 原始市场观测视图；`src/lib/liability-report-data.js` 在浏览器配对计算信用利差，并在服务端保存前再次校验日期、字段、数量和数值边界。
- `src/lib/server/liability-weekly-reports.js` 只负责负债周报来源状态、按报告日读取快照索引，以及校验后保存 R2 快照；Choice 或 DM 失败时对应模块留空并返回缺失项，不回退安装包导入表。
- `src/lib/server/auth.js` 与 `neon-auth-client.js` 封装 Neon Auth；业务页面不直接拼 Auth 请求。

## 数据路径

### 页面读写

浏览器导航 → SvelteKit `__data.json` → route load → request-scoped PostgreSQL client。全局链接只在按下时预取；固定主导航允许 hover/focus 预取并复用同一次导航请求，列表、提醒和详情链接仍保持 tap，避免查询放大。`/settings` 复用根布局身份，`/data` 在组件内按需加载 token 与 Data API URL，两者不增加 page server load。

### 数据后台

浏览器请求 `/data/token` → Neon Auth 返回短期 JWT，Worker 同响应提供 HTTPS Data API URL → `src/lib/neon-data-api.ts` 访问 Data API → PostgreSQL RLS 与触发器授权、审计。响应使用 `private, no-store`；长期会话 token 不进入浏览器脚本。

### 本地维护

Excel / SQLite / 手工提醒脚本 → gitignored `.env.database` 直连 Neon；自动提醒由 Worker Cron → Hyperdrive → Neon。除无 Node 专属依赖的 `scripts/lib/` 台账纯解析函数外，`scripts/` 不得被运行时 `src/` 引用，Worker 也不得暴露本地脚本能力。

### 在线借入资金汇总表导入

管理员浏览器以原始请求体上传 `.xlsx` → Worker 校验同源、文件名、10 MB 上限和 ZIP 签名 → 请求内复用 `scripts/lib/` 纯函数直接解析并转换 → 结构化 JSON 临时写入 `debt_import_payloads` → 创建 `financing-debt-import` Workflow。原始文件不写 R2、Neon 或日志。

Workflow 先在一个事务内更新继承负债表、现金流和余额历史，再单独取得同一 advisory lock，清空并按最新权威台账重建 `monthly_financing_metrics`。完成或失败都会删除临时 JSON；`debt_import_runs` 保留阶段、核对结果和安全错误供前端查询。数据库部分成功但衍生刷新最终失败时任务明确标为失败，重复上传同一台账按幂等更新恢复。

## 查询约束

- 每个请求最多一个连接，所有查询参数化。
- 禁止按项目、规则、人员或负债执行 N+1。
- Dashboard 主数据、额度和日历当前为 3 次集合查询；根布局数据日期与提醒为 1 次。
- 项目列表首屏 1 次集合查询；人员与启用 SOP 在弹窗打开时通过 `/projects/options` 1 次按需加载。
- 提醒历史使用三字段 keyset 游标，每批最多 50 条，加载更多不重复全量汇总。
- 负债周报首屏只按所选报告日查询一行 `liability_weekly_report_runs`；存在成功索引时读取对应 R2 对象，不存在时返回空状态。页面 load、刷新、日期切换和 Cron 均不得读取报表明细、Neon Data API、Choice 或 DM。
- 数据后台仍无独立 page server load。仅管理员挂载导入面板时增加一次导入记录请求；每次列表或单任务进度请求执行 1 条 SQL，约 1.5 秒轮询只在任务活跃时运行并在终态停止。
- 只有用户点击“生成本期周报”后，浏览器才并行执行四条数据请求：一次 Choice CTR 年初至报告日逻辑请求、报告日所在周周一至报告日的 DM 分页请求、一次 Neon Data API 业务聚合 RPC、一次 Neon Data API 原始市场观测读取。业务集合与 JSON 聚合在 PostgreSQL 内完成；2021 年以来已结束月份直接读取 `monthly_financing_metrics`，函数只惰性补齐尚未固化的月末，当前报告月份实时计算。市场请求只扫描白名单 `public.edb` 原始行，信用利差在浏览器计算。`saveSnapshot` action 只做边界校验、内容哈希、R2 写入和一行索引/审计事务。快照写入 `eastmoney/liability-report/yyyy-mm-dd.json` 固定 key；同一日重新生成覆盖同一对象和索引行。`public.edb` 的增量写入由 dashboard 每日定时 Workflow 统一负责。

增加查询时必须说明请求级 SQL 次数是否变化，并更新网络效率测试。

## 新功能放置

- 纯 UI 状态 → 页面或可复用组件。
- 跨页面业务派生 → `src/lib/` 纯函数。
- 数据库、Auth、邮件、审计 → `src/lib/server/`。
- 本地批处理、其他 Excel、一次性迁移 → `scripts/`；借入资金汇总表纯解析函数保留在 `scripts/lib/` 供本地命令与线上入口复用。
- 在线借入资金汇总表状态与写入 → `src/lib/server/`；长任务编排 → `src/workflows/`。
- Schema、RLS、触发器、视图 → `migrations/`。
