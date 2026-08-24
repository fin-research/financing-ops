# 融资工作台

面向资金运营与融资项目团队的一体化工作台，统一管理存续负债、融资项目、SOP、人员权限和提醒。

## 核心功能

- 融资仪表盘：查看存量结构、到期分布、监管指标、额度、项目和日历。
- 负债数据：按品种维护存续负债并查看统一现金流。
- 项目进度：按启用的 SOP 建立独立融资项目，以计划簿记日生成节点和甘特时间轴。
- SOP 管理：维护流程模板、节点顺序和提醒规则。
- 人员与权限：使用邮箱登录，统一维护人员、业务角色和可选登录账号。
- 提醒：按规则发送邮件并查询发送历史。

应用统一位于 `/financing`。生产数据存放在 Neon PostgreSQL 的 `financing` schema，线上不提供 Excel 上传或导入入口。

## 本地使用

```bash
pnpm install
pnpm dev
```

环境配置从 `.env.example` 和 `.env.database.example` 创建本地未跟踪文件。数据库维护、迁移和提醒命令见开发文档。

## 文档

- [AI Agent 入口](AGENTS.md)
- [UI/UX 规范](DESIGN.md)
- [系统架构](docs/ARCHITECTURE.md)
- [业务规则](docs/DOMAIN.md)
- [数据库](docs/DATABASE.md)
- [接口约定](docs/API.md)
- [安全与权限](docs/SECURITY.md)
- [开发与交付](docs/DEVELOPMENT.md)
- [当前待办](docs/TODO.md)
