# 融资工作台

面向资金运营团队的全栈工作台，使用 SvelteKit、Cloudflare Workers、D1、DaisyUI 和 pnpm 构建；本地使用 SQLite 做导入核对。

协作与设计约束：

- 开发流程、数据硬约束和当前 TODO：[`AGENTS.md`](./AGENTS.md)
- UI 规范、相对单位和字体偏好：[`DESIGN.md`](./DESIGN.md)

## 已实现

- 仪表盘：3×3 彩色语义卡片列示规模、利率、期限、30 天到期、推进中项目和四项监管比例，支持预设与自定义品种口径。月末累计新增借款按最近已完成月末余额减上年末余额计算，已到期偿还会冲减净新增。
- 仪表盘图表：存量负债结构与六个月到期分布并排，推进中项目与同比月度发行统计并排；未来 30 天到期保留为上方指标，不再展示逐笔明细表。
- 工作台：按每笔融资性负债展示到期、年度付息和簿记发行日历，支持点击联查负债主表与品种扩展字段。
- 负债额度与发行试算：自动计算已发行/剩余额度，并完成拟发行规模的额度校验。
- 负债品种二级分类：收益凭证拆分浮动/固定，债券拆分小公募、次级债、私募债、科创债和短期融资券；展示端仍将收益凭证合并、债券按细项列示。
- 项目甘特图：按负债品种、负责人和状态多选筛选，支持展开 SOP 任务节点；经办默认只看本人负责项目，复核与管理员默认查看全部，当前角色统一显示在顶栏标题右侧。
- 顶栏提醒：集中列示未来 7 天及已逾期的项目节点，显示待处理数字角标，并可从每条提醒直接进入对应项目。
- 项目详情：编辑项目状态、成员和任务节点，并查看操作日志。
- SOP 管理：独立页面编辑模板节点、顺序、相对日期、默认角色、启停和提醒规则。
- 数据后台：在浏览器本地解析新版 Excel，只上传类型化分片；全部暂存成功后由 D1 事务切换最新台账，并维护监管指标计算参数。
- 人员与权限：人员主档统一关联项目责任、系统角色和登录账号，支持人员与账号的新增、编辑、启停、删除、密码重置及角色调整。
- 个人设置：点击顶栏账号进入 `/settings`，可更新头像、显示姓名、邮箱、登录用户名和密码；修改密码后保留当前会话并退出其他设备。
- 邮件提醒：配置提前天数、发送频率和收件人，通过 Resend API 发送；无密钥时进入待发记录。
- 提醒历史：按状态和关键词查询发送记录、Resend 消息编号及失败原因。
- Excel 导入：将 `data/ledger.xlsx` 的 10 张明细表、结构化现金流和日余额幂等写入负债主表及品种扩展表，不保存原始 JSON。
- 登录与权限：本地账号使用 scrypt 哈希校验和 HttpOnly 会话；系统角色为 `admin`（管理员）、`handler`（经办）和 `reviewer`（复核），细粒度权限暂不扩展。
- 操作审计：项目、SOP、人员、提醒规则和监管指标计算参数的写操作记录操作者、动作与变更前后。

## 启动

```bash
pnpm install
pnpm db:init
pnpm db:import
pnpm dev
```

访问 `http://localhost:5173`。

生产 Worker 已发布到 [eastmoney-financing.hasbai.workers.dev](https://eastmoney-financing.hasbai.workers.dev)，绑定 D1 数据库 `financing`。

## 数据与环境变量

默认数据库为 `database/financing-workbench.sqlite`；`database/*.sqlite*` 为本地运行数据，已从 Git 追踪中排除。可复制 `.env.example` 并配置：

```dotenv
FINANCING_WORKBENCH_DB_PATH=database/financing-workbench.sqlite
RESEND_API_KEY=
FROM_EMAIL=融资工作台 <financing@example.com>
ADMIN_USERNAME=admin
ADMIN_PASSWORD=请替换为至少16位的随机强密码
AUTH_SESSION_HOURS=12
```

首次运行 `pnpm db:init` 会把环境变量中的管理员密码安全哈希后写入 SQLite；账号创建后，密码以个人设置页中的修改结果为准，服务重启不会再由环境变量覆盖。生产环境必须使用强密码并通过 HTTPS 访问；不要提交 `.env`。登录连续失败 5 次后，账号会锁定 15 分钟。

## 常用命令

```bash
pnpm db:import
pnpm reminders:send -- --dry-run
pnpm reminders:send -- --dry-run
pnpm check
pnpm build
pnpm cf:typegen
pnpm exec wrangler d1 migrations apply financing --remote
pnpm deploy
```

生产环境可用定时任务每天执行 `pnpm reminders:send`。同一规则、目标和日期具备唯一约束，不会重复发送。

## 导入核对

导入校验只在本地样本或测试夹具上执行，不在仓库记录真实业务日期、余额、明细或现金流数量、历史范围、数据库大小或重复导入结果。

数据库采用“一张 `debts` 主表 + 多张品种扩展表”的类表继承结构。债券、收益凭证、收益权转让、同业拆借、转融资、集团借款和互换便利均有明确类型列；还本付息计划继续使用一对多表。页面上传使用文件名识别基准日，新版中不存在的旧负债会在最终事务中删除。
