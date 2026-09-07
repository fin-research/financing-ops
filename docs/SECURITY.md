# 安全与权限

## 认证

- 账号、密码和邮箱验证由 Auth0 管理；Cloudflare Access 负责统一登录和路径保护。Worker 校验 Access JWT 的 RS256 签名、固定团队 issuer、固定应用 audience、有效期和邮箱域名。
- Auth0 `eastmoney-email` 连接仅支持 `18.cn` 邮箱注册，禁用本应用的其他连接。新注册用户验证邮箱后登录；迁移账号保留原验证状态，例外仅适用于原 Auth0 ID 与原邮箱，不跟随邮箱修改。
- Access JWT 的 `sub` 是 Cloudflare 用户 ID，不能直接作为融资人员 ID。只有签名后的 `custom.eastmoney_user_id` 与 `people.auth0_user_id` 精确匹配且人员启用，才进入融资工作台。不按邮箱自动绑定人员。
- 密码不进入融资数据库或日志；不创建自建会话。旧登录页重定向到 `/auth/login`；退出交给全站统一退出流程。

## 授权

- Auth0 RBAC 是三种融资角色和七类权限的管理来源。角色名为 `financing:admin`、`financing:handler`、`financing:reviewer`，在应用中仍使用原 admin/handler/reviewer 代码和原权限代码。
- 角色授权使用 `https://eastmoney.hasbai.xyz/financing` API 的 permissions，忽略其他 API 的同名权限。账号必须且只能关联一种融资角色。
- `people` 保存人员主档和 Auth0 账号关联；人员启用是进入融资业务的额外条件。人员页面同步 Auth0 的角色与账号状态，角色／权限维护调用 Auth0 后读取确认结果。
- SvelteKit 非安全方法继续按“路由 + named action”映射权限，未登记 mutation 默认拒绝。本人任务更新继续同时校验 personId 与负责人，SQL 保留负责人条件。
- 不允许停用／删除当前人员或移除其登录权限，并至少保留一个启用管理员、一个可维护权限配置的启用角色。移除融资登录只移除融资角色和人员关联，不删除全站 Auth0 账号。
- 融资人员停用使用人员状态与 `app_metadata.financing_enabled`；它不自动封禁其他应用。Auth0 全局 blocked 仍阻止融资访问。

## 授权缓存和数据后台

- 只读请求可复用最多 60 秒的身份判断，缓存键仍为凭证 SHA-256，不保存明文 Cookie/JWT。写请求、`/data/token` 和 `/data/api/*` 强制实时查询 Auth0。
- 数据后台通过同源 `/financing/data/api/*` 使用原有表和字段白名单。客户端不再取得 Neon Auth JWT，禁止任意表、任意 SQL、无主键批量修改和只读字段写入；乐观版本条件继续保留。
- Worker 在单请求同一个 Hyperdrive Client 的事务中设置已验证身份的事务上下文 `request.financing.user_id`，然后 `SET LOCAL ROLE authenticated`。所有设置在事务结束时消失；Auth0 路径不依赖旧 Neon JWT 扩展的会话初始化。
- PostgreSQL RLS 同时检查人员启用、Auth0 账号状态、data_manage 和最长 60 秒的已确认授权有效期；过期授权拒绝读取和写入。数据写入继续由原审计触发器记录 personId、邮箱和变更前后值。
- 导入、数据编辑和令牌／代理入口保留 data_manage 检查，POST/PATCH/DELETE 额外校验 Origin。
- 生产账号迁移采用带原 scrypt 参数的批量导入；上线前核对全部 ID、邮箱、角色与权限。只有新认证和业务访问可用后才移除旧 Neon Auth。

## Secret 与环境

- Worker 生产连接只来自 `HYPERDRIVE` binding，不接受 `DATABASE_URL` variable。
- `DATABASE_URL` 只放 `.env.database`；`RESEND_API_KEY` 只放本地环境或生产 Secret。
- `AUTH0_MANAGEMENT_CLIENT_SECRET` 只保存于 Worker Secret；管理客户端仅授予融资账号和角色维护所需的 Management API scopes。域名、Client ID、角色 ID 和 Access audience 是配置，不是凭证。
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
