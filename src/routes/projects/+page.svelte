<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import {
		ArrowRight,
		CalendarDays,
		CheckCircle2,
		ChevronDown,
		ChevronRight,
		CircleDashed,
		Clock3,
		Filter,
		Flag,
		LoaderCircle,
		Plus,
		Search,
		Users
	} from '@lucide/svelte';
	import MultiSelectFilter from '$lib/MultiSelectFilter.svelte';

	let { data } = $props();
	let selectedTypes = $state<string[]>([]);
	let selectedOwners = $state<string[]>([]);
	let selectedStatuses = $state<string[]>([]);
	let view = $state<'month' | 'quarter'>('month');
	let expandedProject = $state<string | number | null>(null);
	let newProjectDialog: HTMLDialogElement;
	let createState = $state<{ pending: boolean; success: boolean; message: string }>({
		pending: false,
		success: false,
		message: ''
	});

	const enhanceCreate: SubmitFunction = () => {
		createState = { pending: true, success: false, message: '正在创建项目…' };
		return async ({ result, update }) => {
			await update();
			if (result.type === 'success') {
				createState = {
					pending: false,
					success: true,
					message: String(result.data?.message ?? '项目已创建。')
				};
				newProjectDialog?.close();
				return;
			}
			createState = {
				pending: false,
				success: false,
				message:
					result.type === 'failure'
						? String(result.data?.message ?? '创建失败，请检查填写内容后重试。')
						: '创建失败，请稍后重试。'
			};
		};
	};

	const fallbackProjects = [
		{
			id: 1,
			code: 'BOND-2026-05',
			name: '26东财证券C5',
			type: '次级债',
			owner: '王岚',
			status: '材料准备',
			progress: 42,
			start: '2026-07-22',
			end: '2026-08-25',
			startPct: 5,
			widthPct: 48,
			tone: 'blue',
			nextNode: '发行方案定稿',
			dueText: '明天',
			members: ['王', '陈', '周'],
			tasks: [
				{ name: '立项审批', status: 'done', startPct: 5, widthPct: 8 },
				{ name: '中介机构选聘', status: 'done', startPct: 13, widthPct: 12 },
				{ name: '申报材料准备', status: 'doing', startPct: 25, widthPct: 18 },
				{ name: '发行方案定稿', status: 'waiting', startPct: 43, widthPct: 10 }
			]
		},
		{
			id: 2,
			code: 'CP-2026-03',
			name: '26东财证券CP003',
			type: '短期融资券',
			owner: '陈语桐',
			status: '监管反馈',
			progress: 68,
			start: '2026-07-09',
			end: '2026-08-13',
			startPct: 0,
			widthPct: 34,
			tone: 'teal',
			nextNode: '反馈回复确认',
			dueText: '8月1日',
			members: ['陈', '李', '赵'],
			tasks: []
		},
		{
			id: 3,
			code: 'SFC-2026-07',
			name: '转融资续作 2026-07',
			type: '转融资',
			owner: '周明远',
			status: '发行执行',
			progress: 82,
			start: '2026-07-18',
			end: '2026-08-11',
			startPct: 2,
			widthPct: 27,
			tone: 'violet',
			nextNode: '资金到账确认',
			dueText: '8月11日',
			members: ['周', '陈'],
			tasks: []
		},
		{
			id: 4,
			code: 'IBL-2026-08',
			name: '8月同业拆借滚动续作',
			type: '同业拆借',
			owner: '李乐',
			status: '需求确认',
			progress: 25,
			start: '2026-07-28',
			end: '2026-08-07',
			startPct: 15,
			widthPct: 18,
			tone: 'orange',
			nextNode: '交易对手询价',
			dueText: '7月31日',
			members: ['李', '赵'],
			tasks: []
		},
		{
			id: 5,
			code: 'BOND-2026-04',
			name: '26东财证券债04',
			type: '小公募',
			owner: '王岚',
			status: '已完成',
			progress: 100,
			start: '2026-06-30',
			end: '2026-07-24',
			startPct: 0,
			widthPct: 12,
			tone: 'gray',
			nextNode: '发行总结归档',
			dueText: '已完成',
			members: ['王', '陈', '周'],
			tasks: []
		}
	];

	const projects = $derived(data?.projects ?? fallbackProjects);
	const visibleProjects = $derived(
		projects.filter(
			(project: (typeof fallbackProjects)[number]) =>
				(selectedTypes.length === 0 || selectedTypes.includes(project.type)) &&
				(selectedOwners.length === 0 || selectedOwners.includes(project.owner)) &&
				(selectedStatuses.length === 0 || selectedStatuses.includes(project.status))
		)
	);
	const summary = $derived({
		inProgress: projects.filter((project: (typeof fallbackProjects)[number]) => project.progress < 100).length,
		dueThisWeek: projects.filter((project: (typeof fallbackProjects)[number]) =>
			['今天', '明天', '2天后', '3天后', '4天后', '5天后', '6天后', '7天后'].includes(project.dueText)
		).length,
		atRisk: projects.filter((project: (typeof fallbackProjects)[number]) => project.tone === 'orange').length,
		completed: projects.filter((project: (typeof fallbackProjects)[number]) => project.progress === 100).length
	});
	const projectTypes = $derived([
		...new Set<string>(
			projects.map((project: (typeof fallbackProjects)[number]) => String(project.type))
		)
	]);
	const projectOwners = $derived([
		...new Set<string>(
			projects.map((project: (typeof fallbackProjects)[number]) => String(project.owner))
		)
	]);
	const projectStatuses = $derived([
		...new Set<string>(
			projects.map((project: (typeof fallbackProjects)[number]) => String(project.status))
		)
	]);

	const weeks = ['7/20', '7/27', '8/3', '8/10', '8/17', '8/24'];
