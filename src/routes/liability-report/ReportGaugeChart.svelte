<script lang="ts">
	import EChart from '$lib/charts/EChart.svelte';

	let {
		label,
		value,
		warning,
		limit,
		maxLabel
	}: {
		label: string;
		value: number | null | undefined;
		warning: number;
		limit: number;
		maxLabel: string;
	} = $props();

	const safeValue = $derived(value == null || !Number.isFinite(Number(value)) ? 0 : Math.max(0, Number(value)));
	const tone = $derived(value == null ? '#94a3b8' : safeValue >= limit ? '#dc2626' : safeValue >= warning ? '#d97706' : '#059669');
	const display = $derived(value == null ? '缺失' : `${safeValue.toFixed(1)}%`);
	const option = $derived({
		aria: { enabled: true },
		series: [{
			type: 'gauge',
			startAngle: 180,
			endAngle: 0,
			center: ['50%', '70%'],
			radius: '92%',
			min: 0,
			max: limit,
			progress: { show: true, width: 12, roundCap: true, itemStyle: { color: tone } },
			axisLine: { roundCap: true, lineStyle: { width: 12, color: [[1, '#e8edf4']] } },
			axisTick: { show: false },
			splitLine: { show: false },
			axisLabel: {
				distance: -34,
				color: '#94a3b8',
				fontSize: 10,
				formatter: (axisValue: number) => axisValue === 0 ? '0' : axisValue === limit ? maxLabel : ''
			},
			pointer: { show: false },
			anchor: { show: false },
			detail: { valueAnimation: true, offsetCenter: [0, '-4%'], color: tone, fontSize: 18, fontWeight: 750, formatter: display },
			data: [{ value: Math.min(safeValue, limit) }]
		}]
	});
</script>

<EChart {option} ariaLabel={`${label}，当前 ${display}，上限 ${maxLabel}`} height={6.6} />
