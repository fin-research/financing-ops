# 融资工作台

面向资金运营与融资项目团队的 SvelteKit 工作台。生产数据存放在 Neon PostgreSQL 的 `financing` schema，Cloudflare Worker 通过已配置的 Hyperdrive `eastmoney` 连接；线上应用不解析、不上传 Excel。

协作与设计约束见 [`AGENTS.md`](./AGENTS.md) 和 [`DESIGN.md`](./DESIGN.md)。统一访问前缀是 `/financing`。

## 数据结构

负债结构以精简后的 `financing.debt` 为基类：

- 主表只保存 `debt_type`、`subtype`、`name`、`counterparty`、`amount`、`interest_payable`、`annual_rate`、关键日期等通用字段。
- `total_amount`、`term_days`、`status` 是 PostgreSQL stored generated columns。
- `bond`、`income_certificate`、`income_right`、`refinancing`、`swap_facility` 使用 PostgreSQL 原生表继承，只保存品种专属字段；同业拆借与集团借款没有有效专属字段，直接使用基表。
- 所有还本、付息、费用及补充现金流统一进入 `cashflow`，以 `(debt_id, sequence)` 为联合主键。
- PostgreSQL 外键不会自动覆盖继承子表，因此负债 ID 全局唯一、项目引用、现金流引用和删除级联由事务级 advisory lock 与触发器保证。
- 历史余额统一存放在 `balance_snapshot`；`debt_overview`、`cashflow_overview`、`data_overview` 提供常用口径。
- 负债品种目录是 [`src/lib/debt-types.js`](./src/lib/debt-types.js) 中的代码配置，不在数据库建立目录表。
- 数据库没有 Excel 文件、导入状态、暂存、原始 JSON、原始行或原始单元格表。

完整 DDL 位于 [`migrations/0001_financing_postgres.sql`](./migrations/0001_financing_postgres.sql)。

## Worker 与查询约束

- 每个请求最多创建一个 `pg.Client`，复用该连接完成页面查询和事务，请求结束后关闭；不在 Worker 全局创建连接池。
- Worker 只读取 `HYPERDRIVE.connectionString`，不接收 `DATABASE_URL`。
- Dashboard 主数据、额度和日历共 3 次集合查询；根布局把数据日期与顶栏提醒合并为 1 次查询。
- 甘特图、额度和提醒均使用 CTE、窗口函数、JSON 聚合或批量 upsert，禁止按项目、规则或负债执行 N+1 查询。
- 登录和会话查询包含 PostgreSQL volatile expression，避免 Hyperdrive 读缓存返回已经失效的认证状态。
- `wrangler.jsonc` 启用 Smart Placement，并绑定 Hyperdrive ID `26b76413a03a4328836d95f3ca320a1e`。

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

全新空库初始化管理员：

```bash
pnpm db:init
```

需要 `ADMIN_EMAIL`、`ADMIN_PASSWORD`，可选 `ADMIN_NAME`。登录邮箱忽略大小写唯一，连续失败 5 次锁定 15 分钟。

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

复制 `.env.example` 保存登录与邮件配置；另复制 `.env.database.example` 为 `.env.database`，只供本地数据库维护脚本使用。这样 Wrangler 不会把 Neon 直连地址识别为 Worker variable。

```dotenv
# .env
RESEND_API_KEY=
FROM_EMAIL=融资工作台 <financing@example.com>
ADMIN_NAME=管理员
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=请替换为至少16位的随机强密码
AUTH_SESSION_HOURS=12

# .env.database
DATABASE_URL=postgresql://user:password@host/database?sslmode=verify-full
```

不要提交 `.env`。生产 Worker 的 Neon 地址只来自 Hyperdrive binding。

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
