# 接口约定

本项目主要使用 SvelteKit page load/actions，不维护传统公共 REST API 清单。路由、表单 action 类型和数据库白名单是事实来源。

## 路径前缀

- 所有应用页面、内部路由、重定向和 Cookie 固定在 `/financing` 下。
- 代码中的 URL 使用 `src/lib/app-paths.ts`，不要手工拼接遗漏前缀的绝对路径。
- SvelteKit `__data.json` 是正常客户端导航协议；全局数据预取使用 `tap`，仅固定侧栏和移动端主导航使用 `hover`，列表、提醒和详情链接不得扩大 hover 预取范围。

## 页面数据

- `+page.server.ts` 的 `load` 只返回页面首屏需要的数据。
- 大体量或低频选项按需加载，例如 `/projects/options` 仅在项目表单打开时返回人员和启用 SOP。
- 根布局用 `depends('financing:identity')` 与 `depends('financing:reminders')` 分离定向失效范围。
- 头像不随页面数据返回 base64，只通过私有 `/avatar` 路由按版本读取。

## Mutation

- action 负责输入解析、业务校验、权限和事务调用。
- 负债周报 `saveSnapshot` action 成功时返回快照 ID、报告日对应的成功文案和缺失模块清单；全局顶栏据此分别显示生成结果与待核对系统消息。
- 进入负债周报或切换 `?date=yyyy-mm-dd` 时只按报告日读取已有快照；无快照时不发起数据拉取。浏览器点击生成后并行请求统一数据服务的 `/data/choice/ctr`、`/data/broker-bond-registrations`，以及 Neon Data API 的 `/rpc/liability_weekly_report_data`。保存 action 只接收、白名单校验并固化三类结果，不在 financing Worker 内代理上游或执行报表聚合查询。
- 写权限精确到 named action：`reviewer` 仅开放人员主档、项目和 SOP 的创建 action；所有启用角色的本人任务 action 只接收 `taskId` 与 `status`，并在查询和更新时双重校验 `assignee_id`。
- 成功响应只返回一个新增/更新实体或删除 ID；浏览器就地合并。
- 禁止在 action 成功后返回当前页面完整列表，禁止前端 `invalidateAll`。
- 只有身份或顶栏提醒确实变化时才定向失效相应根布局依赖。
- 编辑型增强表单使用 `update({ reset: false, invalidateAll: false })`；失败和过期响应不能清空或覆盖用户输入。
- 并发写入使用 `updated_at` 或业务版本检查，冲突应返回 409 或明确可恢复错误。

## 内部 HTTP 路由

- `GET /financing/avatar`：当前用户头像，私有缓存并支持版本条件请求。
- `GET /financing/data/token`：一次返回当前 Neon Auth 会话签发的短期 Data API JWT 与 HTTPS Data API URL；强制绕过身份缓存，并使用 `private, no-store`。
- `GET /financing/projects/options`：按需返回项目表单选项。
- `GET /financing/sop/reminders/more`：用 `(delivery_date, created_at, id)` 游标加载下一批最多 50 条发送历史。

## Neon Data API

- 浏览器端只允许访问 `src/lib/data-admin.ts` 声明的 schema、table、字段和主键。
- 不能从 URL 或用户输入接收任意 schema/table 名称。
- JWT 为短期令牌；长期会话 token 只存在 HttpOnly Cookie。
- 创建、更新和删除后只更新当前行，不重新请求整张表。
- 负债周报只允许固定调用 `financing.liability_weekly_report_data(date)`；PostgreSQL 内执行集合聚合，返回一个版本化 JSON 对象，服务端保存前再次校验报告日和字段边界。

## 错误与状态码

- 输入错误使用 400；未登录 401；无权限 403；不存在 404；并发或唯一性冲突 409；Auth 暂不可用 503。
- 错误消息应可直接指导用户修正，不泄露 SQL、Secret、Cookie 或上游响应正文。
- action 失败保留对应表单字段与 section 标识，便于当前页面就地显示。
