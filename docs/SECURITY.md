# 安全与权限

## 认证

- 账号、密码、会话和 Data API JWT 由 Neon Managed Better Auth 管理。
- 应用 Cookie `financing_session` 只保存不透明会话 token，使用 HttpOnly、SameSite=Lax、HTTPS 下 Secure，并限制到 `/financing`。
- `financing` schema 不保存密码哈希或自建会话；历史 `auth_users` / `auth_sessions` 已由 migration 删除。
- 用户必须同时满足 Neon Auth 会话有效、`people.neon_auth_user_id` 匹配且人员启用，才能进入应用。

## 授权

- SvelteKit 非安全方法按“路由 + named action + 角色”授权：`admin` 可执行全部业务写入；`reviewer` 可新增人员主档、项目和 SOP；所有已登录角色可修改自己的个人资料、密码、退出会话，并可更新分配给自己的任务节点状态。
- `reviewer` 新增人员时只能创建 `handler` / `reviewer` 人员主档，不能开通 Neon Auth 登录、创建管理员或修改、停用、删除既有人员；这些账号安全动作仍仅限 `admin`。
- 数据后台使用独立的 PostgreSQL RLS 规则：当前三种启用业务角色均可编辑白名单中的负债、监管参数和额度。
- 人员与账号管理必须防止停用或删除当前用户，并至少保留一个启用管理员。
- 本人任务状态写入同时校验当前 `personId` 与任务 `assignee_id`，更新 SQL 再带相同负责人条件防止并发越权；负责人、截止日和他人任务仍仅限 `admin` 修改。
- 权限判断必须由服务端执行；隐藏或禁用按钮只用于正确表达界面能力，不是授权控制。
- 借入资金汇总表上传、导入记录和进度接口均只允许 `admin`；POST 额外要求请求 `Origin` 与当前站点一致，非管理员即使直接调用接口也不得读取或写入导入数据。

## 会话缓存

- 首次受保护请求向 Neon Auth 验证会话，并通过 Hyperdrive 查询业务身份。
- 只读请求可在 Workers Cache 复用最多 60 秒的身份判断，cache key 使用会话 token 的 SHA-256。
- 缓存不写入浏览器、不保存明文 token。写请求和 `/data/token` 强制绕过并清除缓存。
- 缓存不可用时必须立即回退到实时验证，不能把缓存命中当作长期授权。

## Data API JWT

- `/data/token` 强制从 Neon Auth 会话响应取得短期 JWT，当前有效期由服务端签发策略决定。
- 浏览器只取得短期 JWT，不得取得长期会话 token。
- Data API 只暴露 `financing` schema；每张可编辑表必须同时具备白名单、RLS、GRANT 和审计触发器。
- 线上台账的运行记录和临时结构化载荷不通过 Data API 暴露，只能由 Worker 的 Hyperdrive 连接访问。
- 只读的负债周报聚合 RPC 仅向 `authenticated` 授予执行权限，不要求 JWT 用户关联 `people`；该例外不改变可编辑表的人员 RLS。
- 现金流、历史余额和审计记录不向 `authenticated` 开放。

## Secret 与环境

- Worker 生产连接只来自 `HYPERDRIVE` binding，不接受 `DATABASE_URL` variable。
- `DATABASE_URL` 只放 `.env.database`；`RESEND_API_KEY` 只放本地环境或生产 Secret。
- `NEON_AUTH_URL` 和可选 `NEON_DATA_API_URL` 是配置；仍不得把实际会话 token 或签名值写入文档。
- 不修改或提交 `.env`、`.env.database`；示例文件只保留占位值。

## 敏感数据

- 身份查询只返回头像存在状态和版本，不传输 `avatar_data_url`。
- 头像通过 `/avatar` 私有缓存独立传输，服务端必须按当前用户读取。
- 日志不得包含密码、Cookie、JWT、连接串、Resend key、完整头像内容或邮件正文。
- Data API 写入由触发器记录操作人、实体、动作和前后值；本地 Excel 维护不伪装成逐行在线审计。
- 线上台账上传在内存中直接解析，原始 Excel 不进入 R2、数据库或日志；临时 JSON 在任务成功或失败后删除。完成审计只记录文件名、内容哈希、基准日和汇总笔数，不记录原始行内容。

## 邮件

- 真实测试邮件发送前必须确认收件人和发件人。
- `sent` 表示 provider 接受，不代表 `delivered`；交付或退信状态只有在 provider 事件可验证时才能声明。
- 未配置 Resend 时只记录 `pending`，不得生成虚假 message ID。
