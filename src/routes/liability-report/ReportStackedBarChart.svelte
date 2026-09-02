<script lang="ts">
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
	const width = 900;
	const groups = $derived(labels.map((label) => ({
		label,
		values: types.map((type) => Number(rows.find((row) => row.label === label && row.type === type)?.value ?? 0))
	})));
	const totals = $derived(groups.map((group) => group.values.reduce((sum, value) => sum + value, 0)));
	const maxTotal = $derived(Math.max(1, ...totals));
	const verticalPad = { left: 58, right: 18, top: 26, bottom: 54 };
	const horizontalPad = { left: 128, right: 54, top: 18, bottom: 42 };
	const ticks = $derived(Array.from({ length: 5 }, (_, index) => maxTotal * (4 - index) / 4));

	function verticalY(value: number) {
		return verticalPad.top + (maxTotal - value) / maxTotal * (height - verticalPad.top - verticalPad.bottom);
	}

	function compactLabel(label: string) {
		return label.includes('-') ? `${label.slice(2, 4)}/${Number(label.slice(5, 7))}` : label;
	}
</script>

<div class="stacked-chart">
	{#if groups.length && totals.some((value) => value > 0)}
		<svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
			<title>{title}</title>
			{#if horizontal}
				{#each groups as group, groupIndex}
					{@const rowHeight = (height - horizontalPad.top - horizontalPad.bottom) / groups.length}
					{@const barHeight = Math.min(25, rowHeight * 0.58)}
					<text x={horizontalPad.left - 12} y={horizontalPad.top + groupIndex * rowHeight + rowHeight / 2 + 5} class="category-label" text-anchor="end">{group.label}</text>
					{@const prior = { value: 0 }}
					{#each group.values as value, typeIndex}
						<rect x={horizontalPad.left + prior.value / maxTotal * (width - horizontalPad.left - horizontalPad.right)} y={horizontalPad.top + groupIndex * rowHeight + (rowHeight - barHeight) / 2} width={value / maxTotal * (width - horizontalPad.left - horizontalPad.right)} height={barHeight} fill={colors[typeIndex % colors.length]} rx="1.5" />
						{@const ignored = prior.value += value}
					{/each}
					<text x={horizontalPad.left + totals[groupIndex] / maxTotal * (width - horizontalPad.left - horizontalPad.right) + 8} y={horizontalPad.top + groupIndex * rowHeight + rowHeight / 2 + 5} class="value-label">{totals[groupIndex].toFixed(0)}</text>
				{/each}
			{:else}
				{#each ticks as tick}
					<line x1={verticalPad.left} x2={width - verticalPad.right} y1={verticalY(tick)} y2={verticalY(tick)} class="grid-line" />
					<text x={verticalPad.left - 10} y={verticalY(tick) + 4} class="axis-label" text-anchor="end">{tick.toFixed(0)}</text>
				{/each}
				{#each groups as group, groupIndex}
					{@const slot = (width - verticalPad.left - verticalPad.right) / groups.length}
					{@const barWidth = Math.min(48, slot * 0.62)}
					{@const prior = { value: 0 }}
					{#each group.values as value, typeIndex}
						<rect x={verticalPad.left + groupIndex * slot + (slot - barWidth) / 2} y={verticalY(prior.value + value)} width={barWidth} height={Math.max(0, verticalY(prior.value) - verticalY(prior.value + value))} fill={colors[typeIndex % colors.length]} rx="1.5" />
						{@const ignored = prior.value += value}
					{/each}
					<text x={verticalPad.left + groupIndex * slot + slot / 2} y={verticalY(totals[groupIndex]) - 8} class="value-label" text-anchor="middle">{totals[groupIndex].toFixed(1)}</text>
					<text x={verticalPad.left + groupIndex * slot + slot / 2} y={height - 18} class="category-label" text-anchor="middle">{compactLabel(group.label)}</text>
				{/each}
			{/if}
		</svg>
		<div class="chart-legend" aria-label="图例">
			{#each types as type, index}<span><i style={`--legend-color:${colors[index % colors.length]}`}></i>{type}</span>{/each}
		</div>
	{:else}
		<div class="chart-empty">暂无可靠分类数据</div>
	{/if}
</div>

<style>
	.stacked-chart { min-width: 0; }
	svg { display: block; width: 100%; height: auto; overflow: visible; }
	.grid-line { stroke: #e2e8f0; stroke-width: 1; }
	.axis-label, .category-label, .value-label { font-weight: 650; }
	.axis-label { fill: #64748b; font-size: 0.75rem; }
	.category-label { fill: #475569; font-size: 0.75rem; }
	.value-label { fill: #334155; font-size: 0.75rem; }
	.chart-legend { display: flex; flex-wrap: wrap; justify-content: center; gap: 0.35rem 0.9rem; margin-top: 0.25rem; color: #475569; font-size: 0.75rem; line-height: 1.35; }
	.chart-legend span { display: inline-flex; align-items: center; gap: 0.35rem; }
	.chart-legend i { width: 0.65rem; height: 0.65rem; border-radius: 0.125rem; background: var(--legend-color); }
	.chart-empty { display: grid; min-height: 13rem; place-items: center; color: #64748b; font-size: 0.875rem; }
</style>
