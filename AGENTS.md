# AGENTS.md

本文件适用于仓库根目录及全部子目录，是人类开发者和 Codex 在本项目中的长期协作约定。

最后更新：2026-08-23

## 1. 项目目标

融资工作台服务于资金运营与融资项目团队，统一管理存续负债、现金流、融资项目、SOP、人员、权限与提醒。

优先保证财务口径可追溯、数据结构精简、查询次数可控和桌面端信息密度。不要为了视觉效果牺牲数据可读性，也不要为了兼容旧导入结构在生产库保留冗余表或字段。

## 2. 技术栈与运行方式

- 包管理：pnpm
- 全栈框架：SvelteKit / Svelte 5
- UI：Tailwind CSS 4 + DaisyUI 5 + Lucide
- 生产数据库：Neon PostgreSQL，业务对象全部位于 `financing` schema
- 认证：Neon Managed Better Auth；`neon_auth` schema 由 Neon 管理，业务人员与角色仍以 `financing.people` 为准
- Worker 数据连接：Cloudflare Hyperdrive binding `HYPERDRIVE`，对应已配置的 `eastmoney`
- 本地维护：`pg` 直连 Neon；旧 SQLite 只作为一次性迁移来源，Excel 只允许在 `scripts/` 本地解析
- 邮件：Resend
- 部署：`@sveltejs/adapter-cloudflare`
- 统一访问前缀：`/financing`

常用命令：

```bash
pnpm install
pnpm db:import -- --dry-run
pnpm db:migrate:sqlite -- --dry-run
pnpm reminders:send -- --dry-run
pnpm test
pnpm check
pnpm cf:typegen
pnpm dev
```

远程仓库为 `fin-research/financing-ops`，`main` 已接入 Cloudflare Git 自动构建与部署。数据库不兼容变更必须先迁移 Neon，再推送 Worker。正常交付只提交并推送 `main`；除非用户明确要求排障或紧急回滚，不手动运行 `pnpm build`、`pnpm run deploy` 或 `wrangler deploy`。

Cloudflare Git 当前使用 pnpm 10.11.1；`pnpm-workspace.yaml` 必须显式包含根包 `packages: ['.']`，不得改用该版本不支持的依赖构建配置。

## 3. 开始和结束每次会话

### 开始前

1. 完整阅读本文件和 `DESIGN.md`。
2. 查看工作区现状；已有改动默认属于用户，不要覆盖或回退。
3. 涉及数据库时先确认目标 Neon project、branch、database 和迁移前快照；涉及 Excel 时先核对来源、日期、单位和汇总口径。
4. 查看 TODO，确认任务依赖与验收标准。

### 工作中

- 数据库结构、运行命令、查询口径或 UI 规范变化时，同步更新 `README.md`、本文件和必要的设计说明。
- 发现真实缺口时加入 TODO；不要把猜测写成已确认问题。
- 完成 TODO 后从列表删除，并写入 `.workbuddy/memory/` 会话记录。
- 对财务数据区分“数据错误”“来源缺失”和“口径不明确”，不得编造数值。

### 交付前

1. 至少运行 `pnpm test`、`pnpm check` 和 `git diff --check`。
2. DDL 变化必须在 PostgreSQL 兼容环境实际执行，并核对继承、计算列、触发器、视图和约束。
3. 本地 Excel 映射变化运行 `pnpm db:import -- --dry-run`；SQLite 迁移变化运行 `pnpm db:migrate:sqlite -- --dry-run`。
4. 提醒变化至少运行测试；只有配置了直连 `DATABASE_URL` 且明确允许写生产记录时才执行线上 `pnpm reminders:send -- --dry-run`。
5. 更新 TODO 和 `.workbuddy/memory/`；UI 变化同步更新 `DESIGN.md`。
6. 生产 schema 与数据核对通过后才提交、推送 `main`，再核对 Cloudflare 自动构建状态。

## 4. 目录与职责

- `migrations/`：Neon PostgreSQL DDL；不放 D1/SQLite migration。
- `src/lib/postgres.js`：纯 PostgreSQL request-scoped client 与参数化查询适配，供 Worker 和本地提醒脚本复用。
- `src/lib/server/db.js`：从当前 SvelteKit request 取得 Hyperdrive connection string，并在 request locals 复用一个连接。
- `src/lib/debt-types.js`：负债大类/小类及展示标签的唯一代码配置；禁止在数据库重建 `debt_type_catalog`。
- `src/lib/server/queries.js`：Dashboard、甘特图、额度、日历和管理页集合查询。
- `src/lib/server/reminders.js`：提醒候选集合查询、Resend 发送和批量发送日志。
- `src/routes/debts/[id]/`：负债通用字段、品种专属字段和统一现金流联查。
- `src/routes/data/`：基于 TanStack Table + Neon Data API 的负债分品种行内维护；收益凭证使用单一表格标签，不按浮动/固定拆分；禁止出现 Excel 上传、解析、预检或导入 API。
- `src/lib/data-admin.ts`：数据后台表、字段、编辑器、主键和写入目标的唯一白名单配置。
- `src/lib/neon-data-api.ts`：浏览器端 Neon Data API 请求、分页、搜索、乐观并发与 CRUD 适配。
- `scripts/init-database.mjs`：本地直连 Neon 应用 DDL并初始化财务参数；不得创建本地密码账号。
- `scripts/migrate-sqlite-to-postgres.mjs`：一次性将旧 SQLite 结构转换并迁入 Neon。
- `scripts/import-debts.mjs`、`scripts/lib/`：本地 Excel 解析、映射、核对与不定期维护；不得被 `src/` 引用。
- `scripts/send-reminders.mjs`：本地直连 Neon 运行提醒任务。
- `data/`：原始 Excel；不得静默改写。
- `database/`：只读旧 SQLite 迁移来源，不是应用运行时数据库。
- `DESIGN.md`：人工维护的 UI 规范。

