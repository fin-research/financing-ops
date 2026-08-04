<script lang="ts">
	import {
		ArrowDownRight,
		ArrowRight,
		ArrowUpRight,
		Banknote,
		BellRing,
		CalendarClock,
		CheckCircle2,
		ChevronLeft,
		ChevronRight,
		CircleDollarSign,
		Clock3,
		Filter,
		Landmark,
		RefreshCw,
		TrendingDown,
		Upload
	} from '@lucide/svelte';
	import MultiSelectFilter from '$lib/MultiSelectFilter.svelte';

	let { data } = $props();
	let selectedTypes = $state<string[]>([]);
	let selectedOwners = $state<string[]>([]);

	const fallback = {
		asOfDate: '2026-07-27',
		kpis: {
			outstandingBalanceYi: 1180.7206,
			weightedRate: 1.72,
			maturity30dYi: 69.404,
			activeProjects: 8
		},
		composition: [
			{ type: '小公募', amountYi: 447, share: 37.858, color: '#2f6fed' },
			{ type: '短期融资券', amountYi: 313, share: 26.509, color: '#16a394' },
			{ type: '收益凭证', amountYi: 244.2206, share: 20.684, color: '#6941c6' },
			{ type: '转融资', amountYi: 58.5, share: 4.954, color: '#f79009' },
			{ type: '其他', amountYi: 118, share: 9.995, color: '#98a2b3' }
		],
		allBalances: [
			{ type: '小公募', amountYi: 447, color: '#2f6fed' },
			{ type: '短期融资券', amountYi: 313, color: '#16a394' },
			{ type: '收益凭证', amountYi: 244.2206, color: '#6941c6' },
			{ type: '转融资', amountYi: 58.5, color: '#f79009' },
			{ type: '次级债', amountYi: 54, color: '#98a2b3' }
		],
		projectCounts: [
			{ type: '次级债', owner: '王岚', active: true },
			{ type: '短期融资券', owner: '陈语桐', active: true }
		],
		today: '2026-07-28',
		calendarMonthLabel: '2026年 7月',
		alerts: [],
		calendarCells: [],
		maturityLadder: [
			{ label: '8月', amountYi: 41.3, height: 82, tone: 'critical' },
			{ label: '9月', amountYi: 18.6, height: 37, tone: 'normal' },
			{ label: '10月', amountYi: 25.4, height: 50, tone: 'normal' },
			{ label: '11月', amountYi: 12.2, height: 24, tone: 'normal' },
			{ label: '12月', amountYi: 37.7, height: 75, tone: 'warning' },
			{ label: '27年1月', amountYi: 28.4, height: 56, tone: 'normal' }
		]
	};

	const dashboard = $derived(data?.dashboard ?? fallback);
	const typeOptions = $derived(
		dashboard.allBalances.map((item: { type: string }) => item.type)
	);
	const composition = $derived(
		selectedTypes.length === 0
			? dashboard.composition
			: dashboard.allBalances
					.filter((item: { type: string }) => selectedTypes.includes(item.type))
					.map((item: { type: string; amountYi: number; color: string }) => ({
						...item,
						share:
							dashboard.allBalances
								.filter((balance: { type: string }) => selectedTypes.includes(balance.type))
								.reduce(
									(sum: number, balance: { amountYi: number }) => sum + balance.amountYi,
									0
								) > 0
								? (item.amountYi /
										dashboard.allBalances
											.filter((balance: { type: string }) => selectedTypes.includes(balance.type))
											.reduce(
												(sum: number, balance: { amountYi: number }) => sum + balance.amountYi,
												0
											)) *
									100
								: 0
					}))
	);
	const outstandingBalanceYi = $derived(
		selectedTypes.length === 0
			? dashboard.kpis.outstandingBalanceYi
			: dashboard.allBalances
					.filter((item: { type: string }) => selectedTypes.includes(item.type))
					.reduce((sum: number, item: { amountYi: number }) => sum + item.amountYi, 0)
	);
	const activeProjects = $derived(
		dashboard.projectCounts.filter(
			(project: { active: boolean; type: string; owner: string }) =>
				project.active &&
				(selectedTypes.length === 0 || selectedTypes.includes(project.type)) &&
				(selectedOwners.length === 0 || selectedOwners.includes(project.owner))
		).length
	);
	const ownerOptions = $derived([
		...new Set<string>(
			dashboard.projectCounts.map((project: { owner: string }) => project.owner)
		)
	]);
	const matchesFilters = (item: { debtType?: string | null; owner?: string | null }) =>
		(selectedTypes.length === 0 || (item.debtType != null && selectedTypes.includes(item.debtType))) &&
		(selectedOwners.length === 0 || (item.owner != null && selectedOwners.includes(item.owner)));
	const alerts = $derived(dashboard.alerts.filter(matchesFilters));
	const calendarCells = $derived(
		dashboard.calendarCells.map((cell) => ({
			...cell,
			events: cell.events.filter(matchesFilters)
		}))
	);

	const weekdayLabels = ['一', '二', '三', '四', '五', '六', '日'];
