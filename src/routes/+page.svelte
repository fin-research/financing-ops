<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import {
		Activity, CalendarClock, CircleDollarSign, Clock3, Gauge, Landmark,
		Percent, RefreshCw, ShieldAlert, TrendingUp, Upload
	} from '@lucide/svelte';
	import DebtPresetFilter from '$lib/DebtPresetFilter.svelte';
	import './dashboard.css';

	let { data } = $props();
	const initialSelectedTypes = () => data.selectedTypes;
	const initialPreset = () => data.preset;
	let selectedTypes = $state<string[]>([...initialSelectedTypes()]);
	let preset = $state(initialPreset());
	let lastQuery = $state(page.url.search);
	const dashboard = $derived(data.dashboard);
	const colors = ['#2f6fed', '#16a394', '#6941c6', '#f79009', '#d92d20', '#0ba5ec', '#6172f3', '#12b76a'];
	const presets = [
		{ key: 'all', label: '全量', exclude: [] },
		{ key: 'no_interbank', label: '不含拆借', exclude: ['同业拆借'] },
		{ key: 'no_interbank_swap', label: '不含拆借、互换便利', exclude: ['同业拆借', '互换便利'] },
		{ key: 'core_financing', label: '不含拆借、互换便利、浮动收益凭证', exclude: ['同业拆借', '互换便利', '浮动收益凭证'] }
	];

	$effect(() => {
		const params = new URLSearchParams();
		params.set('preset', preset);
		if (preset === 'custom') for (const type of selectedTypes) params.append('type', type);
		const query = `?${params.toString()}`;
		if (query !== lastQuery) {
			lastQuery = query;
			goto(query, { keepFocus: true, noScroll: true, replaceState: true });
		}
	});

	const ratioText = (value: number | null) => value == null ? '待配置' : `${value.toFixed(2)}%`;
	const ratioTone = (value: number | null, threshold: number) => value == null ? 'muted' : value > threshold ? 'danger' : 'good';
	const comparison = (label: string, value: number, unit: string, digits: number) => ({
		label,
		text: `${value > 0 ? '+' : ''}${value.toFixed(digits)}${unit}`,
		direction: value > 0 ? 'increase' : value < 0 ? 'decrease' : 'flat'
	});
	const metricCards = $derived([
		{
			label: '存续负债余额', value: `${dashboard.metrics.balanceYi.toFixed(2)}亿元`, icon: CircleDollarSign,
			accent: 'blue', tone: 'normal', detail: '',
			comparisons: [
				comparison('较上月末', dashboard.metrics.balanceMonthChangeYi, '亿', 2),
				comparison('较上年末', dashboard.metrics.balanceYearChangeYi, '亿', 2)
			]
		},
		{
			label: '加权融资利率', value: `${dashboard.metrics.weightedRatePct.toFixed(2)}%`, icon: Percent,
			accent: 'teal', tone: 'normal', detail: '',
			comparisons: [
				comparison('较上月末', dashboard.metrics.weightedRateMonthBp, 'bp', 0),
				comparison('较上年末', dashboard.metrics.weightedRateYearBp, 'bp', 0)
			]
		},
		{
			label: '加权剩余期限', value: `${Math.round(dashboard.metrics.weightedRemainingDays)}天`, icon: Clock3,
			accent: 'violet', tone: 'normal', detail: '',
			comparisons: [
				comparison('较上月末', dashboard.metrics.remainingMonthChangeDays, '天', 0),
				comparison('较上年末', dashboard.metrics.remainingYearChangeDays, '天', 0)
			]
		},
		{ label: '未来30天到期', value: `${dashboard.metrics.due30Yi.toFixed(2)}亿元`, icon: CalendarClock, accent: 'orange', tone: 'normal', detail: '本金与已结构化的付息事件合计', comparisons: [] },
		{ label: '推进中的融资项目', value: `${dashboard.metrics.projectAmountYi.toFixed(2)}亿元`, icon: Landmark, accent: 'purple', tone: 'normal', detail: '规划中、推进中和风险项目', comparisons: [] },
		{
			label: '1年以内短期负债占净资本', value: ratioText(dashboard.metrics.shortDebtRatio), icon: Gauge,
			accent: 'cyan', detail: `${dashboard.metrics.shortDebtYi.toFixed(2)}亿元 / 100%监管上限`, tone: ratioTone(dashboard.metrics.shortDebtRatio, 100), comparisons: []
		},
		{
			label: '新增单笔借款较证券上年末净资产', value: ratioText(dashboard.metrics.largestBorrowingRatio), icon: ShieldAlert,
			accent: 'red', detail: `年内最大单笔 ${dashboard.metrics.largestBorrowingYi.toFixed(2)}亿元 / 20%监管上限`, tone: ratioTone(dashboard.metrics.largestBorrowingRatio, 20), comparisons: []
		},
		{
			label: '月末累计新增借款较证券上年末净资产', value: ratioText(dashboard.metrics.cumulativeSecuritiesRatio), icon: Activity,
			accent: 'amber', detail: `截至 ${dashboard.metrics.cumulativeBorrowingDate} 净新增 ${dashboard.metrics.cumulativeBorrowingYi > 0 ? '+' : ''}${dashboard.metrics.cumulativeBorrowingYi.toFixed(2)}亿元 / 50%监管上限`, tone: ratioTone(dashboard.metrics.cumulativeSecuritiesRatio, 50), comparisons: []
		},
		{
			label: '月末累计新增借款较集团上年末净资产', value: ratioText(dashboard.metrics.cumulativeGroupRatio), icon: TrendingUp,
			accent: 'indigo', detail: `截至 ${dashboard.metrics.cumulativeBorrowingDate} 净新增 ${dashboard.metrics.cumulativeBorrowingYi > 0 ? '+' : ''}${dashboard.metrics.cumulativeBorrowingYi.toFixed(2)}亿元 / 10%监管上限`, tone: ratioTone(dashboard.metrics.cumulativeGroupRatio, 10), comparisons: []
		}
	]);
	const compositionTotal = $derived(dashboard.composition.reduce((sum: number, item: any) => sum + item.amountYi, 0));
	const maxMaturity = $derived(Math.max(1, ...dashboard.maturityDistribution.map((item: any) => item.amountYi)));