## 5. PostgreSQL 数据硬约束

### 负债结构

- `financing.debt` 是负债基类，主键 `id bigint` 来自 `financing.debt_id_seq`。
- 通用字段只保留 `debt_type`、`subtype`、`name`、`counterparty`、`amount`、`interest_payable`、`annual_rate`、生命周期日期和审计时间；负债禁止保存项目外键。
- 禁止重新引入 `external_key`、`category_level_1`、`category_level_2`、`instrument_name`、`instrument_code`、Debt `borrower`、Debt `currency`、`principal_amount`、`outstanding_amount`、可写 `status` 或 import 字段。
- `total_amount = amount + interest_payable`、`term_days`、`status` 必须由 stored generated columns 计算。
- `bond`、`income_certificate`、`income_right`、`refinancing`、`swap_facility` 使用 PostgreSQL 原生 `INHERITS`；子表只保存该品种特有字段。
- 同业拆借和集团借款没有有效专属字段，直接存于基表；不得重建只有对手方、期限、金额、利率或状态的冗余子表。
- PostgreSQL 主键、唯一约束和外键不会自动覆盖继承子表；跨层级 ID 唯一、现金流引用和删除级联必须由触发器与事务级 advisory lock 保证，并有测试。
- 融资项目与负债相互独立：项目自行维护名称、融资品种、规模和单一“计划簿记”日期；该日期写入 `planned_issue_date` 并作为 SOP“计划发行当日”的相对日期锚点。创建、修改或删除项目均不得读取、绑定或修改现有负债。删除项目时同步删除项目节点及其提醒记录。

### 现金流与余额

- 债券、集团借款、收益权等所有 schedule 统一为 `financing.cashflow`。
- `cashflow` 以 `(debt_id, sequence)` 为联合主键；禁止 event key 或独立代理主键。
- 现金流种类只描述本金、利息、费用或补充流，不建立品种专属 schedule 表。
- 历史余额统一存入 `balance_snapshot(as_of_date, debt_type, subtype)`，金额使用元。
- 常用只读口径优先通过 `debt_overview`、`cashflow_overview`、`data_overview` 或明确的集合查询实现。

### 生产数据与本地 Excel

- 负债在线上 Neon 维护；线上 Worker、route、API 和生产表中不得存在 Excel 解析/上传/导入逻辑或 import 状态/暂存表。
- Excel 只允许由 `scripts/` 本地解析；脚本使用直连 `DATABASE_URL`，不能通过 Worker/Hyperdrive 执行。
- 本地维护使用单一事务、advisory lock、临时表和 `jsonb_to_recordset` 批量写入；不得建立永久导入表，也不得删除在线新增数据。
- 具体业务数据仅保留在未提交的本地验证环境。
- 具体业务数据仅保留在未提交的本地验证环境。
- 任何映射变化必须核对负债数、现金流数、历史日期、基准日总额、跨继承 ID 重复和引用孤儿。

## 6. Hyperdrive 与服务端约定

- Worker 只从 `event.platform.env.HYPERDRIVE.connectionString` 连接数据库；`DATABASE_URL` 只放在 gitignored 的 `.env.database` 供本地脚本使用，禁止写入 `.env` 或 Worker variables。
- 每个请求只创建一个 `pg.Client`，保存在 `event.locals.database`，请求结束必须关闭；禁止全局 client、`Pool` 或跨请求可变连接状态。
- `wrangler.jsonc` 保持 Smart Placement 与 `nodejs_compat`。
- 所有 SQL 参数化；列表、聚合和批量写入优先使用 CTE、窗口函数、`FILTER`、JSON 聚合、`jsonb_to_recordset` 和 `ON CONFLICT`。
- 禁止 N+1 查询。Dashboard、甘特图、额度、提醒和详情查询增加功能时，必须说明请求级 SQL 次数是否变化。
- Dashboard 当前业务数据为 3 次 SQL；根布局的数据日期与提醒为 1 次 SQL。
- 账号、密码和会话只由 Neon Auth 管理；`financing` schema 禁止自建用户、密码哈希或会话表。
- Worker 的应用 Cookie 只保存不透明 Neon 会话 token，并限制到 `/financing`；静态资源不得调用 Auth 或 Hyperdrive。
- 数据后台从 Neon Auth `Set-Auth-Jwt` 响应头取得 15 分钟 JWT；`/data/token` 取令牌时必须绕过会话 Cookie 缓存，避免首屏缺少该响应头。浏览器不得取得长期会话 token。Data API 只暴露 `financing` schema，三种现有业务角色仅对负债、监管参数和负债额度获得编辑权限。
- 数据后台不展示现金流、历史余额和审计记录，`authenticated` 不得通过 Data API 读取或写入这三张表。
- Data API 可编辑表必须进入 `src/lib/data-admin.ts` 白名单并配置 PostgreSQL RLS、显式 GRANT 和 Data API 写审计触发器；禁止从 URL 接受任意 schema/table 名称。
- 登录邮箱由管理员在人员与权限页维护，业务授权由 `people.neon_auth_user_id` 映射及 `people.role` 决定；不得重新引入 username。
- 密钥只从环境变量/绑定读取；不得写入仓库、数据库或日志。
- Resend 未配置时只生成 `pending` 记录；不得假装发送成功。提醒以 `(rule_id, target_id, delivery_date)` 去重。