</script>

<svelte:head>
	<title>融资总览 · 融资工作台</title>
</svelte:head>

<section class="page-heading">
	<div>
		<p class="eyebrow">FINANCING OVERVIEW</p>
		<h1>融资总览</h1>
		<p>统一查看存续负债、到期安排与项目关键节点</p>
	</div>
	<div class="heading-actions">
		<button class="secondary-action" type="button">
			<RefreshCw size={15} />
			<span>刷新数据</span>
		</button>
		<a class="primary-action" href="/data">
			<Upload size={15} />
			<span>导入 Excel</span>
		</a>
	</div>
</section>

<section class="filter-bar" aria-label="仪表盘筛选">
	<div class="filter-title">
		<Filter size={15} />
		<span>筛选视图</span>
	</div>
	<MultiSelectFilter
		label="负债品种"
		options={typeOptions}
		bind:values={selectedTypes}
		allLabel="全部品种"
	/>
	<MultiSelectFilter
		label="负责人"
		options={ownerOptions}
		bind:values={selectedOwners}
		allLabel="全部人员"
	/>
	<div class="filter-meta">
		<span class="sync-dot"></span>
		数据截至 {dashboard.asOfDate}
	</div>
</section>

<section class="kpi-grid" aria-label="核心指标">
	<article class="kpi-card">
		<div class="kpi-icon blue"><CircleDollarSign size={19} /></div>
		<div class="kpi-content">
			<div class="kpi-label">
				<span>存续负债余额</span>
				<small>亿元</small>
			</div>
			<strong>{outstandingBalanceYi.toFixed(2)}</strong>
			<div class="kpi-trend neutral">
				<ArrowDownRight size={13} />
				<span>较上月末下降 2.4%</span>
			</div>
		</div>
	</article>
	<article class="kpi-card">
		<div class="kpi-icon teal"><TrendingDown size={19} /></div>
		<div class="kpi-content">
			<div class="kpi-label">
				<span>加权融资成本</span>
				<small>年化</small>
			</div>
			<strong>{dashboard.kpis.weightedRate.toFixed(2)}%</strong>
			<div class="kpi-trend good">
				<ArrowDownRight size={13} />
				<span>环比下降 5BP</span>
			</div>
		</div>
	</article>
	<article class="kpi-card">
		<div class="kpi-icon orange"><CalendarClock size={19} /></div>
		<div class="kpi-content">
			<div class="kpi-label">
				<span>未来30天到期</span>
				<small>亿元</small>
			</div>
			<strong>{dashboard.kpis.maturity30dYi.toFixed(1)}</strong>
			<div class="kpi-trend warning">
				<ArrowUpRight size={13} />
				<span>涉及 16 笔业务</span>
			</div>
		</div>
	</article>
	<article class="kpi-card">
		<div class="kpi-icon violet"><Landmark size={19} /></div>
		<div class="kpi-content">
			<div class="kpi-label">
				<span>进行中项目</span>
				<small>个</small>
			</div>
			<strong>{activeProjects}</strong>
			<div class="kpi-trend neutral">
				<CheckCircle2 size={13} />
				<span>2 个本周进入发行</span>
			</div>
		</div>
	</article>
