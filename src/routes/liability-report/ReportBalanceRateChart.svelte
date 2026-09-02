<script lang="ts">
	import EChart from '$lib/charts/EChart.svelte';

	let { rows = [] }: { rows?: Array<{ date?: string; balanceYi?: number; weightedRatePct?: number | null }> } = $props();
	const values = $derived(rows.filter((row) => Number(row.balanceYi) > 0));
	const option = $derived({
		aria: { enabled: true, decal: { show: false } },
		color: ['#3e5c9a', '#d85b57'],
		tooltip: {
			trigger: 'axis',
			valueFormatter: (value: unknown) => Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 2 })
		},
		legend: { top: 0, data: ['负债余额', '加权融资利率'], textStyle: { color: '#475569', fontSize: 12 } },
		grid: { left: 20, right: 22, top: 48, bottom: 18, containLabel: true },
		xAxis: {
			type: 'category',
			boundaryGap: true,
			data: values.map((row) => row.date),
			axisLine: { lineStyle: { color: '#cbd5e1' } },
			axisTick: { show: false },
			axisLabel: { color: '#64748b', formatter: (value: string) => value.slice(0, 4) }
		},
		yAxis: [
			{
				type: 'value', name: '亿元', min: 0,
				nameTextStyle: { color: '#64748b' }, axisLabel: { color: '#64748b' },
				splitLine: { lineStyle: { color: '#e8edf3' } }
			},
			{
				type: 'value', name: '%', scale: true,
				nameTextStyle: { color: '#64748b' }, axisLabel: { color: '#64748b', formatter: '{value}%' },
				splitLine: { show: false }
			}
		],
		series: [
			{
				name: '负债余额', type: 'bar', yAxisIndex: 0, barMaxWidth: 18,
				itemStyle: { color: '#8aa0b8', borderRadius: [3, 3, 0, 0] },
				data: values.map((row) => Number(row.balanceYi ?? 0))
			},
			{
				name: '加权融资利率', type: 'line', yAxisIndex: 1, showSymbol: false, smooth: 0.18,
				lineStyle: { width: 3, color: '#d85b57' }, itemStyle: { color: '#d85b57' },
				data: values.map((row) => row.weightedRatePct == null ? null : Number(row.weightedRatePct))
			}
		],
		media: [{ query: { maxWidth: 560 }, option: { grid: { left: 8, right: 10, top: 70, bottom: 12, containLabel: true }, legend: { top: 0 } } }]
	});
</script>

{#if values.length}
	<EChart {option} ariaLabel="2021年以来公司负债余额与加权融资利率趋势，柱形为余额，折线为利率" height={20} />
{:else}
	<div class="chart-empty">暂无可靠的历史余额与利率数据</div>
{/if}

<style>
	.chart-empty { display: grid; min-height: 16rem; place-items: center; color: #64748b; font-size: 0.875rem; }
</style>
