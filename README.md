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
- 数据后台：在浏览器本地解析新版 Excel，先只读比对线上业务键，再将晚于最大日期的余额及其他新增记录一次性原子追加到 D1；相同文件哈希直接返回，不产生写入。导入同时保存数量、日期范围和基准日余额快照，日常页面仅读一行状态；完整扫描只由 `/data` 的管理员“重新统计”按钮触发。
- 人员与权限：人员主档统一关联项目责任、系统角色和邮箱登录权限，支持人员与登录权限的新增、编辑、启停、删除、密码重置及角色调整；不再维护独立登录账户名。
- 个人设置：点击顶栏账号进入 `/settings`，可更新头像、显示姓名、登录邮箱和密码；修改登录邮箱需验证当前密码，修改密码后保留当前会话并退出其他设备。
- 邮件提醒：配置提前天数、发送频率和收件人，通过 Resend API 发送；无密钥时进入待发记录。
- 提醒历史：按状态和关键词查询发送记录、Resend 消息编号及失败原因。
- Excel 导入：将 `data/ledger.xlsx` 的 10 张明细表、结构化现金流和日余额按稳定业务键及日期幂等追加到负债主表及品种扩展表，不保存原始 JSON，不更新或删除既有历史。
- 登录与权限：用户使用人员主档中的唯一邮箱登录，密码采用 scrypt 哈希校验，会话使用限定在 `/financing` 下的 HttpOnly Cookie；系统角色为 `admin`（管理员）、`handler`（经办）和 `reviewer`（复核），细粒度权限暂不扩展。
- 操作审计：项目、SOP、人员、提醒规则和监管指标计算参数的写操作记录操作者、动作与变更前后。

## 启动

```bash
pnpm install
pnpm db:init
pnpm db:import
pnpm dev
```

访问 `http://localhost:5173/financing/`。应用固定使用 `/financing` path prefix，内部导航、表单、API 请求和登录重定向均不得回退到站点根路径。

远程仓库为 [`fin-research/financing-ops`](https://github.com/fin-research/financing-ops)。生产 Worker 已发布到 [eastmoney-financing.hasbai.workers.dev/financing/](https://eastmoney-financing.hasbai.workers.dev/financing/)，绑定 D1 数据库 `financing`；统一域名入口为 `https://eastmoney.hasbai.xyz/financing/`。

`main` 分支已接入 Cloudflare Git 自动构建与部署。日常发布只需提交并执行 `git push origin main`；除非明确要求排障或紧急回滚，不在本地运行 `pnpm build`、`pnpm run deploy` 或 `wrangler deploy`。

## 数据与环境变量

默认数据库为 `database/financing-workbench.sqlite`；`database/*.sqlite*` 为本地运行数据，已从 Git 追踪中排除。可复制 `.env.example` 并配置：

```dotenv
FINANCING_WORKBENCH_DB_PATH=database/financing-workbench.sqlite
RESEND_API_KEY=
FROM_EMAIL=融资工作台 <financing@example.com>
ADMIN_NAME=管理员
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=请替换为至少16位的随机强密码
AUTH_SESSION_HOURS=12
```

首次运行 `pnpm db:init` 会使用 `ADMIN_EMAIL` 创建管理员并把密码安全哈希后写入 SQLite；账号创建后，邮箱和密码以个人设置页中的修改结果为准，服务重启不会由环境变量覆盖。升级前已存在但尚未设置邮箱的管理员可临时使用原标识登录一次，并应立即在个人设置中补齐登录邮箱；补齐后原标识失效。生产环境必须使用强密码并通过 HTTPS 访问；不要提交 `.env`。登录连续失败 5 次后，账号会锁定 15 分钟。

## 常用命令

```bash
pnpm db:import
pnpm reminders:send -- --dry-run
pnpm reminders:send -- --dry-run
pnpm test
pnpm check
pnpm cf:typegen
pnpm exec wrangler d1 migrations apply financing --remote
git push origin main
```

生产环境可用定时任务每天执行 `pnpm reminders:send`。同一规则、目标和日期具备唯一约束，不会重复发送。

## 导入核对

导入校验只在本地样本或测试夹具上执行，不在仓库记录真实业务日期、余额、明细或现金流数量、历史范围、数据库大小或重复导入结果。

数据库采用“一张 `debts` 主表 + 多张品种扩展表”的类表继承结构。债券、收益凭证、收益权转让、同业拆借、转融资、集团借款和互换便利均有明确类型列；还本付息计划继续使用一对多表。页面上传使用文件名识别基准日，余额只追加晚于线上最大日期的快照；其他数据只插入尚不存在的稳定业务键，既有记录不再覆盖或删除。

D1 读写约束：根布局对已登录请求只读取 `data_import_state` 的基准日，未登录的登录页不读取业务数据；Excel 预检复用快照计数，不再对每个分片执行全表 `COUNT(*)`。会话访问时间最多每 15 分钟写入一次，过期会话只在创建新会话时清理。
