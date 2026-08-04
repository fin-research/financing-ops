<script lang="ts">
	import '../management.css';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import {
		CheckCircle2,
		Database,
		FileSpreadsheet,
		History,
		LoaderCircle,
		RefreshCw,
		ShieldCheck,
		Upload
	} from '@lucide/svelte';

	let { data } = $props();
	let detailsExpanded = $state(true);
	let actionState = $state<{
		key: string;
		status: 'idle' | 'pending' | 'success' | 'error';
		message: string;
	}>({ key: '', status: 'idle', message: '' });

	const fallback = {
		lastImport: null,
		importStats: {
			debtCount: 0,
			sourceRowCount: 0,
			cashflowEventCount: 0,
			historyBalanceRowCount: 0,
			historyDateCount: 0,
			historySpan: { startDate: null, endDate: null }
		}
	};
	const importData = $derived(data?.importData ?? fallback);

	const enhanceImport = (key: string): SubmitFunction => {
		return () => {
			actionState = { key, status: 'pending', message: '正在导入并核对，请稍候…' };
			return async ({ result, update }) => {
				if (result.type === 'success') {
					await update({ reset: false, invalidateAll: true });
					actionState = {
						key,
						status: 'success',
						message: 'Excel 已导入，余额与来源记录已完成核对'
					};
					return;
				}
				await update({ reset: false, invalidateAll: false });
				actionState = {
					key,
					status: 'error',
					message:
						result.type === 'failure'
							? String(result.data?.message ?? '导入失败，请检查文件后重试')
							: '导入失败，请稍后重试'
				};
			};
		};
	};
</script>

<svelte:head>
	<title>Excel 数据 · 融资工作台</title>
</svelte:head>

