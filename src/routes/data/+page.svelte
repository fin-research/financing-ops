<script lang="ts">
	import '../management.css';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { AlertCircle, CheckCircle2, Database, Landmark, LoaderCircle, Network } from '@lucide/svelte';

	let { data } = $props();
	let actionState = $state<{
		status: 'idle' | 'pending' | 'success' | 'error';
		message: string;
	}>({ status: 'idle', message: '' });
	const management = $derived(data?.dataManagement ?? { financeParameters: [], overview: {} });
	const overview = $derived(management.overview ?? {});

	const enhanceParameters: SubmitFunction = () => {
		actionState = { status: 'pending', message: '正在保存计算参数…' };
		return async ({ result, update }) => {
			if (result.type === 'success') {
				await update({ reset: false, invalidateAll: true });
				actionState = {
					status: 'success',
					message: String(result.data?.message ?? '监管指标计算参数已更新')
				};
				return;
			}
			await update({ reset: false, invalidateAll: false });
			actionState = {
				status: 'error',
				message: result.type === 'failure'
					? String(result.data?.message ?? '保存失败，请检查后重试')
					: '保存失败，请稍后重试'
			};
		};
	};
</script>

<svelte:head>
	<title>数据后台 · 融资工作台</title>
</svelte:head>

<div class="management-page data-page">
	{#if actionState.status !== 'idle'}
		<div
			class={`action-feedback ${actionState.status}`}
			role={actionState.status === 'error' ? 'alert' : 'status'}
			aria-live="polite"
		>
			{#if actionState.status === 'pending'}
				<LoaderCircle size={17} class="spin" />
			{:else if actionState.status === 'error'}
				<AlertCircle size={17} />
			{:else}
				<CheckCircle2 size={17} />
			{/if}
			<span>{actionState.message}</span>
		</div>
	{/if}

	<section class="data-grid">
		<article class="section-card database-card">
			<div class="card-header">
				<div class="header-icon green"><Database size={19} /></div>
				<div><h2>融资数据库</h2></div>
				<span class="status-badge"><CheckCircle2 size={13} /> PostgreSQL</span>
			</div>
			<div class="database-summary">
				<div class="connection-copy">
					<Network size={24} />
					<div>
						<strong>Neon · financing schema</strong>
						<p>Worker 通过 Hyperdrive 池化连接</p>
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
				<div>
					<span>历史范围</span>
					<strong>{overview.historyStartDate ?? '暂无'} — {overview.historyEndDate ?? '暂无'}</strong>
				</div>
			</div>
		</article>

		<article class="section-card parameter-card">
			<div class="card-header">
				<div class="header-icon blue"><Landmark size={19} /></div>
				<div><h2>监管指标计算参数</h2></div>
			</div>
			<form class="parameter-form" method="post" action="?/updateFinanceParameters" use:enhance={enhanceParameters}>
				{#each management.financeParameters as parameter}
					<div class="parameter-row">
						<div class="parameter-copy">
							<span>计算基数</span>
							<strong>{parameter.label}</strong>
							<small>{parameter.notes}</small>
						</div>
						<label>
							<span>金额（亿元）</span>
							<input name={parameter.code} type="number" min="0.0001" step="0.0001" value={parameter.valueYi ?? ''} placeholder="待配置" />
						</label>
						<label>
							<span>口径日期</span>
							<input name={`${parameter.code}_period_end`} type="date" value={parameter.periodEnd ?? ''} />
						</label>
					</div>
				{/each}
				<div class="parameter-actions">
					<p>上月末净资本用于一年内短期负债占比和收益凭证额度计算。</p>
					<button class="primary-action" type="submit" disabled={actionState.status === 'pending'}>
						{actionState.status === 'pending' ? '保存中…' : '保存参数'}
					</button>
				</div>
			</form>
		</article>
	</section>
</div>

<style>
	.data-grid { display: grid; gap: 1rem; }
	.database-summary {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
		gap: 1rem;
		padding: 1rem 1.125rem;
		border-top: 1px solid var(--line);
	}
	.connection-copy { display: flex; align-items: center; gap: .75rem; min-width: 0; }
	.connection-copy p { margin: .25rem 0 0; font-size: .75rem; color: var(--muted); }
	.snapshot-total { display: grid; gap: .1875rem; text-align: right; }
	.snapshot-total span, .snapshot-total small { font-size: .75rem; color: var(--muted); }
	.snapshot-total strong { font-variant-numeric: tabular-nums; }
	.stats-grid {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		border-top: 1px solid var(--line);
	}
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
