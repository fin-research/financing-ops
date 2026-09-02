<script lang="ts">
	import './weekly-report.css';
	import { enhance } from '$app/forms';
	import { withBase } from '$lib/app-paths';
	import {
		AlertTriangle,
		CalendarDays,
		CircleAlert,
		Database,
		Landmark,
		LineChart,
		History,
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
	let parameterRows = $derived(Object.values(report.parameters ?? {}) as any[]);
	let missingModules = $derived((report as any).provenance?.missingModules ?? []);
	let generating = $state(false);
	let warnings = $derived([
		report.staleDays > 3 ? `余额快照已滞后 ${report.staleDays} 天` : null,
		!report.quality.liveDerivedReliable
			? `明细余额与快照相差 ${signed(report.quality.reconciliationDeltaYi, 2)} 亿元`
			: null
	].filter(Boolean));

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

	function marketCategory(value: string) {
		return ({
			credit_spread_broker_govt_1y: '券商与国债信用利差 · 1年',
			credit_spread_broker_govt_3y: '券商与国债信用利差 · 3年',
			credit_spread_broker_govt_5y: '券商与国债信用利差 · 5年',
			state_owned_bank_ncd: '国有行存单发行利率',
			chinabond_broker_aaa_minus_yield: '中债证券公司债到期收益率（AAA-）'
		} as Record<string, string>)[value] ?? value;
	}

	function projectRate(project: any) {
		if (project.expectedRateMin == null || project.expectedRateMax == null) return '数据缺失';
		const min = amount(project.expectedRateMin * 100, 2);
		const max = amount(project.expectedRateMax * 100, 2);
		return min === max ? `${min}%` : `${min}%–${max}%`;
	}

	function fieldMissing(value: number | null | undefined, coverage: number | null | undefined) {
		return value == null || coverage == null || coverage <= 0;
	}

	function enhanceGeneration() {
		generating = true;
		return async ({ update }: any) => {
			try {
				await update({ reset: false });
			} finally {
				generating = false;
			}
		};
	}
</script>

<svelte:head>
	<title>负债周报 · 融资工作台</title>
</svelte:head>

<div class="weekly-report">
	<header class="template-header">
		<div>
			<h1>东方财富证券 · 资金管理部负债周报</h1>
			<p>资金管理部 · 融资组</p>
		</div>
		<div class="template-meta">
			<span>报表日期</span>
			<strong>{dateLabel(report.asOfDate)}</strong>
		</div>
	</header>

	<section class:warning={warnings.length > 0} class="report-status" aria-label="周报数据状态">
		<div>
			<Database size={20} />
			<span><strong>数据基准 {dateLabel(report.asOfDate)}</strong> · 余额采用历史快照，明细指标采用负债台账</span>
		</div>
		{#if warnings.length > 0}
			<p><AlertTriangle size={18} />{warnings.join('；')}；页面保留全部模块，并在对应位置标注数据缺失或未勾稽。</p>
		{:else}
			<p><ShieldCheck size={18} />快照与明细已勾稽，可用于本期周报。</p>
		{/if}
	</section>

	<section class="report-section report-actions">
		<header class="section-heading"><div><History size={20} /><h2>手动生成与历史快照</h2></div><span>不会因页面访问自动消耗 Choice 配额</span></header>
		<div class="report-action-body">
			<form method="POST" action="?/generate" class="generate-form" use:enhance={enhanceGeneration}>
				<input type="hidden" name="confirm" value="yes" />
				<button type="submit" disabled={generating}>{generating ? '生成中…' : '手动生成本期周报'}</button>
				<small>点击后各发起 1 次 EDB 和 1 次 CTR 逻辑请求；失败请求最多有限重试，并将完整 JSON 快照写入 R2。</small>
			</form>
			{#if data.snapshotError}<p class="data-missing"><AlertTriangle size={16} />历史快照读取失败：{data.snapshotError}</p>{/if}
			<div class="history-list">
				{#each data.reportHistory ?? [] as run}
					<a class:current={run.id === data.selectedRunId} href={`?run=${encodeURIComponent(run.id)}`}>
						<strong>{dateLabel(run.asOfDate)}</strong><span>生成于 {dateLabel(String(run.generatedAt).slice(0, 10))}</span><em>{run.missingModules?.length ? `缺失 ${run.missingModules.length} 项` : '数据齐全'}</em>
					</a>
				{:else}
					<p class="data-missing">尚未生成历史周报快照，请手动点击生成。</p>
				{/each}
			</div>
		</div>
	</section>

	<section class="report-section">
		<header class="section-heading">
			<div><CalendarDays size={20} /><h2>近期负债与融资动态</h2></div>
			<span>本周 / 下周</span>
		</header>
		{#if !report.quality.liveDerivedReliable}<p class="data-missing"><AlertTriangle size={16} />快照与明细未勾稽，以下动态仍保留但金额不可直接用于决策。</p>{/if}
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
				<span>加权融资利率</span><strong>{fieldMissing(report.metrics.weightedRatePct, report.quality.rateCoveragePct) ? '数据缺失' : `${amount(report.metrics.weightedRatePct, 2)}%`}</strong>
				<small>利率字段金额覆盖 {amount(report.quality.rateCoveragePct, 1)}%</small>
			</article>
			<article class="metric-card">
				<span>加权剩余期限</span><strong>{fieldMissing(report.metrics.weightedRemainingDays, report.quality.lifecycleCoveragePct) ? '数据缺失' : `${amount(report.metrics.weightedRemainingDays, 0)} 天`}</strong>
				<small>起息与到期字段金额覆盖 {amount(report.quality.lifecycleCoveragePct, 1)}%</small>
			</article>
			<article class="metric-card">
				<span>长期负债占比</span><strong>{report.metrics.longBalanceRatio == null ? '数据缺失' : percent(report.metrics.longBalanceRatio)}</strong>
				<small>原始发行期限口径</small>
			</article>
			<article class="metric-card risk">
				<span>未来 30 天到期本金</span><strong>{report.metrics.due30Yi == null ? '数据缺失' : amount(report.metrics.due30Yi)}</strong>
				<small>统计日后 1–30 天</small>
			</article>
			<article class="metric-card risk">
				<span>年内到期本金</span><strong>{report.metrics.dueYearYi == null ? '数据缺失' : amount(report.metrics.dueYearYi)}</strong>
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
				{ label: '短融 + 短期公司债 + 同业拆借 / 净资本', value: report.metrics.shortCompanyDebtRatio, numerator: report.metrics.shortCompanyDebtYi, warning: 48, limit: 60, threshold: '上限 60%' },
				{ label: '发行期限 1 年以内短期负债 / 净资本', value: report.metrics.shortDebtRatio, numerator: report.metrics.shortDebtYi, warning: 80, limit: 100, threshold: '上限 100%' },
				{ label: '新增单笔借款 / 证券上年末净资产', value: report.metrics.largestBorrowingRatio, numerator: report.metrics.largestBorrowingYi, warning: 16, limit: 20, threshold: '预警 20%' },
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

	<section class="report-section">
		<header class="section-heading"><div><Database size={20} /><h2>财务基础参数</h2></div><span>报告期与来源均保留</span></header>
		<div class="weekly-table-wrap">
			<table class="weekly-table">
				<thead><tr><th>参数</th><th>数值</th><th>报告期</th><th>来源说明</th></tr></thead>
				<tbody>{#each parameterRows as item}<tr><td>{item.label}</td><td>{item.valueYi == null ? '数据缺失' : item.label.includes('率') ? `${amount(item.valueYi * 100, 2)}%` : `${amount(item.valueYi)} 亿元`}</td><td>{dateLabel(item.periodEnd)}</td><td>{item.notes ?? '数据缺失'}</td></tr>{:else}<tr><td colspan="4" class="table-empty">尚无净资本、净资产或资产负债规模参数。</td></tr>{/each}</tbody>
			</table>
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
			{#if !report.quality.liveDerivedReliable}<p class="data-missing"><AlertTriangle size={16} />快照与明细未勾稽，到期分布保留图形但标注为待核对。</p>{/if}
				<div class="maturity-bars">
					{#each report.maturityDistribution as item}
						<div><strong>{item.amountYi > 0 ? amount(item.amountYi, 0) : ''}</strong><i style:height={`${Math.max(3, item.amountYi / maxMaturity * 100)}%`}></i><span>{monthLabel(item.month)}</span></div>
					{/each}
				</div>
		</article>
	</section>

	<section class="two-column-section">
		<article class="report-section">
			<header class="section-heading"><div><LineChart size={20} /><h2>利率与信用利差</h2></div><span>底稿最新观测</span></header>
			{#if report.marketObservations.length}
				<div class="weekly-table-wrap">
					<table class="weekly-table">
						<thead><tr><th>指标</th><th>期限</th><th>日期</th><th>数值</th></tr></thead>
						<tbody>{#each report.marketObservations as item}<tr><td>{marketCategory(item.category)}<br /><small>{item.seriesName}</small></td><td>{item.tenor ?? '—'}</td><td>{dateLabel(item.observationDate)}</td><td>{item.value == null ? '数据缺失' : `${amount(item.value, 4)}${item.unit ?? ''}`}</td></tr>{/each}</tbody>
					</table>
				</div>
			{:else}
				<p class="data-missing">尚无市场利率、信用利差或存单观测数据。</p>
			{/if}
		</article>
		<article class="report-section">
			<header class="section-heading"><div><Landmark size={20} /><h2>可比券商发行明细</h2></div><span>最新 12 条</span></header>
			{#if report.peerIssuances.length}
				<div class="weekly-table-wrap">
					<table class="weekly-table">
						<thead><tr><th>债券</th><th>发行人</th><th>发行日</th><th>规模（亿元）</th><th>期限</th></tr></thead>
						<tbody>{#each report.peerIssuances as item}<tr><td><strong>{item.bondName}</strong><br /><small>{item.securityCode ?? '无代码'}</small></td><td>{item.issuerName ?? '数据缺失'}</td><td>{dateLabel(item.issueDate)}</td><td>{item.actualIssueAmountYi == null ? '数据缺失' : amount(item.actualIssueAmountYi)}</td><td>{item.issueTenor ?? '数据缺失'}</td></tr>{/each}</tbody>
					</table>
				</div>
			{:else}
				<p class="data-missing">尚无可比券商发行明细。</p>
			{/if}
		</article>
	</section>

	<section class="report-section">
		<header class="section-heading"><div><CalendarDays size={20} /><h2>可比券商项目注册进程</h2></div><span>最新 12 条</span></header>
		{#if report.registrationProgress.length}
			<div class="weekly-table-wrap">
				<table class="weekly-table">
					<thead><tr><th>项目</th><th>发行人</th><th>状态</th><th>品种</th><th>规模（亿元）</th><th>更新日</th><th>主承销商</th></tr></thead>
					<tbody>{#each report.registrationProgress as item}<tr><td>{item.projectName}</td><td>{item.issuerName ?? '数据缺失'}</td><td>{item.status ?? '数据缺失'}</td><td>{item.variety ?? '数据缺失'}</td><td>{item.amountYi == null ? '数据缺失' : amount(item.amountYi)}</td><td>{dateLabel(item.updateDate)}</td><td>{item.leadUnderwriter ?? '数据缺失'}</td></tr>{/each}</tbody>
				</table>
			</div>
		{:else}
			<p class="data-missing">尚无可比券商项目注册进程；Choice 批量注册进程接口也未验证。</p>
		{/if}
	</section>

	<section class="report-section">
		<header class="section-heading"><div><CalendarDays size={20} /><h2>推进中的融资计划</h2></div><span>共 {report.projects.length} 项</span></header>
		<div class="weekly-table-wrap">
			<table class="weekly-table">
				<thead><tr><th>项目</th><th>品种</th><th>规模（亿元）</th><th>计划簿记</th><th>预计利率</th><th>资金成本</th><th>期限</th><th>负责人</th><th>状态</th></tr></thead>
				<tbody>
					{#each report.projects as project}
						<tr><td><a href={withBase(`/projects/${project.id}`)}>{project.name}</a></td><td>{project.debtType}</td><td>{project.amountDescription ?? amount(project.amountYi)}</td><td>{dateLabel(project.plannedIssueDate)}</td><td>{projectRate(project)}</td><td>{project.fundingCostRate == null ? '数据缺失' : percent(project.fundingCostRate * 100)}</td><td>{project.tenorDescription ?? '数据缺失'}</td><td>{project.ownerName ?? '待分配'}</td><td>{projectStatus(project.status)}</td></tr>
					{:else}
						<tr><td colspan="9" class="table-empty">暂无推进中的融资项目</td></tr>
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
		{#if !report.quality.liveDerivedReliable}<p class="data-missing"><AlertTriangle size={16} />明细余额未勾稽，到期明细保留但请先核对金额。</p>{/if}
			<div class="weekly-table-wrap">
				<table class="weekly-table">
					<thead><tr><th>到期日</th><th>品种</th><th>负债名称</th><th>对手方</th><th>本金（亿元）</th><th>利率</th></tr></thead>
					<tbody>{#each report.dueDetails as item}<tr><td>{dateLabel(item.maturityDate)}</td><td>{item.debt_type}</td><td><a href={withBase(`/debts/${item.id}`)}>{item.name}</a></td><td>{item.counterparty ?? '/'}</td><td>{amount(item.principalYi)}</td><td>{item.annualRatePct == null ? '待配置' : `${amount(item.annualRatePct, 2)}%`}</td></tr>{/each}</tbody>
				</table>
			</div>
	</section>

	<section class="report-section missing-section">
		<header class="section-heading"><div><CircleAlert size={20} /><h2>数据缺失与来源状态</h2></div><span>{missingModules.length} 项</span></header>
		<div class="missing-grid">
			{#each missingModules as item}
				<article><AlertTriangle size={18} /><div><strong>{item.title}</strong><p>{item.detail}</p></div></article>
			{/each}
			{#if missingModules.length === 0}<article class="data-ok"><ShieldCheck size={18} /><div><strong>当前快照未发现数据缺失</strong><p>底稿、生产参数和本次手动 Choice 拉取均有记录。</p></div></article>{/if}
		</div>
	</section>
</div>
