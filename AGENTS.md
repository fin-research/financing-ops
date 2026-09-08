# 融资项目合并后的入口

本仓库是历史 checkout。融资页面、服务端查询、Auth0 人员权限管理、测试、迁移和维护脚本均已迁入 `../dashboard`；禁止在此新增生产功能、migration 或重新启用路由和 Cron。

开始融资任务前完整读取 [Dashboard AGENTS.md](../dashboard/AGENTS.md)，再按 [文档分流](../dashboard/docs/INDEX.md) 选择具体页面或模块。实际修改、测试、提交和发布在 Dashboard 仓库完成。

本仓库中的源文件与测试仅供历史回溯。原始 Excel 和本地凭证不要删除或提交。历史结构验证仍可执行 `pnpm test`、`pnpm check`；绑定声明由 `pnpm cf:typegen` 生成。旧 Worker 只保留休眠回退代码，配置必须保持空路由、空 Cron、关闭 workers.dev，并把融资 Workflow binding 指向 Dashboard。