<div class="management-page data-page">
	<section class="page-heading">
		<div>
			<p class="eyebrow">DEBT DATA</p>
			<h1>Excel 数据</h1>
			<p>独立管理借入资金台账导入、来源追溯和余额核对</p>
		</div>
		<form method="post" action="?/reimport" use:enhance={enhanceImport('reimport')}>
			<button class="primary-action" type="submit" disabled={actionState.status === 'pending'}>
				{#if actionState.status === 'pending' && actionState.key === 'reimport'}
					<LoaderCircle size={16} class="spin" />
				{:else}
					<RefreshCw size={16} />
				{/if}
				重新导入基准表
			</button>
		</form>
	</section>

	{#if actionState.status !== 'idle'}
		<div
			class={`action-feedback ${actionState.status}`}
			role={actionState.status === 'error' ? 'alert' : 'status'}
			aria-live="polite"
		>
			{#if actionState.status === 'pending'}<LoaderCircle size={17} class="spin" />{:else}<CheckCircle2 size={17} />{/if}
			<span>{actionState.message}</span>
		</div>
	{/if}

	<section class="data-grid">
		<article class="section-card source-card">
			<div class="card-header">
				<div class="header-icon green"><FileSpreadsheet size={19} /></div>
				<div>
					<h2>当前数据源</h2>
					<p>源文件不会被静默改写</p>
				</div>
				<span class="status-badge"><CheckCircle2 size={13} /> 已完成</span>
			</div>
			<div class="source-summary">
				<div class="file-block">
					<span class="file-icon">XLSX</span>
					<div>
						<strong>{importData.lastImport?.sourceFile ?? '尚未导入'}</strong>
						<p>基准日期 2026-07-27</p>
					</div>
				</div>
				<div class="reconcile-block">
					<span>存续余额对账</span>
					<strong>1,180.7206 亿元</strong>
					<small><ShieldCheck size={14} /> 与汇总表一致</small>
				</div>
			</div>
		</article>

		<article class="section-card upload-card">
			<div class="card-header">
				<div class="header-icon blue"><Upload size={19} /></div>
				<div>
					<h2>上传新版台账</h2>
					<p>支持 .xlsx，最大 25MB</p>
				</div>
			</div>
			<form
				class="upload-zone"
				method="post"
				action="?/upload"
				enctype="multipart/form-data"
				use:enhance={enhanceImport('upload')}
			>
				<label>
					<span>选择 Excel 文件</span>
					<input name="workbook" type="file" accept=".xlsx" required />
				</label>
				<button class="secondary-action" type="submit" disabled={actionState.status === 'pending'}>
					<Upload size={15} />
					上传、校验并导入
				</button>
			</form>
		</article>

		<article class="section-card detail-card">
			<div class="card-header">
				<div class="header-icon violet"><Database size={19} /></div>
				<div>
					<h2>导入完整性</h2>
					<p>结构化数据和来源数据分层保存</p>
				</div>
				<button class="link-button" type="button" onclick={() => (detailsExpanded = !detailsExpanded)}>
					{detailsExpanded ? '收起' : '展开'}
				</button>
			</div>
			{#if detailsExpanded}
				<div class="stats-grid">
					<div><span>结构化债务</span><strong>{importData.importStats.debtCount.toLocaleString('zh-CN')} 条</strong></div>
					<div><span>完整来源行</span><strong>{importData.importStats.sourceRowCount.toLocaleString('zh-CN')} 条</strong></div>
					<div><span>付息/还本事件</span><strong>{importData.importStats.cashflowEventCount.toLocaleString('zh-CN')} 条</strong></div>
					<div><span>历史余额单元格</span><strong>{importData.importStats.historyBalanceRowCount.toLocaleString('zh-CN')} 条</strong></div>
					<div><span>唯一历史日期</span><strong>{importData.importStats.historyDateCount.toLocaleString('zh-CN')} 个</strong></div>
					<div>
						<span>历史范围</span>
						<strong>{importData.importStats.historySpan.startDate} — {importData.importStats.historySpan.endDate}</strong>
					</div>
				</div>
				<p class="quality-note">
					<History size={16} />
					所有现金流事件继续完整保存在数据库中；首页仅展示启用 SOP 所覆盖品种的事件。
				</p>
			{/if}
		</article>
	</section>
</div>

<style>
	.data-grid {
		display: grid;
		grid-template-columns: minmax(0, 1.2fr) minmax(20rem, 0.8fr);
		gap: 1rem;
	}

	.detail-card {
		grid-column: 1 / -1;
	}

	.source-summary {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
		gap: 1rem;
		padding: 1rem 1.125rem;
		border-top: 1px solid var(--line);
	}

	.file-block {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		min-width: 0;
	}

	.file-icon {
		padding: 0.5rem;
		border-radius: 0.375rem;
		font-size: 0.75rem;
		font-weight: 800;
		color: #067647;
		background: #ecfdf3;
	}

	.file-block strong {
		overflow-wrap: anywhere;
	}

	.file-block p {
		margin: 0.25rem 0 0;
		font-size: 0.75rem;
		color: #667085;
	}

	.reconcile-block {
		display: grid;
		gap: 0.1875rem;
		text-align: right;
	}

	.reconcile-block span,
	.reconcile-block small {
		font-size: 0.75rem;
		color: #667085;
	}

	.reconcile-block small {
		display: inline-flex;
		align-items: center;
		justify-content: flex-end;
		gap: 0.25rem;
		color: #067647;
	}

	.upload-zone {
		display: grid;
		gap: 0.75rem;
		padding: 1rem 1.125rem;
		border-top: 1px solid var(--line);
	}

	.upload-zone label {
		display: grid;
		gap: 0.375rem;
		font-weight: 650;
	}

	.upload-zone input {
		width: 100%;
		min-height: 2.75rem;
		padding: 0.5rem;
		border: 1px solid #d0d5dd;
		border-radius: 0.5rem;
	}

	.stats-grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 1px;
		border-top: 1px solid var(--line);
		background: var(--line);
	}

	.stats-grid > div {
		display: grid;
		gap: 0.25rem;
		padding: 1rem 1.125rem;
		background: #fff;
	}

	.stats-grid span {
		font-size: 0.75rem;
		color: #667085;
	}

	.quality-note {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin: 0;
		padding: 0.875rem 1.125rem;
		border-top: 1px solid #dbe6fb;
		color: #175cd3;
		background: #f8faff;
	}

	@media (max-width: 64rem) {
		.data-grid {
			grid-template-columns: 1fr;
		}

		.detail-card {
			grid-column: auto;
		}
	}

	@media (max-width: 51.25rem) {
		.source-summary,
		.stats-grid {
			grid-template-columns: 1fr;
		}

		.reconcile-block {
			text-align: left;
		}

		.reconcile-block small {
			justify-content: flex-start;
		}
	}
</style>
