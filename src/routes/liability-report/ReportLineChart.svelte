<script lang="ts">
	let {
		title,
		rows = [],
		height = 320,
		compact = false
	}: {
		title: string;
		rows?: Array<{ seriesId?: string; seriesName?: string; observationDate?: string; value?: number | null }>;
		height?: number;
		compact?: boolean;
	} = $props();

	const colors = ['#172f4f', '#3e5c9a', '#4fa3d1', '#54bfa0', '#e06a74', '#8b7bd9'];
	const dashes = ['', '8 4', '3 3', '10 3 2 3', '6 3', '2 3'];
	const width = 900;
	const pad = $derived(compact
		? { left: 58, right: 18, top: 22, bottom: 42 }
		: { left: 62, right: 22, top: 24, bottom: 46 });
	const series = $derived(groupRows(rows));
	const values = $derived(series.flatMap((item) => item.points.map((point) => point.value)));
	const dateValues = $derived(series.flatMap((item) => item.points.map((point) => point.time)));
	const minDate = $derived(dateValues.length ? Math.min(...dateValues) : 0);
	const maxDate = $derived(dateValues.length ? Math.max(...dateValues) : 1);
	const rawMin = $derived(values.length ? Math.min(...values) : 0);
	const rawMax = $derived(values.length ? Math.max(...values) : 1);
	const span = $derived(Math.max(0.05, rawMax - rawMin));
	const minValue = $derived(Math.max(0, rawMin - span * 0.12));
	const maxValue = $derived(rawMax + span * 0.12);
	const ticks = $derived(Array.from({ length: 5 }, (_, index) => minValue + (maxValue - minValue) * (4 - index) / 4));
	const dateTicks = $derived(minDate
		? [minDate, minDate + (maxDate - minDate) / 2, maxDate]
		: []);

	function groupRows(input: typeof rows) {
		const grouped = new Map<string, { id: string; name: string; points: Array<{ time: number; value: number }> }>();
		for (const row of input) {
			const value = Number(row.value);
			const time = Date.parse(`${String(row.observationDate ?? '').slice(0, 10)}T00:00:00Z`);
			if (!Number.isFinite(value) || !Number.isFinite(time)) continue;
			const id = String(row.seriesId ?? row.seriesName ?? 'series');
			const item = grouped.get(id) ?? { id, name: String(row.seriesName ?? id), points: [] };
			item.points.push({ time, value });
			grouped.set(id, item);
		}
		return [...grouped.values()].map((item) => {
			item.points.sort((a, b) => a.time - b.time);
			if (item.points.length > 160) {
				const step = Math.ceil(item.points.length / 160);
				item.points = item.points.filter((_, index) => index % step === 0 || index === item.points.length - 1);
			}
			return item;
		});
	}

	function x(time: number) {
		return pad.left + (time - minDate) / Math.max(1, maxDate - minDate) * (width - pad.left - pad.right);
	}

	function y(value: number) {
		return pad.top + (maxValue - value) / Math.max(0.0001, maxValue - minValue) * (height - pad.top - pad.bottom);
	}

	function line(points: Array<{ time: number; value: number }>) {
		return points.map((point, index) => `${index ? 'L' : 'M'}${x(point.time).toFixed(1)},${y(point.value).toFixed(1)}`).join(' ');
	}

	function tickDate(time: number) {
		const value = new Date(time);
		return `${value.getUTCMonth() + 1}月`;
	}
</script>

<div class:compact class="line-chart">
	{#if series.length}
		<svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
			<title>{title}</title>
			{#each ticks as tick}
				<line x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} class="grid-line" />
				<text x={pad.left - 10} y={y(tick) + 4} class="axis-label" text-anchor="end">{tick.toFixed(2)}%</text>
			{/each}
			{#each dateTicks as tick, index}
				<text x={x(tick)} y={height - 14} class="axis-label" text-anchor={index === 0 ? 'start' : index === dateTicks.length - 1 ? 'end' : 'middle'}>{tickDate(tick)}</text>
			{/each}
			{#each series as item, index}
				<path d={line(item.points)} fill="none" stroke={colors[index % colors.length]} stroke-width={compact ? 2.6 : 3.2} stroke-dasharray={dashes[index % dashes.length]} vector-effect="non-scaling-stroke" />
			{/each}
		</svg>
		<div class="chart-legend" aria-label="图例">
			{#each series as item, index}
				<span><i style={`--legend-color:${colors[index % colors.length]};--legend-dash:${dashes[index % dashes.length] || 'none'}`}></i>{item.name}</span>
			{/each}
		</div>
	{:else}
		<div class="chart-empty">暂无可靠历史序列</div>
	{/if}
</div>

<style>
	.line-chart { min-width: 0; }
	svg { display: block; width: 100%; height: auto; overflow: visible; }
	.grid-line { stroke: #e2e8f0; stroke-width: 1; }
	.axis-label { fill: #64748b; font-size: 0.75rem; font-weight: 600; }
	.chart-legend { display: flex; flex-wrap: wrap; justify-content: center; gap: 0.35rem 0.9rem; margin-top: 0.25rem; color: #475569; font-size: 0.75rem; line-height: 1.35; }
	.chart-legend span { display: inline-flex; align-items: center; gap: 0.35rem; }
	.chart-legend i { width: 1.2rem; height: 0; border-top: 0.125rem dashed var(--legend-color); }
	.chart-empty { display: grid; min-height: 13rem; place-items: center; color: #64748b; font-size: 0.875rem; }
	.compact .chart-empty { min-height: 9rem; }
</style>
