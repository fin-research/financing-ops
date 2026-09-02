<script lang="ts">
	import { onDestroy } from 'svelte';
	import { disposeChart, setChart, type ChartOption } from './echarts';

	let {
		option,
		ariaLabel,
		height = 18
	}: {
		option: ChartOption;
		ariaLabel: string;
		height?: number;
	} = $props();

	let host: HTMLDivElement;

	$effect(() => {
		const currentOption = option;
		if (host) setChart(host, currentOption);
	});

	onDestroy(() => {
		if (host) disposeChart(host);
	});
</script>

<div
	bind:this={host}
	class="echart-host"
	role="img"
	aria-label={ariaLabel}
	style:height={`${height}rem`}
></div>

<style>
	.echart-host { width: 100%; min-width: 0; }
</style>