## 7. 前端与交互硬约束

完整规范见 `DESIGN.md`。摘要：

- 普通文字 `1rem`，可见小字不小于 `0.75rem`，禁止新增字号 `px`。
- 布局、间距、尺寸和断点优先用相对单位、Grid 和 Flex；`px` 只用于细边框等必要场景。
- 桌面端保持高信息密度，移动端不得页面级横向滚动。
- 使用 Lucide，不用 emoji 充当结构图标。
- 交互具备键盘焦点、可访问名称和适度反馈，并支持 `prefers-reduced-motion`。
- 页面标题或模块标题下不写没有新增业务信息的说明性小字。
- 项目进度页支持项目修改和删除；新建项目独立填写名称、规模、负责人和单一“计划簿记”日期，并选择启用中的 SOP。成功后项目必须立即出现在当前列表中。
- 甘特图时间范围必须由上海时区当天、现有项目计划日期和节点日期动态生成；月/季刻度、项目条、节点条和“今天”线使用同一时间轴，禁止硬编码年月或位置。
- 修改型增强表单禁止使用会重置控件的裸 `update()`；提交期间保持当前输入，成功响应必须携带服务端确认的最新实体或完整视图快照，前端在 `invalidateAll` 前后都就地合并该响应，失败时保留用户输入并就地提示。`invalidateAll` 只负责同步顶栏、提醒等次级全局数据，不得作为当前页面即时更新的唯一数据源。
- 项目与 SOP 已有对象的普通字段编辑使用防抖、串行自动保存，并以 `aria-live="polite"` 静默提示“已保存”；创建、删除、启停、密码和账号权限等显式动作不套用该规则。数据后台继续保留逐行保存。
- SOP 节点通过左侧手柄直接拖拽排序，不使用上下移动按钮；鼠标、触控和键盘排序共用同一原子服务端动作。新增节点只通过页面右下角固定加号打开模态框。

## 8. 代码风格与变更纪律

- 优先小而明确的函数；数据库逻辑不堆积在 Svelte 组件。
- 运行时服务端模块保留在 `$lib/server`；本地维护逻辑只在 `scripts/`。
- 重复映射和状态翻译抽成共享函数或代码配置。
- 不做无关重构，不覆盖用户已有修改。
- 页面真实数值必须可追溯到数据库；不填演示数据冒充生产数据。
- 新命令、环境变量、数据口径或页面同步更新文档。

## 9. 验收门槛

- `pnpm test`：全部通过。
- `pnpm check`：0 error、0 warning。
- `git diff --check`：通过。
- DDL 在 PostgreSQL 兼容环境执行通过，并覆盖原生继承、计算列、序列、视图和触发器测试。
- 生产迁移后负债、现金流、余额、工作流数量与来源一致；孤儿引用、重复 ID、计算列异常、生产 import 表均为 0。
- 核心路由 `/financing/`、`/financing/debts/[id]`、`/financing/projects`、`/financing/sop`、`/financing/settings`、`/financing/data`、`/financing/people` 保持可访问。
- Cloudflare 自动构建成功后才视为发布完成。

## 10. 当前 TODO

### P1 — 质量保障

- [ ] 增加本地 Excel 字段映射、余额断言、提醒频率和项目建档的单元测试。
- [ ] 增加核心路由与关键表单的端到端测试。
- [ ] 补充大字号/200% 缩放模式视觉回归。
- [ ] 复核字号放大后的 Dashboard、甘特图和设置页信息密度。

### P2 — 查询与下钻

- [ ] 将筛选状态同步到 URL，支持刷新、返回和分享后保持。
- [ ] 增加负债明细表、排序、导出及图表下钻。

### P2 — 发行试算

- [ ] 建立可按期间维护的财务指标表，接入 LCR、NSFR、资产负债率和长短期负债比试算。
- [ ] 将拟发行品种、起息日、规模和期限纳入到期当月集中度预估。

### P2 — 样式维护

- [ ] 将组件重复颜色迁移到语义化 CSS token。
