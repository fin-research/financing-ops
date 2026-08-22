<script lang="ts">
	import '../management.css';
	import { CheckCircle2, Database, Network } from '@lucide/svelte';
	import DataAdminTable from '$lib/DataAdminTable.svelte';

	let { data } = $props();
	const management = $derived(data?.dataManagement ?? { overview: {} });
	const overview = $derived(management.overview ?? {});
</script>

<svelte:head>
	<title>数据后台 · 融资工作台</title>
</svelte:head>

<div class="management-page data-page">
	<section class="data-grid">
		<article class="section-card database-card">
			<div class="card-header">
				<div class="header-icon green"><Database size={19} /></div>
				<div><h2>融资数据库</h2></div>
				<span class="status-badge"><CheckCircle2 size={13} /> Neon Data API</span>
			</div>
			<div class="database-summary">
				<div class="connection-copy">
					<Network size={24} />
					<div>
						<strong>Neon · financing schema</strong>
						<p>JWT + PostgreSQL RLS</p>
					</div>
				</div>
				<div class="snapshot-total">
					<span>最近余额口径</span>
					<strong>{overview.totalYi == null ? '暂无可靠数据' : `${overview.totalYi.toFixed(4)} 亿元`}</strong>
					<small>{overview.asOfDate ?? '尚无快照日期'}</small>
				</div>
			</div>
			<div class="stats-grid">
				<div><span>负债</span><strong>{Number(overview.debtCount ?? 0).toLocaleString('zh-CN')} 笔</strong></div>
				<div><span>现金流</span><strong>{Number(overview.cashflowCount ?? 0).toLocaleString('zh-CN')} 条</strong></div>
				<div><span>历史日期</span><strong>{Number(overview.historyDateCount ?? 0).toLocaleString('zh-CN')} 个</strong></div>
				<div><span>历史范围</span><strong>{overview.historyStartDate ?? '暂无'} — {overview.historyEndDate ?? '暂无'}</strong></div>
			</div>
		</article>

		<DataAdminTable dataApiUrl={data.dataApiUrl} />
	</section>
</div>

<style>
	.data-page { padding-bottom: 5.5rem; }
	.data-grid { display: grid; gap: 1rem; }
	.database-summary { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 1rem; padding: 1rem 1.125rem; border-top: 1px solid var(--line); }
	.connection-copy { display: flex; align-items: center; gap: .75rem; min-width: 0; }
	.connection-copy p { margin: .25rem 0 0; font-size: .75rem; color: var(--muted); }
	.snapshot-total { display: grid; gap: .1875rem; text-align: right; }
	.snapshot-total span, .snapshot-total small { font-size: .75rem; color: var(--muted); }
	.snapshot-total strong { font-variant-numeric: tabular-nums; }
	.stats-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); border-top: 1px solid var(--line); }
	.stats-grid > div { display: grid; gap: .25rem; padding: 1rem; border-right: 1px solid var(--line); }
	.stats-grid > div:last-child { border-right: 0; }
	.stats-grid span { font-size: .75rem; color: var(--muted); }
	.stats-grid strong { font-variant-numeric: tabular-nums; }
	.status-badge { display: inline-flex; align-items: center; gap: .25rem; }
	@media (max-width: 64rem) { .stats-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
	@media (max-width: 35rem) {
		.database-summary { grid-template-columns: 1fr; }
		.snapshot-total { text-align: left; }
		.stats-grid { grid-template-columns: 1fr; }
		.stats-grid > div { border-right: 0; }
	}
</style>
