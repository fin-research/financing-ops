# 接口约定

本项目主要使用 SvelteKit page load/actions，不维护传统公共 REST API 清单。路由、表单 action 类型和数据库白名单是事实来源。

## 路径前缀

- 所有应用页面、内部路由、重定向和 Cookie 固定在 `/financing` 下。
- 代码中的 URL 使用 `src/lib/app-paths.ts`，不要手工拼接遗漏前缀的绝对路径。
- SvelteKit `__data.json` 是正常客户端导航协议；全局数据预取使用 `tap`，不恢复 hover 预取。

## 页面数据

- `+page.server.ts` 的 `load` 只返回页面首屏需要的数据。
- 大体量或低频选项按需加载，例如 `/projects/options` 仅在项目表单打开时返回人员和启用 SOP。
- 根布局用 `depends('financing:identity')` 与 `depends('financing:reminders')` 分离定向失效范围。
- 头像不随页面数据返回 base64，只通过私有 `/avatar` 路由按版本读取。

## Mutation

- action 负责输入解析、业务校验、权限和事务调用。
- 写权限精确到 named action：`reviewer` 仅开放人员主档、项目和 SOP 的创建 action；所有启用角色的本人任务 action 只接收 `taskId` 与 `status`，并在查询和更新时双重校验 `assignee_id`。
- 成功响应只返回一个新增/更新实体或删除 ID；浏览器就地合并。
- 禁止在 action 成功后返回当前页面完整列表，禁止前端 `invalidateAll`。
- 只有身份或顶栏提醒确实变化时才定向失效相应根布局依赖。
- 编辑型增强表单使用 `update({ reset: false, invalidateAll: false })`；失败和过期响应不能清空或覆盖用户输入。
- 并发写入使用 `updated_at` 或业务版本检查，冲突应返回 409 或明确可恢复错误。

## 内部 HTTP 路由

- `GET /financing/avatar`：当前用户头像，私有缓存并支持版本条件请求。
- `GET /financing/data/token`：取得当前 Neon Auth 会话签发的短期 Data API JWT；强制绕过身份缓存。
- `GET /financing/projects/options`：按需返回项目表单选项。
- `GET /financing/sop/reminders/more`：用 `(delivery_date, created_at, id)` 游标加载下一批最多 50 条发送历史。

## Neon Data API

- 浏览器端只允许访问 `src/lib/data-admin.ts` 声明的 schema、table、字段和主键。
- 不能从 URL 或用户输入接收任意 schema/table 名称。
- JWT 为短期令牌；长期会话 token 只存在 HttpOnly Cookie。
- 创建、更新和删除后只更新当前行，不重新请求整张表。

## 错误与状态码

- 输入错误使用 400；未登录 401；无权限 403；不存在 404；并发或唯一性冲突 409；Auth 暂不可用 503。
- 错误消息应可直接指导用户修正，不泄露 SQL、Secret、Cookie 或上游响应正文。
- action 失败保留对应表单字段与 section 标识，便于当前页面就地显示。
