# 安全与权限

## 认证

- 账号、密码、会话和 Data API JWT 由 Neon Managed Better Auth 管理。
- 应用 Cookie `financing_session` 只保存不透明会话 token，使用 HttpOnly、SameSite=Lax、HTTPS 下 Secure，并限制到 `/financing`。
- `financing` schema 不保存密码哈希或自建会话；历史 `auth_users` / `auth_sessions` 已由 migration 删除。
- 用户必须同时满足 Neon Auth 会话有效、`people.neon_auth_user_id` 匹配且人员启用，才能进入应用。

## 授权

- `role_permissions` 按角色保存项目管理、本人任务办理、SOP 与提醒、人员与账号、数据后台、周报生成和权限配置七类授权；内部测试 migration 初始为三种角色全量授权。
- SvelteKit 非安全方法按“路由 + named action”映射权限，未登记 mutation 默认拒绝；个人资料、密码和退出登录不依赖业务权限。
- 数据后台除 Worker 接口校验 `data_manage` 外，PostgreSQL RLS 也校验当前启用人员所属角色的 `data_manage`，避免绕过页面直接写入。
- 人员与账号管理必须防止停用或删除当前用户，并至少保留一个启用管理员。
- 本人任务状态专用 action 同时要求 `own_task_update`，校验当前 `personId` 与任务 `assignee_id`，更新 SQL 再带相同负责人条件防止并发越权；完整任务维护要求 `project_manage`。
- 权限判断必须由服务端执行；隐藏或禁用按钮只用于正确表达界面能力，不是授权控制。
- 借入资金汇总表提交、进度和 Data API 令牌接口均要求 `data_manage`；POST 额外要求请求 `Origin` 与当前站点一致。
- 保存角色权限必须具有 `permission_manage`，并至少保留一个拥有启用登录账号且可以继续维护权限配置的角色。

## 会话缓存

- 首次受保护请求向 Neon Auth 验证会话，并通过 Hyperdrive 查询业务身份。
- 只读请求可在 Workers Cache 复用最多 60 秒的身份判断，cache key 使用会话 token 的 SHA-256。
- 缓存不写入浏览器、不保存明文 token。写请求和 `/data/token` 强制绕过并清除缓存。
- 缓存不可用时必须立即回退到实时验证，不能把缓存命中当作长期授权。

## Data API JWT

- `/data/token` 强制从 Neon Auth 会话响应取得短期 JWT，当前有效期由服务端签发策略决定。
- 浏览器只取得短期 JWT，不得取得长期会话 token。
- Data API 只暴露 `financing` schema；每张可编辑表必须同时具备白名单、RLS、GRANT 和审计触发器。
- 线上台账的运行状态与临时结构化载荷只保存在 Workflow 实例中，不进入 Neon 或 Data API。
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
- 线上台账在管理员浏览器内解析，原始 Excel 不离开浏览器；服务端只接收有明确大小上限的 Protobuf/Brotli 业务字段，并重新校验版本、日期、数量、金额、引用和汇总勾稽。载荷、状态和结果只由 Workflow 短期保留，不写 R2、Neon 或日志。

## 邮件

- 真实测试邮件发送前必须确认收件人和发件人。
- `sent` 表示 provider 接受，不代表 `delivered`；交付或退信状态只有在 provider 事件可验证时才能声明。
- 未配置 Resend 时只记录 `pending`，不得生成虚假 message ID。
