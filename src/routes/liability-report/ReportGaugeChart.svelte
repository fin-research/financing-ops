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

	const hasValue = $derived(value != null && Number.isFinite(Number(value)));
	const safeValue = $derived(hasValue ? Math.max(0, Number(value)) : 0);
	const tone = $derived(!hasValue ? '#64748b' : safeValue >= limit ? '#dc2626' : safeValue >= warning ? '#d97706' : '#059669');
	const stateLabel = $derived(!hasValue ? '待配置' : safeValue >= limit ? '超上限' : safeValue >= warning ? '需关注' : '安全');
	const display = $derived(hasValue ? `${safeValue.toFixed(1)}%` : '—');
	const chartMax = $derived(Math.max(limit * 1.2, safeValue * 1.08, 1));
	const option = $derived({
		aria: { enabled: true },
		tooltip: {
			trigger: 'item',
			formatter: `${label}<br/>当前：${display}<br/>预警：${warning.toFixed(1)}% ｜ 上限：${maxLabel}`
		},
		series: [{
			type: 'gauge',
			startAngle: 215,
			endAngle: -35,
			center: ['50%', '56%'],
			radius: '88%',
			min: 0,
			max: chartMax,
			progress: { show: hasValue, width: 14, roundCap: true, itemStyle: { color: tone } },
			axisLine: {
				roundCap: true,
				lineStyle: {
					width: 14,
					color: [
						[Math.min(warning / chartMax, 1), '#d7f4e9'],
						[Math.min(limit / chartMax, 1), '#fcecc8'],
						[1, '#f8d9dc']
					]
				}
			},
			axisTick: { show: false },
			splitLine: { show: false },
			axisLabel: { show: false },
			pointer: { show: false },
			anchor: { show: false },
			detail: {
				valueAnimation: true,
				offsetCenter: [0, '2%'],
				color: '#163553',
				fontSize: 20,
				fontWeight: 800,
				formatter: display
			},
			data: [{ value: safeValue, name: stateLabel }]
		}]
	});
</script>

<EChart {option} ariaLabel={`${label}，当前 ${display}，状态 ${stateLabel}，预警 ${warning}% ，上限 ${maxLabel}`} height={6.8} />
