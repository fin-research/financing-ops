<script lang="ts">
	let { rows = [] }: { rows?: Array<{ date?: string; balanceYi?: number; weightedRatePct?: number | null }> } = $props();
	const values = $derived(rows.filter((row) => Number(row.balanceYi) > 0));
	const width = 900;
	const height = 340;
	const pad = { left: 62, right: 68, top: 26, bottom: 48 };
	const maxBalance = $derived(Math.max(1, ...values.map((row) => Number(row.balanceYi ?? 0))) * 1.08);
	const rates = $derived(values.flatMap((row) => row.weightedRatePct == null ? [] : [Number(row.weightedRatePct)]));
	const rateMinRaw = $derived(rates.length ? Math.min(...rates) : 0);
	const rateMaxRaw = $derived(rates.length ? Math.max(...rates) : 1);
	const rateSpan = $derived(Math.max(0.2, rateMaxRaw - rateMinRaw));
	const rateMin = $derived(Math.max(0, rateMinRaw - rateSpan * 0.15));
	const rateMax = $derived(rateMaxRaw + rateSpan * 0.15);
	const yearTickIndexes = $derived(values.reduce((indexes: number[], row, index) => {
		const year = String(row.date ?? '').slice(0, 4);
		const previousYear = index ? String(values[index - 1]?.date ?? '').slice(0, 4) : '';
		if (year && year !== previousYear) indexes.push(index);
		return indexes;
	}, []));

	function x(index: number) { return pad.left + index / Math.max(1, values.length - 1) * (width - pad.left - pad.right); }
	function balanceY(value: number) { return pad.top + (maxBalance - value) / maxBalance * (height - pad.top - pad.bottom); }
	function rateY(value: number) { return pad.top + (rateMax - value) / Math.max(0.01, rateMax - rateMin) * (height - pad.top - pad.bottom); }
	function line() { return values.flatMap((row, index) => row.weightedRatePct == null ? [] : [`${index ? 'L' : 'M'}${x(index).toFixed(1)},${rateY(Number(row.weightedRatePct)).toFixed(1)}`]).join(' '); }
	function area() {
		if (!values.length) return '';
		const bottom = height - pad.bottom;
		return `M${x(0)},${bottom} ${values.map((row, index) => `L${x(index).toFixed(1)},${balanceY(Number(row.balanceYi)).toFixed(1)}`).join(' ')} L${x(values.length - 1)},${bottom} Z`;
	}
</script>

{#if values.length}
	<svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="2021年以来公司加权融资利率与负债余额走势">
		<title>2021年以来公司加权融资利率与负债余额走势</title>
		{#each [0, 1, 2, 3, 4] as index}
			{@const balanceTick = maxBalance * (4 - index) / 4}
			{@const rateTick = rateMin + (rateMax - rateMin) * (4 - index) / 4}
			<line x1={pad.left} x2={width - pad.right} y1={balanceY(balanceTick)} y2={balanceY(balanceTick)} class="grid-line" />
			<text x={pad.left - 10} y={balanceY(balanceTick) + 4} class="axis-label" text-anchor="end">{balanceTick.toFixed(0)}</text>
			<text x={width - pad.right + 10} y={balanceY(balanceTick) + 4} class="axis-label" text-anchor="start">{rateTick.toFixed(2)}%</text>
		{/each}
		<path d={area()} fill="#8aa0b8" opacity="0.88" />
		<path d={line()} fill="none" stroke="#d85b57" stroke-width="3.2" vector-effect="non-scaling-stroke" />
		{#each yearTickIndexes as index}
			<text x={x(index)} y={height - 16} class="axis-label" text-anchor={index === 0 ? 'start' : 'middle'}>{String(values[index]?.date ?? '').slice(0, 4)}</text>
		{/each}
	</svg>
	<div class="chart-legend"><span><i class="rate"></i>加权融资利率</span><span><i class="balance"></i>负债余额</span></div>
{:else}
	<div class="chart-empty">暂无可靠的历史余额与利率数据</div>
{/if}

<style>
	svg { display: block; width: 100%; height: auto; overflow: visible; }
	.grid-line { stroke: #e2e8f0; stroke-width: 1; }
	.axis-label { fill: #64748b; font-size: 0.75rem; font-weight: 600; }
	.chart-legend { display: flex; justify-content: center; gap: 1.25rem; margin-top: 0.25rem; color: #475569; font-size: 0.75rem; }
	.chart-legend span { display: inline-flex; align-items: center; gap: 0.35rem; }
	.chart-legend i { display: inline-block; width: 1.1rem; }
	.chart-legend .rate { height: 0; border-top: 0.125rem solid #d85b57; }
	.chart-legend .balance { height: 0.6rem; border-radius: 0.125rem; background: #8aa0b8; }
	.chart-empty { display: grid; min-height: 16rem; place-items: center; color: #64748b; font-size: 0.875rem; }
</style>
