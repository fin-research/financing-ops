# 融资工作台

面向资金运营与融资项目团队的 SvelteKit 工作台。生产数据存放在 Neon PostgreSQL 的 `financing` schema，Cloudflare Worker 通过已配置的 Hyperdrive `eastmoney` 连接；线上应用不解析、不上传 Excel。

协作与设计约束见 [`AGENTS.md`](./AGENTS.md) 和 [`DESIGN.md`](./DESIGN.md)。统一访问前缀是 `/financing`。

## 数据结构

负债结构以精简后的 `financing.debt` 为基类：

- 主表只保存 `debt_type`、`subtype`、`name`、`counterparty`、`amount`、`interest_payable`、`annual_rate`、关键日期等通用字段。
- `total_amount`、`term_days`、`status` 是 PostgreSQL stored generated columns。
- `bond`、`income_certificate`、`income_right`、`refinancing`、`swap_facility` 使用 PostgreSQL 原生表继承，只保存品种专属字段；同业拆借与集团借款没有有效专属字段，直接使用基表。
- 所有还本、付息、费用及补充现金流统一进入 `cashflow`，以 `(debt_id, sequence)` 为联合主键。
- PostgreSQL 外键不会自动覆盖继承子表，因此负债 ID 全局唯一、现金流引用和删除级联由事务级 advisory lock 与触发器保证。
- 融资项目独立于负债建档；项目自行维护名称、融资品种、规模和单一“计划簿记”日期，并按所选启用 SOP 生成项目节点。计划簿记写入项目计划发行日，并与 SOP 的“计划发行当日”使用同一日期锚点；项目创建、修改和删除均不读取或修改现有负债。
- 历史余额统一存放在 `balance_snapshot`；`debt_overview`、`cashflow_overview`、`data_overview` 提供常用口径。
- 负债品种目录是 [`src/lib/debt-types.js`](./src/lib/debt-types.js) 中的代码配置，不在数据库建立目录表。浮动与固定收益凭证共用 `income_certificate` 表，仅以 `subtype` 保留仪表盘筛选维度。
- 数据库没有 Excel 文件、导入状态、暂存、原始 JSON、原始行或原始单元格表。

完整 DDL 位于 [`migrations/0001_financing_postgres.sql`](./migrations/0001_financing_postgres.sql)。

## 数据后台与 Data API

`/financing/data` 使用 TanStack Table 通过 Neon Data API 按负债品种维护 `financing` schema 中的负债，并维护监管参数和负债额度。收益凭证只显示一个表格标签，同表维护浮动/固定 subtype。

- Data API 只暴露 `financing` schema，数据库角色为 `authenticated`。
- 每次请求使用 Neon Managed Better Auth 签发的 15 分钟 JWT；长期会话 token 继续保存在应用的 HttpOnly Cookie 中，不提供给浏览器脚本。
- `admin`、`handler`、`reviewer` 三种角色只要人员主档处于启用状态且已关联 Neon Auth 用户，即可通过 RLS 增删改查负债、监管参数和负债额度。
- 负债默认按起息日倒序；单元格原地编辑和新增一行保存后只更新浏览器中的当前行，不重新读取整张表。
- 只有数据后台的短期 JWT 接口会强制绕过 Neon Auth 会话 Cookie 缓存，确保首屏必定取得 `Set-Auth-Jwt`；其他受保护页面继续使用会话缓存。
- 计算列和主键保持只读；更新和删除同时携带 `updated_at`，避免覆盖其他人的并发修改。
- 现金流、历史余额和审计记录不在数据后台展示，`authenticated` 无这三张表的 Data API 权限。
- Data API 写入由 PostgreSQL 触发器记录操作人、实体、动作以及变更前后值；非 Data API 的本地 Excel 维护不生成逐行在线审计记录。
- Data API 配置必须把 exposed schemas 设置为 `financing`。DDL 或列变化后执行 `neon data-api refresh-schema --database neondb` 刷新 schema cache。

## Worker 与查询约束

- 每个请求最多创建一个 `pg.Client`，复用该连接完成页面查询和事务，请求结束后关闭；不在 Worker 全局创建连接池。
- Worker 只读取 `HYPERDRIVE.connectionString`，不接收 `DATABASE_URL`。
- Dashboard 主数据、额度和日历共 3 次集合查询；根布局把数据日期与顶栏提醒合并为 1 次查询。
- 甘特图、额度和提醒均使用 CTE、窗口函数、JSON 聚合或批量 upsert，禁止按项目、规则或负债执行 N+1 查询。
- 账号、密码和会话由 Neon Managed Better Auth 托管；Worker 只保存作用域为 `/financing` 的不透明会话 Cookie，并从 Auth 会话响应取得短期 Data API JWT。
- 每个受保护请求调用一次 Neon Auth 会话接口，并用一次 Hyperdrive 查询完成 `people.neon_auth_user_id` 与业务角色映射；静态资源不触发认证或数据库查询。
- `wrangler.jsonc` 启用 Smart Placement，并绑定 Hyperdrive ID `26b76413a03a4328836d95f3ca320a1e`。

