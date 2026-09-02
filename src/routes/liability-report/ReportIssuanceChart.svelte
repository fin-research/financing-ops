<script lang="ts">
	let { rows = [] }: { rows?: Array<{ month: string; type: string; amountYi: number; weightedRatePct?: number | null }> } = $props();
	const colors = ['#8aa0b8', '#3e5c9a', '#4fa3d1', '#e06a74', '#e0a24e'];
	const width = 900;
	const height = 330;
	const pad = { left: 58, right: 66, top: 28, bottom: 58 };
	const months = $derived([...new Set(rows.map((row) => row.month))].sort());
	const types = $derived([...new Set(rows.map((row) => row.type))]);
	const totals = $derived(months.map((month) => rows.filter((row) => row.month === month).reduce((sum, row) => sum + Number(row.amountYi ?? 0), 0)));
	const maxAmount = $derived(Math.max(1, ...totals) * 1.12);
	const rateValues = $derived(rows.flatMap((row) => row.weightedRatePct == null ? [] : [Number(row.weightedRatePct)]));
	const minRate = $derived(rateValues.length ? Math.max(0, Math.min(...rateValues) - 0.15) : 0);
	const maxRate = $derived(rateValues.length ? Math.max(...rateValues) + 0.15 : 1);
	function amountY(value: number) { return pad.top + (maxAmount - value) / maxAmount * (height - pad.top - pad.bottom); }
	function rateY(value: number) { return pad.top + (maxRate - value) / Math.max(0.05, maxRate - minRate) * (height - pad.top - pad.bottom); }
</script>

{#if months.length && totals.some((value) => value > 0)}
	<svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="近一年公司债券发行规模及利率走势">
		<title>近一年公司债券发行规模及利率走势</title>
		{#each [0, 1, 2, 3, 4] as tick}
			{@const value = maxAmount * (4 - tick) / 4}
			<line x1={pad.left} x2={width - pad.right} y1={amountY(value)} y2={amountY(value)} class="grid-line" />
			<text x={pad.left - 10} y={amountY(value) + 4} class="axis-label" text-anchor="end">{value.toFixed(0)}</text>
			<text x={width - pad.right + 10} y={amountY(value) + 4} class="axis-label">{(minRate + (maxRate - minRate) * (4 - tick) / 4).toFixed(2)}%</text>
		{/each}
		{#each months as month, monthIndex}
			{@const slot = (width - pad.left - pad.right) / months.length}
			{@const barWidth = Math.min(44, slot * 0.6)}
			{@const prior = { value: 0 }}
			{#each types as type, typeIndex}
				{@const row = rows.find((item) => item.month === month && item.type === type)}
				{@const value = Number(row?.amountYi ?? 0)}
				<rect x={pad.left + monthIndex * slot + (slot - barWidth) / 2} y={amountY(prior.value + value)} width={barWidth} height={Math.max(0, amountY(prior.value) - amountY(prior.value + value))} fill={colors[typeIndex % colors.length]} rx="1.5" />
				{@const ignored = prior.value += value}
			{/each}
			<text x={pad.left + monthIndex * slot + slot / 2} y={height - 18} class="month-label" text-anchor="middle">{month.slice(2).replace('-', '/')}</text>
		{/each}
		{#each types as type, typeIndex}
			{@const lineRows = months.flatMap((month, monthIndex) => {
				const row = rows.find((item) => item.month === month && item.type === type && item.weightedRatePct != null);
				return row ? [{ monthIndex, value: Number(row.weightedRatePct) }] : [];
			})}
			{#if lineRows.length > 1}
				<path d={lineRows.map((row, index) => `${index ? 'L' : 'M'}${pad.left + (row.monthIndex + 0.5) * (width - pad.left - pad.right) / months.length},${rateY(row.value)}`).join(' ')} fill="none" stroke={colors[typeIndex % colors.length]} stroke-width="2.6" stroke-dasharray={typeIndex % 2 ? '7 3' : ''} vector-effect="non-scaling-stroke" />
			{/if}
		{/each}
	</svg>
	<div class="chart-legend">{#each types as type, index}<span><i style={`--legend-color:${colors[index % colors.length]}`}></i>{type}</span>{/each}</div>
{:else}
	<div class="chart-empty">近一年暂无可靠公司债发行数据</div>
{/if}

<style>
	svg { display: block; width: 100%; height: auto; overflow: visible; }
	.grid-line { stroke: #e2e8f0; stroke-width: 1; }
	.axis-label, .month-label { fill: #64748b; font-size: 0.75rem; font-weight: 600; }
	.chart-legend { display: flex; flex-wrap: wrap; justify-content: center; gap: 0.35rem 0.9rem; margin-top: 0.25rem; color: #475569; font-size: 0.75rem; }
	.chart-legend span { display: inline-flex; align-items: center; gap: 0.35rem; }
	.chart-legend i { width: 0.65rem; height: 0.65rem; border-radius: 0.125rem; background: var(--legend-color); }
	.chart-empty { display: grid; min-height: 16rem; place-items: center; color: #64748b; font-size: 0.875rem; }
</style>
