<script lang="ts">
	import './weekly-report.css';
	import { withBase } from '$lib/app-paths';
	import {
		AlertTriangle,
		CalendarDays,
		CircleAlert,
		Database,
		Landmark,
		LineChart,
		ShieldCheck,
		WalletCards
	} from '@lucide/svelte';

	let { data } = $props();
	let report = $derived(data.report);
	let currentEvents = $derived(report.events.filter((item: any) => item.week === 'current'));
	let nextEvents = $derived(report.events.filter((item: any) => item.week === 'next'));
	let maxMaturity = $derived(Math.max(1, ...report.maturityDistribution.map((item: any) => item.amountYi)));
	let maxComposition = $derived(Math.max(1, ...report.composition.map((item: any) => item.amountYi)));
	let projectAmountYi = $derived(report.projects.reduce((sum: number, item: any) => sum + item.amountYi, 0));
	let warnings = $derived([
		report.staleDays > 3 ? `余额快照已滞后 ${report.staleDays} 天` : null,
		!report.quality.liveDerivedReliable
			? `明细余额与快照相差 ${signed(report.quality.reconciliationDeltaYi, 2)} 亿元`
			: null
	].filter(Boolean));

	const missingModules = [
		{ title: '资产负债规模与资产负债率', detail: '缺少总资产、总负债和代理买卖月末参数。' },
		{ title: '市场利率与信用利差', detail: '中债收益率、1/3/5 年信用利差和存单发行利率尚未接入生产数据。' },
		{ title: '可比券商发行与注册进度', detail: '同业发行定价及项目注册信息尚未进入工作台数据模型。' },
		{ title: '融资项目预计利率区间', detail: '项目主档没有预计利率区间字段，当前只能展示规模、日期和责任人。' }
	];

	function amount(value: number | null | undefined, digits = 2) {
		return value == null || !Number.isFinite(value)
			? '暂无可靠数据'
			: new Intl.NumberFormat('zh-CN', {
				minimumFractionDigits: digits,
				maximumFractionDigits: digits
			}).format(value);
	}

	function percent(value: number | null | undefined, digits = 1) {
		return value == null || !Number.isFinite(value) ? '待配置' : `${amount(value, digits)}%`;
	}

	function signed(value: number, digits = 2) {
		const formatted = amount(Math.abs(value), digits);
		return `${value >= 0 ? '+' : '-'}${formatted}`;
	}

	function dateLabel(value: string | null | undefined) {
		return value ? value.replaceAll('-', '/') : '待定';
	}

	function monthLabel(value: string) {
		const [year, month] = value.split('-');
		return `${year.slice(2)}/${Number(month)}`;
	}

	function metricTone(value: number | null, warning: number, limit: number) {
		if (value == null) return 'neutral';
		if (value >= limit) return 'danger';
		if (value >= warning) return 'warning';
		return 'good';
	}

	function eventLabel(kind: string) {
		return ({ maturity: '到期', interest: '付息', issue: '起息', project: '计划簿记' } as Record<string, string>)[kind] ?? kind;
	}

	function projectStatus(value: string) {
		return ({ planning: '筹划中', in_progress: '推进中', at_risk: '有风险' } as Record<string, string>)[value] ?? value;
	}
</script>

<svelte:head>
	<title>负债周报 · 融资工作台</title>
</svelte:head>