## 项目管理

- `/financing/projects` 可新建、修改和删除独立项目。新建时选择启用中的 SOP，并自行填写项目名称、规模、负责人和计划簿记日期。
- 计划簿记是唯一项目计划日期，并作为 SOP 相对日期的发行当日锚点；项目起始日由最早 SOP 节点日期自动推导。
- 项目删除在单一事务内锁定并核对目标，同步删除项目任务及其提醒记录；重复删除按幂等成功处理。项目页加载仍保持 3 次请求级集合 SQL，不增加 N+1 查询；创建和修改成功响应会额外执行 1 次集合查询并直接回传最新项目列表，避免等待重复刷新。
- 项目甘特图时间范围由上海时区当天、项目计划日期和节点日期共同确定，自动按完整月份扩展；月/季刻度、项目条、节点条和“今天”线使用同一百分比时间轴，不含固定年月。
- SOP 节点、SOP 模板信息、项目任务和项目基本信息在修改后防抖串行自动保存，并静默提示“已保存”；服务端响应只在仍为最新修改时就地合并，失败不清空输入。SOP 节点通过左侧手柄拖拽排序，右下角固定加号打开新增节点模态框。
- 人员、SOP 总览和个人资料的新增或修改成功响应同样直接回传服务端确认后的视图数据，前端立即合并并保留表单状态；随后触发的全局失效只用于同步顶栏和提醒等次级数据，不再要求用户刷新页面。

## 初始化与迁移

本地脚本必须使用 Neon 的直连 `DATABASE_URL`，不能经过 Worker 或 Hyperdrive。

从现有 SQLite 迁移：

```bash
pnpm install
pnpm db:init -- --schema-only
pnpm db:migrate:sqlite -- --dry-run
pnpm db:migrate:sqlite
```

迁移脚本在一个 PostgreSQL 事务内迁移人员、权限、SOP、项目、提醒、审计、监管参数和负债数据；目标 `financing.debt` 非空时会拒绝执行，避免重复覆盖。

`pnpm db:init` 只应用 DDL 和初始化财务参数。登录账号应在 Neon Auth 中创建，再由“人员与权限”页关联到人员主档；数据库不保存密码哈希或自建会话。

## Excel 本地维护

Excel 解析仅存在于 `scripts/`，用于不定期维护线上数据：

```bash
pnpm db:import -- --dry-run
pnpm db:import -- data/ledger.xlsx
```

脚本先在本地完成字段映射与余额核对，再在单一 PostgreSQL 事务内批量更新/新增负债、统一现金流与余额快照。它不创建永久导入表，不保存文件或导入元数据，也不删除在线维护的数据。

当前回归基准：

- 具体业务数据仅保留在未提交的本地验证环境。
- 具体业务数据仅保留在未提交的本地验证环境。
- 具体业务数据仅保留在未提交的本地验证环境。
- 具体业务数据仅保留在未提交的本地验证环境。
- 具体业务数据仅保留在未提交的本地验证环境。

## 环境变量

复制 `.env.example` 保存 Neon Auth URL 与邮件配置；Data API URL 默认由 Auth URL 推导，也可用 `NEON_DATA_API_URL` 显式覆盖。另复制 `.env.database.example` 为 `.env.database`，只供本地数据库维护脚本使用。这样 Wrangler 不会把 Neon 直连地址识别为 Worker variable。

```dotenv
# .env
RESEND_API_KEY=
FROM_EMAIL=融资工作台 <financing@example.com>
NEON_AUTH_URL=https://example.neonauth.region.aws.neon.tech/neondb/auth
NEON_DATA_API_URL=https://example.apirest.region.aws.neon.tech/neondb/rest/v1

# .env.database
DATABASE_URL=postgresql://user:password@host/database?sslmode=verify-full
```

不要提交 `.env`。生产数据库地址只来自 Hyperdrive binding；`NEON_AUTH_URL` 是非密钥配置，并固定写入 Wrangler variables。

## 常用命令

```bash
pnpm db:import -- --dry-run
pnpm db:migrate:sqlite -- --dry-run
pnpm reminders:send -- --dry-run
pnpm reminders:send -- --dry-run
pnpm test
pnpm check
pnpm cf:typegen
```

提醒脚本也直接连接 Neon；提醒候选、既有发送记录和最终写入分别使用一次集合查询/批量写入。同一 `(rule_id, target_id, delivery_date)` 不会重复发送。

## 发布

远程仓库是 `fin-research/financing-ops`。`main` 已接入 Cloudflare Git 自动构建与部署；先完成 Neon schema 与数据迁移，再推送不兼容 D1 的 Worker 代码。日常不在本地运行 `pnpm build`、`pnpm run deploy` 或 `wrangler deploy`。