</script>

<svelte:head>
	<title>项目进度 · 融资工作台</title>
</svelte:head>

<section class="page-heading">
	<div>
		<p class="eyebrow">PROJECT PORTFOLIO</p>
		<h1>项目进度</h1>
		<p>以 SOP 节点为主线，跟踪全部融资项目的执行状态</p>
	</div>
	<button class="primary-action" type="button" onclick={() => newProjectDialog.showModal()}>
		<Plus size={16} />
		新建项目
	</button>
</section>

{#if createState.message}
	<p class:success={createState.success} class="action-feedback" role={createState.success ? 'status' : 'alert'}>
		{createState.message}
	</p>
{/if}

<section class="summary-strip" aria-label="项目汇总">
	<div>
		<span class="summary-icon blue"><CircleDashed size={17} /></span>
		<p><strong>{summary.inProgress}</strong><span>进行中</span></p>
	</div>
	<div>
		<span class="summary-icon orange"><Clock3 size={17} /></span>
		<p><strong>{summary.dueThisWeek}</strong><span>本周到期节点</span></p>
	</div>
	<div>
		<span class="summary-icon red"><Flag size={17} /></span>
		<p><strong>{summary.atRisk}</strong><span>存在延期风险</span></p>
	</div>
	<div>
		<span class="summary-icon green"><CheckCircle2 size={17} /></span>
		<p><strong>{summary.completed}</strong><span>本月已完成</span></p>
	</div>
</section>

<section class="toolbar" aria-label="甘特图筛选">
	<div class="search-field">
		<Search size={15} />
		<input aria-label="搜索项目" placeholder="搜索项目名称或编号" />
	</div>
	<div class="select-group">
		<Filter size={14} />
		<MultiSelectFilter
			label="负债品种"
			options={projectTypes}
			bind:values={selectedTypes}
			allLabel="全部品种"
		/>
		<MultiSelectFilter
			label="负责人"
			options={projectOwners}
			bind:values={selectedOwners}
			allLabel="全部人员"
		/>
		<MultiSelectFilter
			label="项目状态"
			options={projectStatuses}
			bind:values={selectedStatuses}
			allLabel="全部状态"
		/>
	</div>
	<div class="view-switcher" aria-label="时间视图">
		<button class:active={view === 'month'} type="button" onclick={() => (view = 'month')}>月</button>
		<button class:active={view === 'quarter'} type="button" onclick={() => (view = 'quarter')}
			>季</button
		>
	</div>
</section>

<section class="gantt-panel">
	<div class="gantt-head">
		<div class="project-column-title">项目 / 负责人</div>
		<div class="status-column-title">状态</div>
		<div class="timeline-head">
			<div class="month-band"><span>2026年7月</span><span>2026年8月</span></div>
			<div class="week-band">
				{#each weeks as week}
					<span>{week}</span>
				{/each}
			</div>
		</div>
	</div>

	<div class="gantt-body">
		{#each visibleProjects as project}
			<div class:expanded={expandedProject === project.id} class="project-row">
				<div class="project-info">
					<button
						class="expand-button"
						type="button"
						aria-label={`${expandedProject === project.id ? '收起' : '展开'} ${project.name}`}
						onclick={() => (expandedProject = expandedProject === project.id ? null : project.id)}
					>
						{#if expandedProject === project.id}
							<ChevronDown size={15} />
						{:else}
							<ChevronRight size={15} />
						{/if}
					</button>
					<div>
						<a href={`/projects/${project.id}`}>{project.name}</a>
						<p>
							<span>{project.code}</span>
							<i></i>
							<span>{project.type}</span>
						</p>
					</div>
					<div class="project-people" aria-label={`项目成员 ${project.members.join('、')}`}>
						{#each project.members.slice(0, 3) as member, index}
							<span style:z-index={3 - index}>{member}</span>
						{/each}
					</div>
				</div>
				<div class="project-status">
					<span class={`status-pill ${project.tone}`}>{project.status}</span>
					<div class="progress-line">
						<span style:width={`${project.progress}%`}></span>
					</div>
					<small>{project.progress}%</small>
				</div>
				<div class="timeline-cell">
					<div class="today-line"><span>今天</span></div>
					<div
						class={`project-bar ${project.tone}`}
						style:left={`${project.startPct}%`}
						style:width={`${project.widthPct}%`}
						title={`${project.name}：${project.start} 至 ${project.end}`}
					>
						<span>{project.progress}%</span>
					</div>
					<div class="next-node" style:left={`${Math.min(project.startPct + project.widthPct + 2, 84)}%`}>
						<i></i>
						<span>{project.nextNode}</span>
					</div>
				</div>
				<div class="mobile-project-meta">
					<div><CalendarDays size={14} /> {project.start} — {project.end}</div>
					<div><Users size={14} /> {project.owner} · {project.members.length}人</div>
					<div><Clock3 size={14} /> 下一节点：{project.nextNode}（{project.dueText}）</div>
				</div>
			</div>

			{#if expandedProject === project.id && project.tasks.length > 0}
				<div class="task-rows">
					{#each project.tasks as task, index}
						<div class="task-row">
							<div class="task-info">
								<span class={`task-dot ${task.status}`}></span>
								<span>{index + 1}. {task.name}</span>
							</div>
							<div class="task-status">
								{task.status === 'done' ? '已完成' : task.status === 'doing' ? '进行中' : '待开始'}
							</div>
							<div class="task-timeline">
								<div
									class={`task-bar ${task.status}`}
									style:left={`${task.startPct}%`}
									style:width={`${task.widthPct}%`}
								></div>
							</div>
						</div>
					{/each}
					<a class="project-detail-link" href={`/projects/${project.id}`}>
						查看项目详情与全部任务 <ArrowRight size={13} />
					</a>
				</div>
			{/if}
		{/each}
	</div>
</section>

<section class="below-grid">
	<article class="insight-card">
		<div class="insight-top">
			<span class="summary-icon orange"><Flag size={17} /></span>
			<div>
				<h2>待办与预警</h2>
				<p>从原仪表盘迁入，由节点完成度与截止时间判断</p>
			</div>
		</div>
		{#if data.attention}
			<a href={data.attention.href}>
				<div>
					<strong>{data.attention.title}</strong>
					<p>{data.attention.meta}</p>
				</div>
				<span>{data.attention.date}</span>
			</a>
		{:else}
			<p class="empty-insight">未来 7 天暂无需要关注的事件</p>
		{/if}
	</article>
	<article class="insight-card">
		<div class="insight-top">
			<span class="summary-icon blue"><CalendarDays size={17} /></span>
			<div>
				<h2>未来 7 天</h2>
				<p>共 {data.upcoming.length} 个任务、付息或到期事件</p>
			</div>
		</div>
		<div class="upcoming-list">
			{#each data.upcoming.slice(0, 5) as event}
				<a href={event.href}>
					<i class={event.tone}></i>
					{event.shortTitle}
					<small>{event.date}</small>
				</a>
			{:else}
				<p class="empty-insight">未来 7 天暂无事件</p>
			{/each}
		</div>
	</article>
</section>

<dialog class="new-project-modal" bind:this={newProjectDialog}>
	<form method="post" action="?/createProject" use:enhance={enhanceCreate}>
		<div class="modal-header">
			<div>
				<p class="eyebrow">NEW PROJECT</p>
				<h2>新建融资项目</h2>
				<p>选择负债品种后，将自动套用对应 SOP 节点。</p>
			</div>
			<button type="button" aria-label="关闭" onclick={() => newProjectDialog.close()}>×</button>
		</div>
		<div class="form-grid">
			<label class="wide">
				<span>项目名称</span>
				<input name="name" required placeholder="例如：26东财证券C6" />
			</label>
			<label>
				<span>负债品种</span>
				<select name="debtType" required>
					<option value="">请选择</option>
					{#each data.activeSopDebtTypes as debtType}
						<option>{debtType}</option>
					{/each}
				</select>
			</label>
			<label>
				<span>负责人</span>
				<select name="owner" required>
					{#each data.people as person}
						<option>{person.name}</option>
					{/each}
				</select>
			</label>
			<label>
				<span>计划开始</span>
				<input name="startDate" type="date" value={data.today} required />
			</label>
			<label>
				<span>计划完成</span>
				<input name="endDate" type="date" value="2026-09-30" required />
			</label>
		</div>
		<div class="modal-note">
			<CheckCircle2 size={15} />
			<span>创建后可继续分配参与人员，并调整每个 SOP 节点的时间。</span>
		</div>
		<div class="modal-actions">
			<button type="button" disabled={createState.pending} onclick={() => newProjectDialog.close()}>取消</button>
			<button class="primary-action" type="submit" disabled={createState.pending}>
				{#if createState.pending}<LoaderCircle class="spin" size={16} />{/if}
				{createState.pending ? '创建中…' : '创建项目'}
			</button>
		</div>
	</form>
</dialog>

<style>
	.page-heading {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 1.25rem;
		margin-bottom: 1.125rem;
	}

	.eyebrow {
		margin: 0 0 0.25rem;
		font-size: 0.75rem !important;
		font-weight: 800;
		letter-spacing: 0.16em;
		color: #2f6fed !important;
	}

	.page-heading h1 {
		margin: 0;
		font-size: clamp(1.5rem, 2vw, 1.875rem);
		font-weight: 730;
		letter-spacing: -0.035em;
		color: #101828;
	}

	.page-heading p {
		margin: 0.3125rem 0 0;
		font-size: 1rem;
		color: #667085;
	}

	.primary-action {
		display: inline-flex;
		min-height: 2.375rem;
		align-items: center;
		justify-content: center;
		gap: 0.4375rem;
		padding: 0 0.8125rem;
		border: 1px solid #2f6fed;
		border-radius: 0.5rem;
		font-size: 1rem;
		font-weight: 650;
		color: #fff;
		background: #2f6fed;
		box-shadow: 0 1px 2px rgb(47 111 237 / 20%);
		cursor: pointer;
		transition: background 180ms ease;
	}

	.primary-action:hover {
		background: #245fd3;
	}

	.primary-action:disabled,
	.modal-actions button:disabled {
		opacity: 0.6;
		cursor: wait;
	}

	.action-feedback {
		margin: 0 0 0.75rem;
		padding: 0.75rem 1rem;
		border: 1px solid #fecdca;
		border-radius: 0.5rem;
		font-size: 1rem;
		color: #b42318;
		background: #fef3f2;
	}

	.action-feedback.success {
		border-color: #abefc6;
		color: #067647;
		background: #ecfdf3;
	}

	.spin {
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(1turn);
		}
	}

	.summary-strip {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		margin-bottom: 0.75rem;
		border: 1px solid #e4e7ec;
		border-radius: 0.625rem;
		background: #fff;
		box-shadow: 0 1px 2px rgb(16 24 40 / 4%);
	}

	.summary-strip > div {
		display: flex;
		align-items: center;
		gap: 0.6875rem;
		min-height: 4.625rem;
		padding: 0.75rem 1.125rem;
		border-right: 1px solid #eaecf0;
	}

	.summary-strip > div:last-child {
		border-right: 0;
	}

	.summary-icon {
		display: grid;
		width: 2.125rem;
		height: 2.125rem;
		flex: 0 0 auto;
		place-items: center;
		border-radius: 0.5rem;
	}

	.summary-icon.blue {
		color: #2f6fed;
		background: #edf4ff;
	}

	.summary-icon.orange {
		color: #dc6803;
		background: #fff4e8;
	}

	.summary-icon.red {
		color: #d92d20;
		background: #fef3f2;
	}

	.summary-icon.green {
		color: #079455;
		background: #ecfdf3;
	}

	.summary-strip p {
		display: grid;
		margin: 0;
	}

	.summary-strip strong {
		font-family: 'SFMono-Regular', Consolas, monospace;
		font-size: 1.25rem;
		line-height: 1.1;
		color: #101828;
	}

	.summary-strip p span {
		margin-top: 0.1875rem;
		font-size: 0.75rem;
		color: #98a2b3;
	}

	.toolbar {
		display: flex;
		min-height: 3.375rem;
		align-items: center;
		gap: 0.625rem;
		margin-bottom: 0.75rem;
		padding: 0.5625rem 0.75rem;
		border: 1px solid #e4e7ec;
		border-radius: 0.625rem;
		background: #fff;
	}

	.search-field {
		display: flex;
		height: 2.125rem;
		width: 15rem;
		align-items: center;
		gap: 0.4375rem;
		padding: 0 0.625rem;
		border: 1px solid #d0d5dd;
		border-radius: 0.4375rem;
		color: #98a2b3;
	}

	.search-field input {
		width: 100%;
		border: 0;
		outline: 0;
		font-size: 0.75rem;
		color: #344054;
		background: transparent;
	}

	.select-group {
		display: flex;
		align-items: center;
		gap: 0.4375rem;
		color: #98a2b3;
	}

	.select-group :global(.multi-filter) {
		flex: 1 1 10rem;
	}

	.view-switcher {
		display: flex;
		height: 2.125rem;
		margin-left: auto;
		padding: 0.1875rem;
		border: 1px solid #d0d5dd;
		border-radius: 0.4375rem;
		background: #f9fafb;
	}

	.view-switcher button {
		min-width: 2rem;
		border: 0;
		border-radius: 0.3125rem;
		font-size: 0.75rem;
		color: #667085;
		background: transparent;
		cursor: pointer;
	}

	.view-switcher button.active {
		color: #175cd3;
		background: #fff;
		box-shadow: 0 1px 2px rgb(16 24 40 / 10%);
	}

	.gantt-panel {
		overflow: hidden;
		margin-bottom: 0.75rem;
		border: 1px solid #dfe3e8;
		border-radius: 0.6875rem;
		background: #fff;
		box-shadow: 0 1px 2px rgb(16 24 40 / 4%);
	}

	.gantt-head,
	.project-row,
	.task-row {
		display: grid;
		grid-template-columns: minmax(17.5rem, 30%) 7.875rem minmax(32.5rem, 1fr);
	}

	.gantt-head {
		min-height: 4.25rem;
		border-bottom: 1px solid #dfe3e8;
		font-size: 0.75rem;
		font-weight: 700;
		color: #667085;
		background: #f8fafc;
	}

	.project-column-title,
	.status-column-title {
		display: flex;
		align-items: center;
		padding: 0 1rem;
		border-right: 1px solid #e4e7ec;
	}

	.timeline-head {
		min-width: 0;
	}

	.month-band,
	.week-band {
		display: grid;
		align-items: center;
		text-align: center;
	}

	.month-band {
		height: 2rem;
		grid-template-columns: 1fr 2fr;
		border-bottom: 1px solid #e4e7ec;
	}

	.month-band span {
		height: 100%;
		padding-top: 0.5625rem;
		border-right: 1px solid #e4e7ec;
	}

	.month-band span:last-child {
		border-right: 0;
	}

	.week-band {
		height: 2.1875rem;
		grid-template-columns: repeat(6, 1fr);
	}

	.week-band span {
		height: 100%;
		padding-top: 0.625rem;
		border-right: 1px solid #eaecf0;
		font-weight: 500;
	}

	.project-row {
		position: relative;
		min-height: 4.9375rem;
		border-bottom: 1px solid #eaecf0;
		transition: background 180ms ease;
	}

	.project-row:hover,
	.project-row.expanded {
		background: #fbfcfe;
	}

	.project-info {
		display: flex;
		min-width: 0;
		align-items: center;
		gap: 0.5rem;
		padding: 0.6875rem 0.875rem 0.6875rem 0.5rem;
		border-right: 1px solid #eaecf0;
	}

	.expand-button {
		display: grid;
		width: 1.6875rem;
		height: 1.875rem;
		flex: 0 0 auto;
		place-items: center;
		border: 0;
		border-radius: 0.3125rem;
		color: #98a2b3;
		background: transparent;
		cursor: pointer;
	}

	.expand-button:hover {
		color: #2f6fed;
		background: #edf4ff;
	}

	.project-info > div:nth-child(2) {
		min-width: 0;
	}

	.project-info a {
		display: block;
		overflow: hidden;
		font-size: 0.75rem;
		font-weight: 700;
		color: #1d2939;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.project-info a:hover {
		color: #2f6fed;
	}

	.project-info p {
		display: flex;
		align-items: center;
		gap: 0.3125rem;
		margin: 0.25rem 0 0;
		font-size: 0.75rem;
		color: #98a2b3;
	}

	.project-info p i {
		width: 2px;
		height: 2px;
		border-radius: 50%;
		background: #cbd0d8;
	}

	.project-people {
		display: flex;
		margin-left: auto;
		padding-left: 0.5rem;
	}

	.project-people span {
		display: grid;
		width: 1.5rem;
		height: 1.5rem;
		margin-left: -0.375rem;
		place-items: center;
		border: 2px solid #fff;
		border-radius: 50%;
		font-size: 0.75rem;
		font-weight: 700;
		color: #175cd3;
		background: #e9f1ff;
	}

	.project-status {
		display: grid;
		grid-template-columns: 1fr auto;
		align-content: center;
		gap: 0.375rem 0.4375rem;
		padding: 0.625rem 0.8125rem;
		border-right: 1px solid #eaecf0;
	}

	.status-pill {
		grid-column: 1 / -1;
		justify-self: start;
		padding: 0.25rem 0.4375rem;
		border: 1px solid #d6e4ff;
		border-radius: 0.3125rem;
		font-size: 0.75rem;
		font-weight: 700;
		color: #175cd3;
		background: #eff4ff;
	}

	.status-pill.teal {
		border-color: #a6f4c5;
		color: #067647;
		background: #ecfdf3;
	}

	.status-pill.violet {
		border-color: #d9d6fe;
		color: #5925dc;
		background: #f4f3ff;
	}

	.status-pill.orange {
		border-color: #fedf89;
		color: #b54708;
		background: #fffaeb;
	}

	.status-pill.gray {
		border-color: #e4e7ec;
		color: #475467;
		background: #f9fafb;
	}

	.progress-line {
		height: 0.1875rem;
		align-self: center;
		overflow: hidden;
		border-radius: 6.1875rem;
		background: #eaecf0;
	}

	.progress-line span {
		display: block;
		height: 100%;
		border-radius: inherit;
		background: #2f6fed;
	}

	.project-status small {
		font-size: 0.75rem;
		color: #98a2b3;
	}

	.timeline-cell,
	.task-timeline {
		position: relative;
		overflow: hidden;
		background-image: repeating-linear-gradient(
			to right,
			transparent 0,
			transparent calc(16.666% - 1px),
			#eef0f3 calc(16.666% - 1px),
			#eef0f3 16.666%
		);
	}

	.today-line {
		position: absolute;
		z-index: 2;
		top: 0;
		bottom: 0;
		left: 22%;
		width: 1px;
		background: #f04438;
	}

	.today-line span {
		position: absolute;
		top: 0.25rem;
		left: 0.25rem;
		padding: 1px 0.25rem;
		border-radius: 0.1875rem;
		font-size: 0.75rem;
		font-weight: 700;
		color: #b42318;
		background: #fef3f2;
	}

	.project-bar {
		position: absolute;
		z-index: 1;
		top: 1.875rem;
		height: 1.25rem;
		min-width: 1rem;
		overflow: hidden;
		border-radius: 0.3125rem;
		background: linear-gradient(90deg, #356ee0, #5d8cf0);
		box-shadow: 0 2px 0.3125rem rgb(47 111 237 / 18%);
	}

	.project-bar.teal {
		background: linear-gradient(90deg, #0e9384, #38b8a8);
	}

	.project-bar.violet {
		background: linear-gradient(90deg, #6941c6, #875bf7);
	}

	.project-bar.orange {
		background: linear-gradient(90deg, #dc6803, #f79009);
	}

	.project-bar.gray {
		background: linear-gradient(90deg, #667085, #98a2b3);
	}

	.project-bar span {
		display: block;
		padding: 0.25rem 0.4375rem;
		font-size: 0.75rem;
		font-weight: 700;
		color: #fff;
	}

	.next-node {
		position: absolute;
		top: 3.375rem;
		display: flex;
		align-items: center;
		gap: 0.25rem;
		font-size: 0.75rem;
		color: #667085;
		white-space: nowrap;
	}

	.next-node i {
		width: 0.375rem;
		height: 0.375rem;
		border: 2px solid #2f6fed;
		border-radius: 50%;
		background: #fff;
	}

	.mobile-project-meta {
		display: none;
	}

	.task-rows {
		border-bottom: 1px solid #dfe3e8;
		background: #f9fbfd;
	}

	.task-row {
		min-height: 2.4375rem;
		color: #667085;
	}

	.task-info,
	.task-status {
		display: flex;
		align-items: center;
		border-right: 1px solid #eaecf0;
		font-size: 0.75rem;
	}

	.task-info {
		gap: 0.4375rem;
		padding-left: 3.125rem;
	}

	.task-status {
		padding-left: 0.875rem;
	}

	.task-dot {
		width: 0.4375rem;
		height: 0.4375rem;
		border: 2px solid #98a2b3;
		border-radius: 50%;
	}

	.task-dot.done {
		border-color: #12b76a;
		background: #12b76a;
	}

	.task-dot.doing {
		border-color: #2f6fed;
		background: #dbe8ff;
	}

	.task-bar {
		position: absolute;
		top: 0.9375rem;
		height: 0.5rem;
		border-radius: 6.1875rem;
		background: #98a2b3;
	}

	.task-bar.done {
		background: #12b76a;
	}

	.task-bar.doing {
		background: #2f6fed;
	}

	.project-detail-link {
		display: flex;
		min-height: 2.125rem;
		align-items: center;
		justify-content: center;
		gap: 0.25rem;
		border-top: 1px solid #eef0f3;
		font-size: 0.75rem;
		font-weight: 650;
		color: #2f6fed;
	}

	.below-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.75rem;
	}

	.insight-card {
		border: 1px solid #e4e7ec;
		border-radius: 0.625rem;
		background: #fff;
		box-shadow: 0 1px 2px rgb(16 24 40 / 4%);
	}

	.insight-top {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		padding: 0.8125rem 0.9375rem;
		border-bottom: 1px solid #eaecf0;
	}

	.insight-top h2 {
		margin: 0;
		font-size: 0.75rem;
		color: #1d2939;
	}

	.insight-top p {
		margin: 0.1875rem 0 0;
		font-size: 0.75rem;
		color: #98a2b3;
	}

	.insight-card > a {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.8125rem 0.9375rem;
	}

	.insight-card > a strong {
		font-size: 0.75rem;
		color: #344054;
	}

	.insight-card > a p {
		margin: 0.1875rem 0 0;
		font-size: 0.75rem;
		color: #98a2b3;
	}

	.insight-card > a > span {
		padding: 0.25rem 0.4375rem;
		border-radius: 0.3125rem;
		font-size: 0.75rem;
		font-weight: 700;
		color: #b42318;
		background: #fef3f2;
	}

	.upcoming-list {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 0.5rem;
		padding: 0.875rem 0.9375rem;
	}

	.upcoming-list > a {
		display: grid;
		grid-template-columns: auto 1fr;
		align-items: center;
		gap: 0.3125rem;
		font-size: 0.75rem;
		color: #475467;
		transition: color 180ms ease;
	}

	.upcoming-list > a:hover {
		color: #175cd3;
	}

	.upcoming-list i {
		width: 0.375rem;
		height: 0.375rem;
		border-radius: 2px;
		background: #2f6fed;
	}

	.upcoming-list i.teal {
		background: #0e9384;
	}

	.upcoming-list i.violet {
		background: #6941c6;
	}

	.upcoming-list i.red {
		background: #d92d20;
	}

	.upcoming-list i.orange {
		background: #dc6803;
	}

	.upcoming-list small {
		grid-column: 2;
		font-size: 0.75rem;
		color: #98a2b3;
	}

	.empty-insight {
		margin: 0;
		padding: 0.875rem 0.9375rem;
		font-size: 1rem;
		color: #667085;
	}

	.new-project-modal {
		width: min(35rem, calc(100vw - 2rem));
		padding: 0;
		border: 0;
		border-radius: 0.8125rem;
		color: #1d2939;
		background: #fff;
		box-shadow: 0 1.5rem 3rem rgb(16 24 40 / 22%);
	}

	.new-project-modal::backdrop {
		background: rgb(10 18 31 / 55%);
		backdrop-filter: blur(2px);
	}

	.new-project-modal form {
		padding: 1.25rem;
	}

	.modal-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		padding-bottom: 0.9375rem;
		border-bottom: 1px solid #eaecf0;
	}

	.modal-header h2 {
		margin: 0;
		font-size: 1.125rem;
	}

	.modal-header p:not(.eyebrow) {
		margin: 0.3125rem 0 0;
		font-size: 0.75rem;
		color: #667085;
	}

	.modal-header button {
		display: grid;
		width: 2.125rem;
		height: 2.125rem;
		place-items: center;
		border: 0;
		border-radius: 0.375rem;
		font-size: 1.375rem;
		color: #667085;
		background: #f2f4f7;
		cursor: pointer;
	}

	.form-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.8125rem;
		padding: 1.0625rem 0;
	}

	.form-grid label {
		display: grid;
		gap: 0.3125rem;
	}

	.form-grid label.wide {
		grid-column: 1 / -1;
	}

	.form-grid label span {
		font-size: 0.75rem;
		font-weight: 650;
		color: #475467;
	}

	.form-grid input,
	.form-grid select {
		height: 2.375rem;
		padding: 0 0.625rem;
		border: 1px solid #d0d5dd;
		border-radius: 0.4375rem;
		font-size: 0.75rem;
		color: #344054;
		background: #fff;
	}

	.modal-note {
		display: flex;
		align-items: center;
		gap: 0.4375rem;
		padding: 0.5625rem 0.625rem;
		border-radius: 0.4375rem;
		font-size: 0.75rem;
		color: #175cd3;
		background: #eff4ff;
	}

	.modal-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
		padding-top: 1rem;
	}

	.modal-actions > button:first-child {
		min-height: 2.375rem;
		padding: 0 0.8125rem;
		border: 1px solid #d0d5dd;
		border-radius: 0.5rem;
		font-size: 0.75rem;
		color: #475467;
		background: #fff;
		cursor: pointer;
	}

	@media (max-width: 75rem) {
		.gantt-panel {
			overflow-x: auto;
		}

		.gantt-head,
		.project-row,
		.task-row {
			min-width: 65.625rem;
		}

		.select-group :global(svg) {
			display: none;
		}
	}

	@media (max-width: 51.25rem) {
		.summary-strip {
			grid-template-columns: 1fr 1fr;
		}

		.summary-strip > div:nth-child(2) {
			border-right: 0;
		}

		.summary-strip > div:nth-child(-n + 2) {
			border-bottom: 1px solid #eaecf0;
		}

		.toolbar {
			flex-wrap: wrap;
		}

		.search-field {
			flex: 1 1 13.75rem;
		}

		.select-group {
			order: 3;
			width: 100%;
		}

		.gantt-panel {
			overflow: visible;
			border: 0;
			background: transparent;
			box-shadow: none;
		}

		.gantt-head {
			display: none;
		}

		.project-row {
			display: grid;
			min-width: 0;
			grid-template-columns: minmax(0, 1fr) 6.625rem;
			margin-bottom: 0.5625rem;
			border: 1px solid #e4e7ec;
			border-radius: 0.625rem;
			background: #fff;
			box-shadow: 0 1px 2px rgb(16 24 40 / 4%);
		}

		.project-info,
		.project-status {
			border-right: 0;
		}

		.timeline-cell {
			display: none;
		}

		.mobile-project-meta {
			display: grid;
			grid-column: 1 / -1;
			gap: 0.3125rem;
			padding: 0.625rem 0.875rem;
			border-top: 1px solid #eaecf0;
			font-size: 0.75rem;
			color: #667085;
			background: #f9fafb;
		}

		.mobile-project-meta div {
			display: flex;
			align-items: center;
			gap: 0.3125rem;
		}

		.task-rows {
			display: none;
		}

		.below-grid {
			grid-template-columns: 1fr;
		}
	}

	@media (max-width: 35rem) {
		.page-heading {
			align-items: flex-start;
		}

		.page-heading .primary-action {
			padding: 0 0.625rem;
			font-size: 0;
		}

		.page-heading .primary-action :global(svg) {
			margin: 0;
		}

		.summary-strip > div {
			padding: 0.625rem 0.75rem;
		}

		.select-group {
			display: grid;
			grid-template-columns: 1fr 1fr;
		}

		.select-group :global(.multi-filter:last-child) {
			grid-column: 1 / -1;
		}

		.upcoming-list {
			grid-template-columns: 1fr;
		}

		.form-grid {
			grid-template-columns: 1fr;
		}

		.form-grid label.wide {
			grid-column: auto;
		}
	}
</style>