</section>

<section class="dashboard-grid">
	<article class="panel composition-panel">
		<div class="panel-header">
			<div>
				<h2>存续负债结构</h2>
				<p>按负债品种统计余额</p>
			</div>
			<button class="text-action" type="button">查看明细 <ArrowRight size={14} /></button>
		</div>
		<div class="composition-body">
			<div
				class="donut"
				role="img"
				aria-label="存续负债结构环形图"
				style={`background: conic-gradient(${composition
					.map((item: { color: string; share: number }, index: number) => {
						const start = composition
							.slice(0, index)
							.reduce((sum: number, part: { share: number }) => sum + part.share, 0);
						return `${item.color} ${start}% ${start + item.share}%`;
					})
					.join(', ')})`}
			>
				<div class="donut-center">
					<small>总余额</small>
					<strong>{outstandingBalanceYi.toFixed(1)}</strong>
					<span>亿元</span>
				</div>
			</div>
			<div class="composition-list">
				{#each composition as item}
					<div class="composition-item">
						<div class="composition-name">
							<span class="legend-dot" style:background={item.color}></span>
							<span>{item.type}</span>
						</div>
						<div class="composition-numbers">
							<strong>{item.amountYi.toFixed(1)}亿</strong>
							<span>{item.share.toFixed(1)}%</span>
						</div>
						<div class="mini-track">
							<span style:width={`${item.share}%`} style:background={item.color}></span>
						</div>
					</div>
				{/each}
			</div>
		</div>
	</article>

	<article class="panel ladder-panel">
		<div class="panel-header">
			<div>
				<h2>到期分布</h2>
				<p>未来六个月到期本金，亿元</p>
			</div>
			<span class="panel-badge">未来 6 个月</span>
		</div>
		<div class="bar-chart" aria-label="未来六个月负债到期分布">
			<div class="chart-grid-lines">
				<span>50</span><span>40</span><span>30</span><span>20</span><span>10</span><span>0</span>
			</div>
			<div class="bars">
				{#each dashboard.maturityLadder as item}
					<div class="bar-column">
						<div class="bar-value">{item.amountYi.toFixed(1)}</div>
						<div
							class:critical={item.tone === 'critical'}
							class:warning-bar={item.tone === 'warning'}
							class="bar"
							style:height={`${item.height}%`}
						></div>
						<span>{item.label}</span>
					</div>
				{/each}
			</div>
		</div>
	</article>

	<article class="panel alerts-panel">
		<div class="panel-header">
			<div>
				<h2>待办与预警</h2>
				<p>按节点规则自动生成</p>
			</div>
			<span class="count-badge">{alerts.length}</span>
		</div>
		<div
			class="alert-list"
			role="region"
			aria-label={`待办与预警列表，共 ${alerts.length} 条`}
		>
			{#each alerts as alert}
				<a class="alert-item" href={alert.href}>
					<span class:danger={alert.level === 'danger'} class:warning={alert.level === 'warning'} class="alert-line"></span>
					<div class="alert-icon">
						{#if alert.level === 'danger'}
							<BellRing size={17} />
						{:else if alert.level === 'warning'}
							<Clock3 size={17} />
						{:else}
							<Banknote size={17} />
						{/if}
					</div>
					<div class="alert-copy">
						<div>
							<span class={`alert-kind ${alert.level}`}>{alert.kind}</span>
							<time>{alert.time}</time>
						</div>
						<strong>{alert.title}</strong>
						<p>{alert.meta}</p>
					</div>
					<ChevronRight size={15} />
				</a>
			{/each}
		</div>
		<a class="view-all" href="/projects">查看全部待办 <ArrowRight size={14} /></a>
	</article>
</section>

<section class="panel calendar-panel" id="calendar">
	<div class="calendar-header">
		<div>
			<h2>项目日历</h2>
			<p>发行、到期、付息与任务节点</p>
		</div>
		<div class="calendar-actions">
			<div class="calendar-legend">
				<span><i class="blue"></i>项目节点</span>
				<span><i class="red"></i>到期/兑付</span>
				<span><i class="orange"></i>付息</span>
			</div>
			<div class="month-switcher">
				<button type="button" aria-label="上一个月"><ChevronLeft size={16} /></button>
				<strong>{dashboard.calendarMonthLabel}</strong>
				<button type="button" aria-label="下一个月"><ChevronRight size={16} /></button>
			</div>
			<button class="today-button" type="button">今天</button>
		</div>
	</div>

	<div class="calendar-grid">
		{#each weekdayLabels as weekday}
			<div class="weekday">{weekday}</div>
		{/each}
		{#each calendarCells as cell}
			<div class:other-month={cell.other} class:today={cell.today} class="calendar-cell">
				<span class="day-number">{cell.day}</span>
				{#if cell.events.length}
					<div class="day-events">
						{#each cell.events as event}
							<a class={`calendar-event ${event.tone}`} href={event.href}>{event.shortTitle}</a>
						{/each}
					</div>
				{/if}
			</div>
		{/each}
	</div>
</section>

<style>
	:global(.page-heading) {
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

	.heading-actions {
		display: flex;
		gap: 0.5rem;
	}

	.secondary-action,
	.primary-action {
		display: inline-flex;
		min-height: 2.375rem;
		align-items: center;
		justify-content: center;
		gap: 0.4375rem;
		padding: 0 0.8125rem;
		border: 1px solid #d0d5dd;
		border-radius: 0.5rem;
		font-size: 1rem;
		font-weight: 650;
		cursor: pointer;
		transition:
			border-color 180ms ease,
			background 180ms ease,
			color 180ms ease;
	}

	.secondary-action {
		color: #344054;
		background: #fff;
	}

	.secondary-action:hover {
		border-color: #98a2b3;
		background: #f9fafb;
	}

	.primary-action {
		border-color: #2f6fed;
		color: #fff;
		background: #2f6fed;
		box-shadow: 0 1px 2px rgb(47 111 237 / 20%);
	}

	.primary-action:hover {
		background: #245fd3;
	}

	.filter-bar {
		display: flex;
		min-height: 3.25rem;
		align-items: center;
		gap: 1rem;
		margin-bottom: 1rem;
		padding: 0.5rem 0.75rem;
		border: 1px solid #e4e7ec;
		border-radius: 0.625rem;
		background: #fff;
		box-shadow: 0 1px 2px rgb(16 24 40 / 3%);
	}

	.filter-title {
		display: flex;
		align-items: center;
		gap: 0.4375rem;
		padding-right: 0.875rem;
		border-right: 1px solid #eaecf0;
		font-size: 0.75rem;
		font-weight: 700;
		color: #475467;
	}

	.filter-bar :global(.multi-filter) {
		flex: 0 1 17rem;
	}

	.filter-meta {
		display: flex;
		align-items: center;
		gap: 0.4375rem;
		margin-left: auto;
		font-size: 0.75rem;
		color: #98a2b3;
	}

	.sync-dot {
		width: 0.375rem;
		height: 0.375rem;
		border-radius: 50%;
		background: #12b76a;
	}

	.kpi-grid {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 0.75rem;
		margin-bottom: 0.75rem;
	}

	.kpi-card {
		display: flex;
		min-height: 7.875rem;
		gap: 0.8125rem;
		padding: 1.125rem;
		border: 1px solid #e4e7ec;
		border-radius: 0.6875rem;
		background: #fff;
		box-shadow: 0 1px 2px rgb(16 24 40 / 4%);
	}

	.kpi-icon {
		display: grid;
		width: 2.375rem;
		height: 2.375rem;
		flex: 0 0 auto;
		place-items: center;
		border-radius: 0.5625rem;
	}

	.kpi-icon.blue {
		color: #2f6fed;
		background: #edf4ff;
	}

	.kpi-icon.teal {
		color: #0e9384;
		background: #e8f8f5;
	}

	.kpi-icon.orange {
		color: #dc6803;
		background: #fff4e8;
	}

	.kpi-icon.violet {
		color: #6941c6;
		background: #f4f0ff;
	}

	.kpi-content {
		flex: 1;
		min-width: 0;
	}

	.kpi-label {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		font-size: 0.75rem;
		font-weight: 600;
		color: #667085;
	}

	.kpi-label small {
		font-size: 0.75rem;
		font-weight: 500;
		color: #b0b7c3;
	}

	.kpi-content > strong {
		display: block;
		margin-top: 0.4375rem;
		font-family: 'SFMono-Regular', Consolas, monospace;
		font-size: 1.5625rem;
		font-weight: 720;
		letter-spacing: -0.055em;
		color: #101828;
	}

	.kpi-trend {
		display: flex;
		align-items: center;
		gap: 0.1875rem;
		margin-top: 0.3125rem;
		font-size: 0.75rem;
		color: #667085;
	}

	.kpi-trend.good {
		color: #067647;
	}

	.kpi-trend.warning {
		color: #b54708;
	}

	.dashboard-grid {
		display: grid;
		grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr) minmax(18.75rem, 0.78fr);
		align-items: start;
		gap: 0.75rem;
		margin-bottom: 0.75rem;
	}

	.panel {
		min-width: 0;
		border: 1px solid #e4e7ec;
		border-radius: 0.6875rem;
		background: #fff;
		box-shadow: 0 1px 2px rgb(16 24 40 / 4%);
	}

	.panel-header {
		display: flex;
		min-height: 3.875rem;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.8125rem 1rem;
		border-bottom: 1px solid #eaecf0;
	}

	.panel h2 {
		margin: 0;
		font-size: 1rem;
		font-weight: 720;
		color: #1d2939;
	}

	.panel-header p,
	.calendar-header p {
		margin: 0.1875rem 0 0;
		font-size: 0.75rem;
		color: #98a2b3;
	}

	.text-action {
		display: inline-flex;
		min-height: 2.125rem;
		align-items: center;
		gap: 0.1875rem;
		padding: 0 0.375rem;
		border: 0;
		font-size: 0.75rem;
		font-weight: 600;
		color: #2f6fed;
		background: transparent;
		cursor: pointer;
	}

	.panel-badge {
		padding: 0.25rem 0.4375rem;
		border: 1px solid #dbe6fb;
		border-radius: 0.3125rem;
		font-size: 0.75rem;
		font-weight: 600;
		color: #4672c5;
		background: #f4f7fd;
	}

	.composition-body {
		display: grid;
		grid-template-columns: 9.5rem minmax(0, 1fr);
		align-items: center;
		gap: 1.375rem;
		min-height: 15rem;
		padding: 1.125rem;
	}

	.donut {
		position: relative;
		width: 9.25rem;
		aspect-ratio: 1;
		border-radius: 50%;
	}

	.donut::after {
		position: absolute;
		inset: 1.5625rem;
		border-radius: 50%;
		background: #fff;
		content: '';
	}

	.donut-center {
		position: absolute;
		inset: 0;
		z-index: 1;
		display: grid;
		place-content: center;
		text-align: center;
	}

	.donut-center small {
		font-size: 0.75rem;
		color: #98a2b3;
	}

	.donut-center strong {
		margin-top: 2px;
		font-family: 'SFMono-Regular', Consolas, monospace;
		font-size: 1.25rem;
		letter-spacing: -0.05em;
		color: #1d2939;
	}

	.donut-center span {
		font-size: 0.75rem;
		color: #667085;
	}

	.composition-list {
		display: grid;
		gap: 0.625rem;
	}

	.composition-item {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 0.3125rem 0.625rem;
		font-size: 0.75rem;
	}

	.composition-name {
		display: flex;
		align-items: center;
		gap: 0.4375rem;
		color: #475467;
	}

	.legend-dot {
		width: 0.4375rem;
		height: 0.4375rem;
		border-radius: 2px;
	}

	.composition-numbers {
		display: flex;
		gap: 0.5rem;
	}

	.composition-numbers strong {
		color: #344054;
	}

	.composition-numbers span {
		width: 2.125rem;
		text-align: right;
		color: #98a2b3;
	}

	.mini-track {
		grid-column: 1 / -1;
		height: 0.1875rem;
		overflow: hidden;
		border-radius: 6.1875rem;
		background: #f2f4f7;
	}

	.mini-track span {
		display: block;
		height: 100%;
		border-radius: inherit;
	}

	.bar-chart {
		position: relative;
		overflow: hidden;
		height: 15rem;
		padding: 1.375rem 1.125rem 1rem 3.25rem;
	}

	.chart-grid-lines {
		position: absolute;
		inset: 1.375rem 1.125rem 2.4375rem 0.75rem;
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		pointer-events: none;
	}

	.chart-grid-lines span {
		display: grid;
		grid-template-columns: 2rem minmax(0, 1fr);
		align-items: center;
		gap: 0.5rem;
		font-size: 0.75rem;
		color: #b5bcc7;
	}

	.chart-grid-lines span::after {
		border-bottom: 1px dashed #eaecf0;
		content: '';
	}

	.bars {
		position: relative;
		z-index: 1;
		display: grid;
		height: 100%;
		grid-template-columns: repeat(6, 1fr);
		align-items: end;
		gap: 0.5625rem;
	}

	.bar-column {
		display: flex;
		height: 100%;
		min-width: 0;
		flex-direction: column;
		justify-content: flex-end;
		text-align: center;
	}

	.bar-value {
		margin-bottom: 0.25rem;
		font-size: 0.75rem;
		font-weight: 650;
		color: #667085;
	}

	.bar {
		width: min(1.75rem, 74%);
		min-height: 0.5rem;
		margin: 0 auto;
		border-radius: 0.25rem 0.25rem 1px 1px;
		background: linear-gradient(180deg, #5b8df2, #2f6fed);
		box-shadow: 0 0.25rem 0.5rem rgb(47 111 237 / 11%);
	}

	.bar.critical {
		background: linear-gradient(180deg, #ef6f65, #d92d20);
		box-shadow: 0 0.25rem 0.5rem rgb(217 45 32 / 11%);
	}

	.bar.warning-bar {
		background: linear-gradient(180deg, #fdb34b, #f79009);
		box-shadow: 0 0.25rem 0.5rem rgb(247 144 9 / 12%);
	}

	.bar-column > span {
		margin-top: 0.4375rem;
		overflow: hidden;
		font-size: 0.75rem;
		color: #667085;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.count-badge {
		display: grid;
		width: 1.375rem;
		height: 1.375rem;
		place-items: center;
		border-radius: 6.1875rem;
		font-size: 0.75rem;
		font-weight: 700;
		color: #b42318;
		background: #fef3f2;
	}

	.alert-list {
		max-height: 12.625rem;
		min-height: 0;
		overflow-y: auto;
		overscroll-behavior: contain;
		padding: 0.25rem 0.75rem 0;
		scrollbar-gutter: stable;
	}

	.alert-item {
		position: relative;
		display: grid;
		grid-template-columns: 1.875rem minmax(0, 1fr) 0.9375rem;
		align-items: center;
		gap: 0.5625rem;
		min-height: 4.125rem;
		padding: 0.5625rem 1px 0.5625rem 0.4375rem;
		border-bottom: 1px solid #f0f1f3;
		transition: background 180ms ease;
	}

	.alert-item:hover {
		background: #f9fafb;
	}

	.alert-line {
		position: absolute;
		inset: 0.8125rem auto 0.8125rem 0;
		width: 2px;
		border-radius: 6.1875rem;
		background: #2f6fed;
	}

	.alert-line.danger {
		background: #d92d20;
	}

	.alert-line.warning {
		background: #f79009;
	}

	.alert-icon {
		display: grid;
		width: 1.875rem;
		height: 1.875rem;
		place-items: center;
		border-radius: 0.4375rem;
		color: #667085;
		background: #f2f4f7;
	}

	.alert-copy {
		min-width: 0;
	}

	.alert-copy > div {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.375rem;
	}

	.alert-kind {
		font-size: 0.75rem;
		font-weight: 700;
		color: #175cd3;
	}

	.alert-kind.danger {
		color: #b42318;
	}

	.alert-kind.warning {
		color: #b54708;
	}

	.alert-copy time {
		font-size: 0.75rem;
		color: #98a2b3;
	}

	.alert-copy strong {
		display: block;
		margin-top: 2px;
		overflow: hidden;
		font-size: 0.75rem;
		font-weight: 650;
		color: #344054;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.alert-copy p {
		margin: 0.1875rem 0 0;
		overflow: hidden;
		font-size: 0.75rem;
		color: #98a2b3;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.alert-item > :global(svg) {
		color: #c2c7cf;
	}

	.view-all {
		display: flex;
		min-height: 2.4375rem;
		align-items: center;
		justify-content: center;
		gap: 0.25rem;
		font-size: 0.75rem;
		font-weight: 650;
		color: #2f6fed;
	}

	@media (min-width: 78.8125rem) {
		.dashboard-grid > .panel {
			height: 18.875rem;
		}

		.alerts-panel {
			display: grid;
			grid-template-rows: auto minmax(0, 1fr) auto;
			overflow: hidden;
		}
	}

	.calendar-panel {
		scroll-margin-top: 4.875rem;
		overflow: hidden;
	}

	.calendar-header {
		display: flex;
		min-height: 4rem;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.8125rem 1rem;
		border-bottom: 1px solid #eaecf0;
	}

	.calendar-actions,
	.calendar-legend,
	.month-switcher {
		display: flex;
		align-items: center;
	}

	.calendar-actions {
		gap: 0.75rem;
	}

	.calendar-legend {
		gap: 0.6875rem;
		padding-right: 0.75rem;
		border-right: 1px solid #eaecf0;
		font-size: 0.75rem;
		color: #667085;
	}

	.calendar-legend span {
		display: flex;
		align-items: center;
		gap: 0.25rem;
	}

	.calendar-legend i {
		width: 0.3125rem;
		height: 0.3125rem;
		border-radius: 50%;
		background: #2f6fed;
	}

	.calendar-legend i.red {
		background: #d92d20;
	}

	.calendar-legend i.orange {
		background: #f79009;
	}

	.month-switcher {
		gap: 0.3125rem;
	}

	.month-switcher button,
	.today-button {
		display: grid;
		min-width: 1.9375rem;
		height: 1.9375rem;
		place-items: center;
		border: 1px solid #d0d5dd;
		border-radius: 0.375rem;
		color: #475467;
		background: #fff;
		cursor: pointer;
	}

	.month-switcher button:hover,
	.today-button:hover {
		border-color: #98a2b3;
		background: #f9fafb;
	}

	.month-switcher strong {
		min-width: 5.375rem;
		font-size: 0.75rem;
		text-align: center;
	}

	.today-button {
		display: inline-flex;
		width: auto;
		padding: 0 0.625rem;
		font-size: 0.75rem;
		font-weight: 600;
	}

	.calendar-grid {
		display: grid;
		grid-template-columns: repeat(7, minmax(0, 1fr));
	}

	.weekday {
		display: grid;
		height: 1.9375rem;
		place-items: center;
		border-right: 1px solid #f0f1f3;
		font-size: 0.75rem;
		font-weight: 700;
		color: #667085;
		background: #f9fafb;
	}

	.calendar-cell {
		position: relative;
		min-height: 5.25rem;
		padding: 0.5rem;
		border-top: 1px solid #eaecf0;
		border-right: 1px solid #eaecf0;
		background: #fff;
	}

	.calendar-cell:nth-child(7n) {
		border-right: 0;
	}

	.calendar-cell.other-month {
		background: #fbfcfd;
	}

	.day-number {
		display: grid;
		width: 1.375rem;
		height: 1.375rem;
		place-items: center;
		border-radius: 50%;
		font-size: 0.75rem;
		font-weight: 600;
		color: #475467;
	}

	.other-month .day-number {
		color: #c0c6cf;
	}

	.today .day-number {
		color: #fff;
		background: #2f6fed;
		box-shadow: 0 0 0 0.1875rem #edf4ff;
	}

	.day-events {
		display: grid;
		gap: 0.1875rem;
		margin-top: 0.25rem;
	}

	.calendar-event {
		display: block;
		overflow: hidden;
		padding: 0.1875rem 0.3125rem;
		border-left: 2px solid #2f6fed;
		border-radius: 0.1875rem;
		font-size: 0.75rem;
		font-weight: 600;
		color: #175cd3;
		background: #eff4ff;
		text-overflow: ellipsis;
		white-space: nowrap;
		transition: filter 180ms ease;
	}

	.calendar-event:hover {
		filter: brightness(0.96);
	}

	.calendar-event.red {
		border-color: #d92d20;
		color: #b42318;
		background: #fef3f2;
	}

	.calendar-event.orange {
		border-color: #f79009;
		color: #b54708;
		background: #fff7ed;
	}

	.calendar-event.teal {
		border-color: #0e9384;
		color: #067647;
		background: #ecfdf3;
	}

	.calendar-event.violet {
		border-color: #6941c6;
		color: #5925dc;
		background: #f4f3ff;
	}

	@media (max-width: 78.75rem) {
		.dashboard-grid {
			grid-template-columns: 1fr 1fr;
		}

		.alerts-panel {
			grid-column: 1 / -1;
		}

		.alert-list {
			display: grid;
			max-height: 4.375rem;
			grid-template-columns: repeat(3, minmax(0, 1fr));
			gap: 0 0.875rem;
		}

		.alert-item {
			border-bottom: 0;
		}
	}

	@media (max-width: 65.625rem) {
		.kpi-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}

		.filter-meta {
			display: none;
		}
	}

	@media (max-width: 47.5rem) {
		:global(.page-heading) {
			align-items: flex-start;
		}

		.secondary-action span {
			display: none;
		}

		.filter-bar {
			display: grid;
			grid-template-columns: 1fr 1fr;
			gap: 0.5rem;
		}

		.filter-title {
			grid-column: 1 / -1;
			padding: 0 0 0.4375rem;
			border-right: 0;
			border-bottom: 1px solid #eaecf0;
		}

		.filter-bar :global(.multi-filter) {
			width: 100%;
		}

		.dashboard-grid {
			display: block;
		}

		.panel {
			margin-bottom: 0.75rem;
		}

		.alert-list {
			display: block;
			max-height: 12.625rem;
		}

		.alert-item {
			border-bottom: 1px solid #f0f1f3;
		}

		.calendar-header {
			align-items: flex-start;
		}

		.calendar-actions {
			flex-wrap: wrap;
			justify-content: flex-end;
		}

		.calendar-legend {
			display: none;
		}

		.calendar-cell {
			min-height: 4.25rem;
			padding: 0.3125rem;
		}

		.calendar-event {
			max-width: 100%;
			padding: 2px 0.1875rem;
			font-size: 0.75rem;
		}
	}

	@media (max-width: 33.75rem) {
		.page-heading p {
			max-width: 14.375rem;
		}

		.kpi-grid {
			grid-template-columns: 1fr;
		}

		.kpi-card {
			min-height: 6.5rem;
			padding: 0.875rem;
		}

		.composition-body {
			grid-template-columns: 7rem minmax(0, 1fr);
			gap: 0.8125rem;
			padding: 0.8125rem;
		}

		.donut {
			width: 6.875rem;
		}

		.donut::after {
			inset: 1.25rem;
		}

		.donut-center strong {
			font-size: 1rem;
		}

		.composition-numbers strong {
			display: none;
		}

		.calendar-header {
			display: block;
		}

		.calendar-actions {
			justify-content: space-between;
			margin-top: 0.625rem;
		}

		.calendar-cell {
			min-height: 3.625rem;
		}

		.calendar-event {
			border-left-width: 0.1875rem;
			color: transparent !important;
			background: #eff4ff;
			font-size: 0;
		}

		.calendar-event::after {
			color: currentColor;
			content: '';
		}
	}
</style>
