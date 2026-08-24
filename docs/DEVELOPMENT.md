# 开发与交付

## 本地环境

```bash
pnpm install
pnpm dev
```

- 从 `.env.example` 创建未跟踪的 `.env`，保存 Neon Auth、Data API 与邮件配置。
- 从 `.env.database.example` 创建未跟踪的 `.env.database`，只保存本地脚本使用的直连 `DATABASE_URL`。
- `pnpm-workspace.yaml` 必须显式包含根包 `packages: ['.']`，与 Cloudflare Git 的 pnpm 环境兼容。

## 默认验证

```bash
pnpm test
pnpm check
git diff --check
```

- `pnpm check` 必须为 0 error、0 warning。
- 静态检查和单元测试不等于浏览器或截图验收；只有实际执行后才能声明视觉检查通过。
- 网络效率变化同时运行并更新 `tests/network-efficiency.test.mjs`。

## 专项验证

- DDL：在 PostgreSQL 兼容环境执行全部相关 migration，覆盖继承、计算列、序列、视图、触发器、RLS 和 GRANT。
- Excel：`pnpm db:import -- --dry-run`，核对来源日期、单位、数量、余额、重复 ID 和孤儿引用。
- SQLite：`pnpm db:migrate:sqlite -- --dry-run`；目标库非空时不得强行覆盖。
- 提醒：Worker Cron 每个 UTC 整点执行一次候选检查；整天周期只会在上海时间 09:00 后进入候选，含小时周期按实际整点进入候选。至少运行测试；候选可用 `pnpm reminders:send -- --dry-run --at=<ISO 时间>` 盘点，`--date=YYYY-MM-DD` 表示该上海自然日末；查询线上候选前确认目标数据库，真实发送前确认收件人与发件人。
- Auth / Data API：检查登录、短期 JWT、RLS、角色边界和失败状态，不在日志展示 token。
- UI：按 `DESIGN.md` 检查受影响的桌面、移动、200% 缩放与减少动效场景；没有执行时明确说明边界。

## 数据库命令

```bash
pnpm db:init -- --schema-only
pnpm db:migrate:sqlite -- --dry-run
pnpm db:import -- --dry-run
pnpm reminders:send -- --dry-run
pnpm cf:typegen
```

去掉 `--dry-run`、增加 `--apply` 或执行发送都可能写入外部状态；先确认目标环境和任务授权。

## Git 与发布

- 仓库为 `fin-research/financing-ops`，默认分支 `main`。
- 开始前查看工作区；用户已有改动默认保留，只暂存当前任务文件。
- `main` 已接入 Cloudflare Git 自动构建部署。日常交付提交并推送后由平台发布。
- 数据库不兼容变更先迁移 Neon，再推送依赖新 schema 的 Worker。
- 除非用户明确要求排障或紧急回滚，不手动运行 `pnpm build`、`pnpm deploy` 或 `wrangler deploy`。
- Cloudflare 构建和迁移都成功后才能把线上发布写成完成。

## 文档维护

- UI 约束变化只更新 `DESIGN.md`。
- 业务不变量、数据、接口、安全或开发流程分别更新对应 `docs/*.md`。
- 新的高频全局硬规则才进入 `AGENTS.md`；不要把专题细节复制回 Agent 入口。
- 已确认未完成事项更新 `docs/TODO.md`，不要把历史会话日志继续附加到设计文档。
