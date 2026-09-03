# AGENTS.md

## Project Overview

融资工作台服务于资金运营与融资项目团队，管理存续负债、现金流、融资项目、SOP、人员权限和提醒。

技术栈：SvelteKit / Svelte 5、TypeScript、Tailwind CSS 4、daisyUI、Lucide、Cloudflare Workers、Hyperdrive、Neon PostgreSQL、Neon Managed Better Auth、Neon Data API 与 Resend。应用统一位于 `/financing` 前缀。

## Repository Structure

- `src/routes/`：页面、SvelteKit server load/actions 和少量内部 HTTP 路由。
- `src/lib/server/`：认证、数据库、查询、提醒、审计和项目删除事务。
- `src/lib/postgres.js`：Worker 与本地脚本共用的 PostgreSQL 参数化查询适配。
- `src/lib/debt-types.js`：负债品种与展示标签的唯一代码目录。
- `src/lib/data-admin.ts`、`src/lib/neon-data-api.ts`：数据后台白名单与浏览器 Data API 适配。
- `migrations/`：Neon PostgreSQL migration。
- `scripts/`：数据库初始化、SQLite 迁移、Excel 本地维护和提醒发送；`scripts/lib/` 的纯解析模块由本地命令与线上导入共同复用。
- `data/`：原始 Excel；不得静默改写。
- `database/`：只读旧 SQLite 迁移来源，不是运行时数据库。
- `tests/`：Node 单元与网络效率契约测试。

## Mandatory Rules

- 修改前搜索现有 route、query、组件和共享函数；优先复用，不建立重复抽象，不重构无关代码。
- UI 任务必须读取 `DESIGN.md`。桌面端保持高信息密度，移动端不得出现页面级横向滚动。
- 融资项目与负债建档完全独立。项目使用单一“计划簿记”日期作为 SOP“计划发行当日”锚点；项目增删改不得绑定或修改负债。
- 生产业务数据只在 Neon `financing` schema。借入资金汇总表允许管理员从数据后台线上导入：上传请求直接解析且不得持久化原始 Excel，校验后的结构化载荷只在 Neon 临时保存并由 Workflow 消费后删除；其他 Excel 仍仅由 `scripts/` 本地维护。
- 数据库结构变化必须新增 migration；以全部 migration 顺序后的最终 schema 为事实来源，不直接修改线上表替代 migration。
- Worker 只通过 `HYPERDRIVE.connectionString` 连接数据库。每个请求至多一个 `pg.Client`，存于 request locals 并在结束时关闭；禁止全局 `Pool`、跨请求连接和 N+1 查询。
- 页面 mutation 只回传服务端确认的单一变更实体或删除 ID，前端就地合并；禁止成功后 `invalidateAll` 重读整页。只在确有需要时定向失效身份或提醒依赖。
- 项目、任务和 SOP 普通字段采用防抖串行自动保存；失败保留输入，旧响应不得覆盖新输入。创建、删除、启停、账号、密码和数据后台逐行保存仍为显式动作。
- 认证与会话只由 Neon Auth 管理；业务授权以启用的 `financing.people` 记录为准。不得重新引入自建密码、会话或 username。
- Secret、Cookie、数据库连接串、邮件 API key、头像内容不得进入日志、文档或客户端页面数据。
- 不手动编辑 `worker-configuration.d.ts`；绑定变化用 `pnpm cf:typegen`。
- 保留用户已有改动，不通过删除测试、关闭检查或忽略错误让任务通过。
- 默认交付前运行 `pnpm test`、`pnpm check`、`git diff --check`；专项变化按 `docs/DEVELOPMENT.md` 增加验证。

## Commands

- 安装：`pnpm install`
- 开发：`pnpm dev`
- 测试：`pnpm test`
- Svelte/TypeScript 检查：`pnpm check`
- Worker 类型：`pnpm cf:typegen`
- 初始化 schema：`pnpm db:init -- --schema-only`
- Excel 盘点：`pnpm db:import -- --dry-run`
- SQLite 迁移盘点：`pnpm db:migrate:sqlite -- --dry-run`
- 提醒盘点：`pnpm reminders:send -- --dry-run`

`main` 使用 Cloudflare Git 自动构建部署。数据库不兼容变更先迁移 Neon，再推送代码；日常不手动运行 `pnpm build`、`pnpm deploy` 或 `wrangler deploy`。

## Context Routing

不要默认读取全部文档。按任务选择：

- UI、布局、组件、表单、图表、响应式 → `DESIGN.md`
- 系统分层、数据流、依赖、新模块位置、查询预算 → `docs/ARCHITECTURE.md`
- 负债、项目、SOP、人员、提醒、状态和业务不变量 → `docs/DOMAIN.md`
- PostgreSQL、继承、RLS、Data API、migration、Excel → `docs/DATABASE.md`
- 页面 actions、内部路由、增量响应和错误约定 → `docs/API.md`
- 登录、角色、Cookie、JWT、权限、Secret、审计 → `docs/SECURITY.md`
- 环境、测试、专项 dry-run、Git、发布 → `docs/DEVELOPMENT.md`
- 已确认但未完成的工作 → `docs/TODO.md`

Do not load all documentation by default. Read only documentation relevant to the current task. If multiple areas are affected, read only the corresponding documents. Do not repeatedly read documents already available in the current context unless necessary.
