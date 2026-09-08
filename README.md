# 融资工作台历史仓库

融资功能现由 [Dashboard](https://github.com/fin-research/dashboard) 统一维护，生产入口继续为 `/financing`。人员与 Auth0 角色权限入口为 `/management/people`。

本仓库保留合并前源码和 Git 历史供回溯，不再承接功能开发。公共规范与按页面分流见本地 [Dashboard 文档索引](../dashboard/docs/INDEX.md)。原始 Excel、凭证和旧 SQLite 文件仍留在原本地目录，维护时向 Dashboard 的 `scripts/financing/` 显式传入源文件路径。

旧 Worker 不配置路由、workers.dev 或 Cron；Workflow binding 指向 Dashboard，旧构建不会重新取得导入 Workflow 所有权。生产功能以 Dashboard 的发布版本为准。