</script>

<svelte:head><title>仪表盘 · 融资工作台</title></svelte:head>

<section class="page-heading dashboard-heading">
	<div><p class="eyebrow">FINANCING DASHBOARD</p><h1>仪表盘</h1><p>统一监控负债规模、融资成本、期限与监管阈值</p></div>
	<div class="heading-actions">
		<button class="secondary-action" type="button" onclick={() => goto(page.url, { invalidateAll: true })}><RefreshCw size={16} />刷新数据</button>
		<a class="primary-action" href="/data"><Upload size={16} />导入 Excel</a>
	</div>
</section>

<DebtPresetFilter options={dashboard.typeOptions} {presets} bind:preset bind:values={selectedTypes} note={`数据截至 ${dashboard.asOfDate}`} />

<section class="metric-grid" aria-label="融资指标">
	{#each metricCards as metric}
		<article class={`metric-card accent-${metric.accent}`} class:danger={metric.tone === 'danger'}>
			<div class="metric-icon" aria-hidden="true"><metric.icon size={30} strokeWidth={1.8} /></div>
			<div class="metric-content">
				<h2>{metric.label}</h2>
				<strong class:muted-value={metric.value === '待配置'}>{metric.value}</strong>
				{#if metric.comparisons.length}
					<div class="metric-comparisons">
						{#each metric.comparisons as item}
							<span>{item.label}<b class:increase={item.direction === 'increase'} class:decrease={item.direction === 'decrease'}>{item.text}</b></span>
						{/each}
					</div>
				{:else}
					<p class:limit-danger={metric.tone === 'danger'} class:limit-good={metric.tone === 'good'}>{metric.detail}</p>
				{/if}
			</div>
		</article>
	{/each}
</section>

<section class="overview-row">
	<article class="dashboard-panel structure-panel">
		<header><div><h2>存量负债结构</h2><p>收益凭证按整体展示，债券按细项展示</p></div><span>{compositionTotal.toFixed(2)}亿元</span></header>
		<div class="structure-body">
			<div class="donut" style={`background: conic-gradient(${dashboard.composition.map((item: any, index: number) => {
				const start = dashboard.composition.slice(0, index).reduce((sum: number, part: any) => sum + part.amountYi / compositionTotal * 100, 0);
				return `${colors[index % colors.length]} ${start}% ${start + item.amountYi / compositionTotal * 100}%`;
			}).join(', ')})`}><div><strong>{compositionTotal.toFixed(1)}</strong><span>亿元</span></div></div>
			<div class="legend-list">
				{#each dashboard.composition as item, index}
					<div><i style:background={colors[index % colors.length]}></i><span>{item.type}</span><strong>{item.amountYi.toFixed(2)}</strong><small>{(item.amountYi / compositionTotal * 100).toFixed(1)}%</small></div>
				{/each}
			</div>
		</div>
	</article>

	<article class="dashboard-panel maturity-panel">
		<header><div><h2>到期分布</h2><p>未来六个月到期本金，亿元</p></div></header>
		<div class="maturity-bars">
			{#each dashboard.maturityDistribution as item}
				<div><strong>{item.amountYi.toFixed(1)}</strong><span class="bar-track"><i style:height={`${Math.max(2, item.amountYi / maxMaturity * 100)}%`}></i></span><small>{Number(item.month.slice(5, 7))}月</small></div>
			{/each}
		</div>
	</article>
</section>

<section class="summary-row">
	<article class="dashboard-panel project-panel">
		<header><div><h2>推进中的融资项目</h2><p>规划、执行与风险状态项目</p></div></header>
		<table><thead><tr><th>融资方式</th><th>融资金额</th><th>期限</th><th>融资成本</th><th>落地时间</th></tr></thead><tbody>
			{#each dashboard.projects as project}<tr><td><a href={`/projects/${project.id}`}>{project.debtType}</a><small>{project.name}</small></td><td>{project.amountYi.toFixed(2)}</td><td>{project.tenor}</td><td>{project.cost}</td><td>{project.landingDate ? `${project.landingDate.replaceAll('-', '/')}簿记` : '待定'}</td></tr>{/each}
		</tbody><tfoot><tr><th>合计</th><th>{dashboard.metrics.projectAmountYi.toFixed(2)}</th><th colspan="3"></th></tr></tfoot></table>
	</article>

	<article class="dashboard-panel issuance-panel">
		<header><div><h2>月度发行统计</h2><p>按起息日归属发行月份，亿元</p></div></header>
		<table><thead><tr><th>品种</th><th>{dashboard.monthlyIssuance.currentMonth.replace('-', '年')}月</th><th>{dashboard.monthlyIssuance.comparisonMonth.replace('-', '年')}月</th></tr></thead><tbody>
			{#each dashboard.monthlyIssuance.rows as row}<tr><td>{row.label}</td><td>{row.currentYi.toFixed(2)}</td><td>{row.comparisonYi.toFixed(2)}</td></tr>{/each}
		</tbody></table>
	</article>
</section>
