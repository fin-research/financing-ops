<script lang="ts">
	import { ArrowLeft, CalendarDays, Database, Landmark } from '@lucide/svelte';
	let { data } = $props();
	const debt = $derived(data.debt);
	const amountYi = (value: number | null) => value == null ? '未登记' : `${(value / 100000000).toFixed(4)} 亿元`;
</script>

<svelte:head><title>{debt.instrumentName ?? debt.debtType} · 负债详情</title></svelte:head>

<a class="back-link" href="/"><ArrowLeft size={16} />返回仪表盘</a>
<section class="debt-heading">
	<div><p class="eyebrow">DEBT DETAIL</p><h1>{debt.instrumentName ?? debt.instrumentCode ?? debt.debtType}</h1></div>
	<span>{debt.categoryLevel1 ?? debt.debtType} / {debt.categoryLevel2 ?? debt.debtType}</span>
</section>

<section class="detail-grid">
	<article class="detail-card"><header><Landmark size={18} /><h2>核心信息</h2></header><dl>
		<div><dt>负债品种</dt><dd>{debt.debtType}</dd></div><div><dt>二级分类</dt><dd>{debt.categoryLevel2 ?? '无'}</dd></div>
		<div><dt>交易对手</dt><dd>{debt.counterparty ?? '未登记'}</dd></div><div><dt>借款主体</dt><dd>{debt.borrower ?? '未登记'}</dd></div>
		<div><dt>本金</dt><dd>{amountYi(debt.principalAmount)}</dd></div><div><dt>待偿余额</dt><dd>{amountYi(debt.outstandingAmount)}</dd></div>
		<div><dt>年化利率</dt><dd>{debt.annualRate == null ? '未登记' : `${(debt.annualRate * 100).toFixed(4)}%`}</dd></div><div><dt>币种</dt><dd>{debt.currency}</dd></div>
		<div><dt>起息日</dt><dd>{debt.issueDate ?? '未登记'}</dd></div><div><dt>到期日</dt><dd>{debt.maturityDate ?? '未登记'}</dd></div>
	</dl></article>

	<article class="detail-card"><header><CalendarDays size={18} /><h2>结构化现金流</h2></header><div class="cashflows">
		{#each debt.cashflows as flow}<div><time>{flow.eventDate}</time><strong>{flow.eventType === 'interest' ? '付息' : '还本'}</strong><span>{amountYi(flow.amount)}</span><small>{flow.sourceDateCell}{flow.sourceAmountCell ? ` / ${flow.sourceAmountCell}` : ''}</small></div>{:else}<p>该负债暂无独立结构化现金流记录。</p>{/each}
	</div></article>
</section>

<section class="detail-card source-card"><header><Database size={18} /><h2>来源追溯</h2><span>{debt.sourceFile} · {debt.sourceSheet}!{debt.sourceRow}</span></header><div class="source-grid">
	{#each debt.sourceFields as field}<div><span>{field.header ?? field.cell}</span><strong>{field.formatted ?? field.value ?? '-'}</strong><small>{field.cell}</small></div>{/each}
</div></section>

<style>
	.back-link{display:inline-flex;min-height:2.75rem;align-items:center;gap:.5rem;color:#175cd3}.debt-heading{display:flex;align-items:flex-end;justify-content:space-between;gap:1rem;margin:.5rem 0 1rem}.debt-heading h1{margin:0;font-size:var(--font-title-lg)}.debt-heading p{margin:.25rem 0 0;color:var(--muted)}.debt-heading>span{padding:.375rem .625rem;border-radius:999rem;font-size:.75rem;color:#175cd3;background:#eff4ff}
	.detail-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem}.detail-card{border:1px solid var(--line);border-radius:.625rem;background:#fff;box-shadow:var(--shadow)}.detail-card>header{display:flex;min-height:3.75rem;align-items:center;gap:.5rem;padding:.75rem 1rem;border-bottom:1px solid var(--line)}.detail-card h2{margin:0;font-size:1.125rem}.detail-card header>span{margin-left:auto;font-size:.75rem;color:var(--muted)}
	dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));margin:0}dl>div{padding:.75rem 1rem;border-bottom:1px solid var(--line)}dt{font-size:.75rem;color:var(--muted)}dd{margin:.25rem 0 0;font-weight:650;font-variant-numeric:tabular-nums}.cashflows{display:grid}.cashflows>div{display:grid;grid-template-columns:6.5rem 4rem minmax(0,1fr) auto;gap:.75rem;padding:.75rem 1rem;border-bottom:1px solid var(--line)}.cashflows span{font-variant-numeric:tabular-nums}.cashflows small{font-size:.75rem;color:var(--muted)}.cashflows p{padding:1rem;color:var(--muted)}
	.source-card{margin-top:1rem}.source-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1px;background:var(--line)}.source-grid>div{display:grid;gap:.25rem;padding:.75rem;background:#fff}.source-grid span,.source-grid small{font-size:.75rem;color:var(--muted)}.source-grid strong{overflow-wrap:anywhere}
	@media(max-width:64rem){.detail-grid{grid-template-columns:1fr}.source-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:35rem){.debt-heading{align-items:flex-start;flex-direction:column}dl,.source-grid{grid-template-columns:1fr}.cashflows>div{grid-template-columns:1fr 1fr}.cashflows small{grid-column:1/-1}}
</style>
