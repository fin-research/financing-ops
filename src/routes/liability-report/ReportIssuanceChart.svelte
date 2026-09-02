<script lang="ts">
	import EChart from '$lib/charts/EChart.svelte';

	let { rows = [] }: { rows?: Array<{ month: string; type: string; amountYi: number; weightedRatePct?: number | null }> } = $props();
	const colors = ['#3e5c9a', '#4fa3d1', '#8b7bd9', '#54bfa0', '#e0a24e'];
	const months = $derived([...new Set(rows.map((row) => row.month))].sort());
	const types = $derived([...new Set(rows.map((row) => row.type))]);
	const rates = $derived(months.map((month) => {
		const observed = rows.filter((row) => row.month === month && row.weightedRatePct != null && Number(row.amountYi) > 0);
		const amount = observed.reduce((sum, row) => sum + Number(row.amountYi), 0);
		return amount ? observed.reduce((sum, row) => sum + Number(row.amountYi) * Number(row.weightedRatePct), 0) / amount : null;
	}));
	const option = $derived({
		aria: { enabled: true, decal: { show: true } },
		color: colors,
		tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
		legend: {
			type: 'scroll', top: 0,
			data: [...types, '加权发行利率'],
			textStyle: { color: '#475569', fontSize: 12 }
		},
		grid: { left: 20, right: 22, top: 52, bottom: 18, containLabel: true },
		xAxis: {
			type: 'category', data: months,
			axisTick: { show: false }, axisLine: { lineStyle: { color: '#cbd5e1' } },
			axisLabel: { color: '#64748b', formatter: (value: string) => value.slice(2).replace('-', '/') }
		},
		yAxis: [
			{ type: 'value', name: '亿元', min: 0, axisLabel: { color: '#64748b' }, nameTextStyle: { color: '#64748b' }, splitLine: { lineStyle: { color: '#e8edf3' } } },
			{ type: 'value', name: '%', scale: true, axisLabel: { color: '#64748b', formatter: '{value}%' }, nameTextStyle: { color: '#64748b' }, splitLine: { show: false } }
		],
		series: [
			...types.map((type, index) => ({
				name: type, type: 'bar', stack: '发行规模', barMaxWidth: 34,
				itemStyle: { color: colors[index % colors.length], borderRadius: index === types.length - 1 ? [3, 3, 0, 0] : 0 },
				data: months.map((month) => Number(rows.find((row) => row.month === month && row.type === type)?.amountYi ?? 0))
			})),
			{
				name: '加权发行利率', type: 'line', yAxisIndex: 1, showSymbol: true, symbolSize: 6,
				connectNulls: false, lineStyle: { width: 2.6, color: '#d85b57' }, itemStyle: { color: '#d85b57' }, data: rates
			}
		],
		media: [{ query: { maxWidth: 560 }, option: { grid: { left: 8, right: 10, top: 76, bottom: 12, containLabel: true } } }]
	});
</script>

{#if months.length && rows.some((row) => Number(row.amountYi) > 0)}
	<EChart {option} ariaLabel="近一年公司债券各品种发行规模与加权发行利率趋势" height={19} />
{:else}
	<div class="chart-empty">近一年暂无可靠公司债发行数据</div>
{/if}

<style>
	.chart-empty { display: grid; min-height: 16rem; place-items: center; color: #64748b; font-size: 0.875rem; }
</style>
