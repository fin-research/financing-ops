<script lang="ts">
	import EChart from '$lib/charts/EChart.svelte';

	let {
		label,
		value
	}: {
		label: string;
		value: number | null | undefined;
	} = $props();

	const percent = $derived(value == null || !Number.isFinite(Number(value)) ? null : Math.max(0, Number(value)));
	const tone = $derived(percent == null ? '#94a3b8' : percent >= 80 ? '#dc2626' : percent >= 45 ? '#d97706' : '#059669');
	const option = $derived({
		aria: { enabled: true },
		grid: { left: 0, right: 42, top: 4, bottom: 4 },
		xAxis: { type: 'value', min: 0, max: 100, show: false },
		yAxis: { type: 'category', data: [''], show: false },
		series: [{
			type: 'bar',
			barWidth: 8,
			showBackground: true,
			backgroundStyle: { color: '#e2e8f0', borderRadius: 8 },
			itemStyle: { color: tone, borderRadius: 8 },
			label: {
				show: true,
				position: 'right',
				distance: 8,
				color: tone,
				fontWeight: 750,
				fontSize: 11,
				formatter: percent == null ? '—' : `${percent.toFixed(1)}%`
			},
			data: [Math.min(percent ?? 0, 100)]
		}]
	});
</script>

<EChart {option} ariaLabel={`${label}额度使用率${percent == null ? '缺失' : `${percent.toFixed(1)}%`}`} height={2.5} />
