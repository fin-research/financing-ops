# 数据库规范

生产数据库为 Neon PostgreSQL，业务对象位于 `financing` schema。最终结构以 `migrations/` 按顺序全部执行后的结果为事实来源；不要只阅读 `0001` 或复制完整 DDL 到文档。

## 连接边界

- Worker 只读取 `event.platform.env.HYPERDRIVE.connectionString`。
- 每个请求创建至多一个 `pg.Client` 并存入 `event.locals.database`；请求结束关闭。
- `DATABASE_URL` 只保存在 gitignored `.env.database`，供本地初始化、迁移、Excel 和提醒脚本使用。
- 禁止 Worker 全局 `Pool`、跨请求 client、未参数化 SQL 和 N+1 查询。

融资业务表继续只写 `financing` schema。负债周报通过只读视图 `financing.liability_market_rate_observations` 暴露跨应用共享 `public.edb` 的白名单原始观测；该表由 dashboard 的每日 Workflow 统一维护，financing 不写入、不建立平行市场利率表。

## 负债模型

- `financing.debt` 是基类；`id bigint` 来自 `debt_id_seq`。
- `bond`、`income_certificate`、`income_right`、`refinancing`、`swap_facility` 使用 PostgreSQL 原生 `INHERITS`。
- 同业拆借与集团借款没有有效专属字段，直接存基类。
- `income_certificate.subscription_date` 与 `redemption_date` 分别保存认购日和兑付日；`maturity_date` 缺失时由数据库按兑付日前一工作日（周一至周五）兜底。简称使用产品名称，去除发行人全称；“吉祥/财气东来 + 序号”统一为“吉祥231号收益凭证”“财气东来1918号收益凭证”格式。
- `refinancing.name` 由数据库触发器和约束固定为“转融资”；对手方、市场、起息日等信息不得拼入简称。
- `total_amount = amount + interest_payable`、`term_days` 和 `status` 是 stored generated columns。
- 负债与融资项目已解除关联；最终 schema 不应包含有效的项目外键。
- 禁止重新引入 import 字段、外部业务键、重复类别字段、可写状态、原始 Excel 行或单元格字段。

PostgreSQL 的主键、唯一约束和外键不会自动覆盖继承子表，因此必须保留：

- 事务级 advisory lock 与触发器保证跨父/子表 ID 全局唯一。
- 触发器校验现金流引用并在删除负债时级联清理。
- 针对继承、计算列、序列、视图和触发器的兼容测试。

## 现金流、余额和视图

- `cashflow` 统一保存本金、利息、费用与补充流，主键 `(debt_id, sequence)`。
- `balance_snapshot` 以 `(as_of_date, debt_type, subtype)` 保存历史余额。
- `monthly_financing_metrics` 固化 2021 年以来已结束月份的余额、加权融资利率和加权剩余期限；migration 一次性回填，之后由周报 RPC 只补缺失的已结束月份，历史行不反复刷新，当前报告月份仍实时计算。
- 管理员线上导入权威借入资金汇总表时例外地清空并重建全部 `monthly_financing_metrics`，使历史台账修订同步进入衍生趋势；日常周报 RPC 仍只惰性补缺失月份。
- 常用读取优先使用 `debt_overview`、`cashflow_overview`、`data_overview` 或明确的集合查询。
- 页面数据缺口不能通过新建冗余汇总表临时解决；先评估视图或集合查询。
- `liability_weekly_report_runs` 只保存报告日、R2 key、来源清单、缺失模块和内容哈希；完整报告保存在 R2。安装包导入的 `liability_market_observations`、`liability_peer_issuances`、`liability_registration_progress` 已删除，不得重新作为回退数据源。

## 项目、SOP 与提醒

- `projects` 与 `project_tasks` 是独立融资项目体系，不引用负债。
- `sop_templates` 与 `sop_nodes` 定义模板和相对日期节点。
- `reminder_rules` 保存规则本体，`reminder_rule_nodes` 保存规则与 SOP 节点的多对多关联，`reminder_rule_periods` 保存可排序的多个小时级提前周期。
- `reminder_deliveries` 以 `(rule_id, target_id, period_id)` 去重，同时保存 `scheduled_for` 和实际发送结果。
- 项目删除必须使用已有事务服务，同步清理任务与提醒，不在页面拼接多次删除。

## Neon Data API 与 RLS

- Data API 只暴露 `financing` schema，数据库角色为 `authenticated`。
- 可编辑表必须同时进入 `src/lib/data-admin.ts` 白名单、显式 GRANT、RLS policy 和写入审计触发器。
- 当前数据后台只开放负债品种表、`finance_parameters` 与 `debt_limit_configs`。
- Data API 支持 PostgREST 过滤、关联和聚合，也支持调用数据库函数；负债周报使用固定的 `liability_weekly_report_data(date)` RPC 聚合融资业务数据，并通过只读视图 `liability_market_rate_observations` 按指标和日期直接读取原始市场观测。RPC 与视图仅向 `authenticated` 开放，不再要求 JWT 用户关联 `people`；`monthly_financing_metrics` 与底层 `public.edb` 均不直接开放。
- 现金流、历史余额和审计记录不展示，且 `authenticated` 不得通过 Data API 访问。
- 导入载荷、运行状态和结果不写入 Neon；数据库只保存原子提交后的业务表与衍生表结果。
- 活跃且关联 Neon Auth 的三种业务角色均可按现有 RLS 编辑数据后台表；SvelteKit 管理 actions 仍由服务端角色规则单独控制。
- 更新和删除携带 `updated_at` 做乐观并发检查；主键和计算列只读。
- DDL、视图、函数或列变化后必须显式刷新 Neon Data API schema cache：`neon data-api refresh-schema --database neondb`；migration 中的 PostgreSQL `NOTIFY pgrst` 不能替代 Neon 托管 Data API 的刷新动作。

## Migration

- 所有 schema、视图、函数、触发器、RLS 和 GRANT 变化新增有序 SQL 文件。
- migration 必须可在 PostgreSQL 兼容环境实际执行，并在事务失败时保持旧结构可用。
- 不兼容变更先迁移 Neon，再推送依赖新结构的 Worker。
- `pnpm db:init -- --schema-only` 应用完整 DDL；登录账号在 Neon Auth 创建，再与 `people` 关联。

## Excel 与 SQLite

- 借入资金汇总表可由管理员通过线上内部接口导入。浏览器内解析 `.xlsx` 并生成分批 Protobuf/Brotli 载荷，原始 Excel 不上传；文件上限 10 MB，压缩载荷上限 720 KiB。
- 导入载荷、运行状态和结果只由 Cloudflare Workflow 按短保留期临时保存；Neon 不建立导入临时表、状态表或完成审计。Workflow 只通过 Hyperdrive 在单一事务中更新负债、现金流、余额历史和衍生指标。
- `scripts/import-debts.mjs` 与线上 Workflow 共用同一单事务、advisory lock 和批量写入实现；收益凭证重导时先按规范简称匹配，存量历史数据可按原系列名回退匹配；不得删除线上新增数据。
- SQLite 只作为一次性迁移来源；目标负债非空时迁移脚本应拒绝重复覆盖。
- 解析变化先运行 `pnpm db:import -- --dry-run`；SQLite 变化先运行 `pnpm db:migrate:sqlite -- --dry-run`。

导入回归只验证 Excel 映射、单位转换、数量与金额勾稽，不在文档中固化真实业务日期、余额、笔数或历史范围。需要验证时使用未提交的本地样本或测试夹具，并将结果保留在运行环境中，不把真实台账结果写入仓库。