<div class="weekly-report">
	<section class:warning={warnings.length > 0} class="report-status" aria-label="周报数据状态">
		<div>
			<Database size={20} />
			<span><strong>数据基准 {dateLabel(report.asOfDate)}</strong> · 余额采用历史快照，明细指标采用负债台账</span>
		</div>
		{#if warnings.length > 0}
			<p><AlertTriangle size={18} />{warnings.join('；')}，相关模块已隐藏数值，避免误用。</p>
		{:else}
			<p><ShieldCheck size={18} />快照与明细已勾稽，可用于本期周报。</p>
		{/if}
	</section>

	<section class="report-section">
		<header class="section-heading">
			<div><CalendarDays size={20} /><h2>近期负债与融资动态</h2></div>
			<span>本周 / 下周</span>
		</header>
		{#if report.quality.liveDerivedReliable}
			<div class="week-grid">
				{#each [{ label: '本周', items: currentEvents }, { label: '下周', items: nextEvents }] as group}
					<article class="week-card">
						<header><strong>{group.label}</strong><span>{group.items.length} 项</span></header>
						<div class="event-list">
							{#each group.items as item}
								<a href={withBase(item.href)}>
									<time>{dateLabel(item.date).slice(5)}</time>
									<span><b>{eventLabel(item.kind)}</b> · {item.debtType} · {item.name}</span>
									<strong>{amount(item.amountYi)} 亿元</strong>
								</a>
							{:else}
								<p class="empty-state">暂无动态</p>
							{/each}
						</div>
					</article>
				{/each}
			</div>
		{:else}
			<div class="empty-state prominent"><CircleAlert size={20} />明细台账尚未与余额快照勾稽，近期动态暂不展示。</div>
		{/if}
	</section>

	<section class="report-section">
		<header class="section-heading">
			<div><WalletCards size={20} /><h2>负债核心数据</h2></div>
			<span>单位：亿元</span>
		</header>
		<div class="metric-grid">
			<article class="metric-card">
				<span>主动负债余额</span><strong>{amount(report.metrics.balanceYi)}</strong>
				<small>较上月末 {signed(report.metrics.balanceMonthChangeYi)} · 较上年末 {signed(report.metrics.balanceYearChangeYi)}</small>
			</article>
			<article class="metric-card">
				<span>加权融资利率</span><strong>{report.quality.liveDerivedReliable ? `${amount(report.metrics.weightedRatePct, 2)}%` : '暂无可靠数据'}</strong>
				<small>利率字段金额覆盖 {amount(report.quality.rateCoveragePct, 1)}%</small>
			</article>
			<article class="metric-card">
				<span>加权剩余期限</span><strong>{report.quality.liveDerivedReliable ? `${amount(report.metrics.weightedRemainingDays, 0)} 天` : '暂无可靠数据'}</strong>
				<small>起息与到期字段金额覆盖 {amount(report.quality.lifecycleCoveragePct, 1)}%</small>
			</article>
			<article class="metric-card">
				<span>长期负债占比</span><strong>{report.quality.liveDerivedReliable ? percent(report.metrics.longBalanceRatio) : '暂无可靠数据'}</strong>
				<small>原始发行期限口径</small>
			</article>
			<article class="metric-card risk">
				<span>未来 30 天到期本金</span><strong>{report.quality.liveDerivedReliable ? amount(report.metrics.due30Yi) : '暂无可靠数据'}</strong>
				<small>统计日后 1–30 天</small>
			</article>
			<article class="metric-card risk">
				<span>年内到期本金</span><strong>{report.quality.liveDerivedReliable ? amount(report.metrics.dueYearYi) : '暂无可靠数据'}</strong>
				<small>统计日至当年 12 月 31 日</small>
			</article>
			<article class="metric-card">
				<span>推进中融资计划</span><strong>{amount(projectAmountYi)}</strong>
				<small>{report.projects.length} 个项目</small>
			</article>
			<article class="metric-card">
				<span>月末累计新增借款</span><strong>{amount(report.metrics.cumulativeBorrowingYi)}</strong>
				<small>截至 {dateLabel(report.metrics.cumulativeBorrowingDate)}，剔除互换便利</small>
			</article>
		</div>
	</section>

	<section class="report-section">
		<header class="section-heading">
			<div><ShieldCheck size={20} /><h2>监管与风险指标</h2></div>
			<span>状态不只依赖颜色</span>
		</header>
		<div class="risk-grid">
			{#each [
				{ label: '短融 + 短期公司债 + 同业拆借 / 净资本', value: report.quality.liveDerivedReliable ? report.metrics.shortCompanyDebtRatio : null, numerator: report.metrics.shortCompanyDebtYi, warning: 48, limit: 60, threshold: '上限 60%' },
				{ label: '发行期限 1 年以内短期负债 / 净资本', value: report.quality.liveDerivedReliable ? report.metrics.shortDebtRatio : null, numerator: report.metrics.shortDebtYi, warning: 80, limit: 100, threshold: '上限 100%' },
				{ label: '新增单笔借款 / 证券上年末净资产', value: report.quality.liveDerivedReliable ? report.metrics.largestBorrowingRatio : null, numerator: report.metrics.largestBorrowingYi, warning: 16, limit: 20, threshold: '预警 20%' },
				{ label: '累计新增借款 / 证券上年末净资产', value: report.metrics.cumulativeSecuritiesRatio, numerator: report.metrics.cumulativeBorrowingYi, warning: 40, limit: 50, threshold: '预警 50%' },
				{ label: '累计新增借款 / 集团上年末净资产', value: report.metrics.cumulativeGroupRatio, numerator: report.metrics.cumulativeBorrowingYi, warning: 8, limit: 10, threshold: '预警 10%' }
			] as item}
				<article class={`risk-card ${metricTone(item.value, item.warning, item.limit)}`}>
					<span class="status-dot"></span>
					<strong>{percent(item.value)}</strong>
					<p>{item.label}</p>
					<small>{item.value == null ? '分子或分母待核对' : `${amount(item.numerator)} 亿元 · ${item.threshold}`}</small>
				</article>
			{/each}
		</div>
	</section>

	<section class="two-column-section">
		<article class="report-section">
			<header class="section-heading"><div><Landmark size={20} /><h2>存量负债结构</h2></div></header>
			<div class="bar-list">
				{#each report.composition as item}
					<div>
						<span>{item.type || '未分类'}</span><strong>{amount(item.amountYi)}</strong>
						<i><b style:width={`${item.amountYi / maxComposition * 100}%`}></b></i>
					</div>
				{/each}
			</div>
		</article>
		<article class="report-section">
			<header class="section-heading"><div><LineChart size={20} /><h2>未来 12 个月到期本金</h2></div></header>
			{#if report.quality.liveDerivedReliable}
				<div class="maturity-bars">
					{#each report.maturityDistribution as item}
						<div><strong>{item.amountYi > 0 ? amount(item.amountYi, 0) : ''}</strong><i style:height={`${Math.max(3, item.amountYi / maxMaturity * 100)}%`}></i><span>{monthLabel(item.month)}</span></div>
					{/each}
				</div>
			{:else}
				<div class="empty-state prominent">明细余额未勾稽，到期分布暂不展示。</div>
			{/if}
		</article>
	</section>

	<section class="report-section">
		<header class="section-heading"><div><CalendarDays size={20} /><h2>推进中的融资计划</h2></div><span>共 {report.projects.length} 项</span></header>
		<div class="weekly-table-wrap">
			<table class="weekly-table">
				<thead><tr><th>项目</th><th>品种</th><th>规模（亿元）</th><th>计划簿记</th><th>负责人</th><th>状态</th></tr></thead>
				<tbody>
					{#each report.projects as project}
						<tr><td><a href={withBase(`/projects/${project.id}`)}>{project.name}</a></td><td>{project.debtType}</td><td>{amount(project.amountYi)}</td><td>{dateLabel(project.plannedIssueDate)}</td><td>{project.ownerName ?? '待分配'}</td><td>{projectStatus(project.status)}</td></tr>
					{:else}
						<tr><td colspan="6" class="table-empty">暂无推进中的融资项目</td></tr>
					{/each}
				</tbody>
			</table>
		</div>
	</section>

	<section class="report-section">
		<header class="section-heading"><div><Landmark size={20} /><h2>融资批复额度使用情况</h2></div><span>单位：亿元</span></header>
		<div class="weekly-table-wrap">
			<table class="weekly-table">
				<thead><tr><th>融资品种</th><th>可用额度</th><th>已用额度</th><th>剩余额度</th><th>获批日期</th><th>到期日期</th></tr></thead>
				<tbody>{#each report.limits as item}<tr><td><strong>{item.debtType}</strong></td><td>{amount(item.limitYi)}</td><td>{amount(item.issuedYi)}</td><td class:negative={item.remainingYi < 0}>{amount(item.remainingYi)}</td><td>{dateLabel(item.approvedDate)}</td><td>{dateLabel(item.expiryDate)}</td></tr>{/each}</tbody>
				<tfoot><tr><th>合计</th><th>{amount(report.limitTotals.limitYi)}</th><th>{amount(report.limitTotals.issuedYi)}</th><th>{amount(report.limitTotals.remainingYi)}</th><th></th><th></th></tr></tfoot>
			</table>
		</div>
	</section>

	<section class="report-section">
		<header class="section-heading"><div><CalendarDays size={20} /><h2>未来 30 天到期明细</h2></div><span>剔除浮动收益凭证</span></header>
		{#if report.quality.liveDerivedReliable}
			<div class="weekly-table-wrap">
				<table class="weekly-table">
					<thead><tr><th>到期日</th><th>品种</th><th>负债名称</th><th>对手方</th><th>本金（亿元）</th><th>利率</th></tr></thead>
					<tbody>{#each report.dueDetails as item}<tr><td>{dateLabel(item.maturityDate)}</td><td>{item.debt_type}</td><td><a href={withBase(`/debts/${item.id}`)}>{item.name}</a></td><td>{item.counterparty ?? '/'}</td><td>{amount(item.principalYi)}</td><td>{item.annualRatePct == null ? '待配置' : `${amount(item.annualRatePct, 2)}%`}</td></tr>{/each}</tbody>
				</table>
			</div>
		{:else}
			<div class="empty-state prominent">明细余额未勾稽，到期明细暂不展示。</div>
		{/if}
	</section>

	<section class="report-section missing-section">
		<header class="section-heading"><div><CircleAlert size={20} /><h2>尚未接入的周报数据</h2></div><span>{missingModules.length} 项</span></header>
		<div class="missing-grid">
			{#each missingModules as item}
				<article><AlertTriangle size={18} /><div><strong>{item.title}</strong><p>{item.detail}</p></div></article>
			{/each}
		</div>
	</section>
</div>
