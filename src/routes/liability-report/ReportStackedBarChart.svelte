<script lang="ts">
	import EChart from '$lib/charts/EChart.svelte';

	let {
		title,
		rows = [],
		labels = [],
		types = [],
		height = 320,
		horizontal = false
	}: {
		title: string;
		rows?: Array<{ label: string; type: string; value: number }>;
		labels?: string[];
		types?: string[];
		height?: number;
		horizontal?: boolean;
	} = $props();

	const colors = ['#3e5c9a', '#4fa3d1', '#e06a74', '#8aa0b8', '#e0a24e', '#54bfa0', '#8b7bd9', '#7fd1b0'];
	const totals = $derived(labels.map((label) => rows.filter((row) => row.label === label).reduce((sum, row) => sum + Number(row.value ?? 0), 0)));
	const option = $derived({
		aria: { enabled: true, decal: { show: false } },
		color: colors,
		tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (value: unknown) => `${Number(value).toFixed(2)} 亿元` },
		legend: { type: 'scroll', top: 0, textStyle: { color: '#475569', fontSize: 12 } },
		grid: horizontal
			? { left: 12, right: 28, top: 50, bottom: 12, containLabel: true }
			: { left: 16, right: 10, top: 52, bottom: 18, containLabel: true },
		xAxis: horizontal
			? { type: 'value', name: '亿元', axisLabel: { color: '#64748b' }, nameTextStyle: { color: '#64748b' }, splitLine: { lineStyle: { color: '#e8edf3' } } }
			: { type: 'category', data: labels, axisLabel: { color: '#64748b', formatter: compactLabel }, axisTick: { show: false }, axisLine: { lineStyle: { color: '#cbd5e1' } } },
		yAxis: horizontal
			? { type: 'category', data: labels, axisLabel: { color: '#475569', width: 118, overflow: 'truncate' }, axisTick: { show: false }, axisLine: { show: false } }
			: { type: 'value', name: '亿元', axisLabel: { color: '#64748b' }, nameTextStyle: { color: '#64748b' }, splitLine: { lineStyle: { color: '#e8edf3' } } },
		series: types.map((type, index) => ({
			name: type,
			type: 'bar',
			stack: 'total',
			barMaxWidth: horizontal ? 24 : 44,
			itemStyle: { color: colors[index % colors.length], borderRadius: index === types.length - 1 ? (horizontal ? [0, 3, 3, 0] : [3, 3, 0, 0]) : 0 },
			emphasis: { focus: 'series' },
			label: index === types.length - 1 ? {
				show: true,
				position: horizontal ? 'right' : 'top',
				color: '#334155',
				fontSize: 11,
				formatter: (params: any) => totals[params.dataIndex]?.toFixed(1) ?? ''
			} : { show: false },
			data: labels.map((label) => Number(rows.find((row) => row.label === label && row.type === type)?.value ?? 0))
		})),
		media: [{ query: { maxWidth: 520 }, option: { grid: { left: 4, right: horizontal ? 20 : 4, top: 74, bottom: 10, containLabel: true }, legend: { top: 0, textStyle: { fontSize: 11 } } } }]
	});

	function compactLabel(label: string) {
		return label.includes('-') ? `${label.slice(2, 4)}/${Number(label.slice(5, 7))}` : label;
	}
</script>

{#if labels.length && totals.some((value) => value > 0)}
	<EChart {option} ariaLabel={`${title}，按 ${types.join('、')} 堆叠展示`} height={height / 16} />
{:else}
	<div class="chart-empty">暂无可靠分类数据</div>
{/if}

<style>
	.chart-empty { display: grid; min-height: 13rem; place-items: center; color: #64748b; font-size: 0.875rem; }
</style>
