# 融资工作台

面向资金运营团队的全栈工作台，使用 SvelteKit、SQLite、DaisyUI 和 pnpm 构建。

协作与设计约束：

- 开发流程、数据硬约束和当前 TODO：[`AGENTS.md`](./AGENTS.md)
- UI 规范、相对单位和字体偏好：[`DESIGN.md`](./DESIGN.md)

## 已实现

- 首页负债 Dashboard：存续余额、融资成本、未来 30 天到期、在途项目、负债结构和到期梯度。
- 首页日历：集中呈现启用 SOP 所覆盖品种的到期、付息和项目节点。
- 首页与项目甘特图：按负债品种、负责人和状态多选筛选，项目页支持展开 SOP 任务节点。
- 项目详情：编辑项目状态、成员和任务节点，并查看操作日志。
- SOP 与提醒：独立页面编辑模板节点、顺序、相对日期、默认角色、启停和提醒规则。
- Excel 数据：独立页面执行基准表重导入、新文件上传、完整性核对与来源追溯。
- 人员与权限：独立页面维护项目人员，并查看工作台登录账号的角色和状态。
- 邮件提醒：配置提前天数、发送频率和收件人，通过 Resend API 发送；无密钥时进入待发记录。
- 提醒历史：按状态和关键词查询发送记录、Resend 消息编号及失败原因。
- Excel 导入：将 `data/ledger.xlsx` 的 10 张明细表、连续现金流行和全部历史余额幂等写入 SQLite。
- 登录与权限：本地管理员账号使用 scrypt 哈希校验和 HttpOnly 会话；`admin` 可写、`viewer` 只读。
- 操作审计：项目、SOP、人员和提醒规则写操作记录操作者、动作、变更前后及请求来源。

## 启动

```bash
pnpm install
pnpm db:init
pnpm db:import
pnpm dev
```

访问 `http://localhost:5173`。

## 数据与环境变量

默认数据库为 `database/financing-workbench.sqlite`。可复制 `.env.example` 并配置：

```dotenv
FINANCING_WORKBENCH_DB_PATH=database/financing-workbench.sqlite
RESEND_API_KEY=
FROM_EMAIL=融资工作台 <financing@example.com>
ADMIN_USERNAME=admin
ADMIN_PASSWORD=请替换为至少16位的随机强密码
AUTH_SESSION_HOURS=12
```

首次运行 `pnpm db:init` 会把环境变量中的管理员密码安全哈希后写入 SQLite。生产环境必须重新生成强密码，并通过 HTTPS 访问；不要提交 `.env`。登录连续失败 5 次后，账号会锁定 15 分钟。

## 常用命令

```bash
pnpm db:import
pnpm reminders:send -- --dry-run
pnpm reminders:send -- --dry-run
pnpm check
pnpm build
```

生产环境可用定时任务每天执行 `pnpm reminders:send`。同一规则、目标和日期具备唯一约束，不会重复发送。

## 导入核对

导入校验只在本地样本或测试夹具上执行，不在仓库记录真实业务日期、余额、明细或现金流数量、历史范围、数据库大小或重复导入结果。

导入器保留来源文件、工作表、行号、日期与金额单元格，并在写入后再次断言历史条数、总额和各品种余额。
