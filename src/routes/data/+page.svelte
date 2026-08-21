<script lang="ts">
	import '../management.css';
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { withBase } from '$lib/app-paths';
	import type { SubmitFunction } from '@sveltejs/kit';
	import {
		AlertCircle,
		CheckCircle2,
		Database,
		FileSpreadsheet,
		History,
		Landmark,
		LoaderCircle,
		RefreshCw,
		ShieldCheck,
		Upload
	} from '@lucide/svelte';

	let { data } = $props();
	let detailsExpanded = $state(true);
	let workbookInput: HTMLInputElement;
	let actionState = $state<{
		key: string;
		status: 'idle' | 'pending' | 'success' | 'error';
		message: string;
	}>({ key: '', status: 'idle', message: '' });

	const fallback = {
		financeParameters: [],
		lastImport: null,
		currentSnapshot: null,
		importStats: {
			debtCount: 0,
			fieldValueCount: 0,
			cashflowEventCount: 0,
			historyDateCount: 0,
			historySpan: { startDate: null, endDate: null }
		},
		statsReady: false,
		statsRefreshedAt: null
	};
	const importData = $derived(data?.importData ?? fallback);

	function rowChunks(rows: unknown[][], maximumBytes = 180_000) {
		const encoder = new TextEncoder();
		const chunks: unknown[][][] = [];
		let current: unknown[][] = [];
		let bytes = 2;
		for (const row of rows) {
			const rowBytes = encoder.encode(JSON.stringify(row)).byteLength + (current.length ? 1 : 0);
			if (current.length && (bytes + rowBytes > maximumBytes || current.length >= 2500)) {
				chunks.push(current);
				current = [];
				bytes = 2;
			}
			current.push(row);
			bytes += rowBytes;
		}
		if (current.length) chunks.push(current);
		return chunks;
	}

	async function importApi(body: Record<string, unknown>) {
		const response = await fetch(withBase('/api/import'), {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		});
		const result = await response.json();
		if (!response.ok) throw new Error(String(result.message ?? '导入失败'));
		return result;
	}

	async function handleWorkbookUpload(event: SubmitEvent) {
		event.preventDefault();
		const workbook = workbookInput?.files?.[0];
		if (!workbook) {
			actionState = { key: 'upload', status: 'error', message: '请选择 Excel 工作簿' };
			return;
		}
		if (!workbook.name.toLowerCase().endsWith('.xlsx') || workbook.size > 25 * 1024 * 1024) {
			actionState = { key: 'upload', status: 'error', message: '仅支持不超过 25MB 的 .xlsx 工作簿' };
			return;
		}
		actionState = { key: 'upload', status: 'pending', message: '正在本地解析并核对 Excel…' };
		try {
			const [
				{ parseDebtWorkbookData },
				{ buildTypedDebtData },
				{ sha256Hex },
				{ createImportDatasets, importDatasetCounts }
			] = await Promise.all([
				import('$lib/excel-import.js'),
				import('$lib/debt-details.js'),
				import('$lib/hash.js'),
				import('$lib/incremental-import.js')
			]);
			const workbookData = new Uint8Array(await workbook.arrayBuffer());
			const parsed = parseDebtWorkbookData(workbookData, workbook.name);
			const typed = buildTypedDebtData(parsed);
			const datasets = createImportDatasets(parsed, typed) as Record<string, unknown[][]>;
			const metadata = {
				workbookName: workbook.name,
				workbookHash: sha256Hex(workbookData),
				asOfDate: parsed.snapshot.asOfDate,
				snapshotTotalYi: parsed.snapshot.totalYi,
				historyStartDate: parsed.historyStartDate,
				historyEndDate: parsed.historyEndDate,
				debtCount: datasets.debts.length,
				fieldValueCount: parsed.fieldValueCount,
				cashflowCount: datasets.cashflows.length,
				historyDateCount: parsed.historyDateCount,
				excludedFutureCount: parsed.excludedFutureDates.length,
				datasetCounts: importDatasetCounts(datasets)
			};
			actionState = { key: 'upload', status: 'pending', message: '正在核对线上基准日与工作簿版本…' };
			const preflight = await importApi({ operation: 'preflight', metadata });
			if (preflight.unchanged) {
				workbookInput.value = '';
				actionState = {
					key: 'upload',
					status: 'success',
					message: `${workbook.name} 与线上版本一致，未产生 D1 写入`
				};
				return;
			}

			const incremental = Object.fromEntries(
				Object.keys(datasets).map((key) => [key, [] as unknown[][]])
			) as Record<string, unknown[][]>;
			incremental.balances = datasets.balances.filter((row) =>
				!preflight.maxBalanceDate || String(row[0]) > String(preflight.maxBalanceDate)
			);
			const chunks = Object.entries(datasets)
				.filter(([key]) => key !== 'balances')
				.flatMap(([key, rows]) => rowChunks(rows).map((chunk) => [key, chunk] as const));
			for (let index = 0; index < chunks.length; index += 1) {
				const [key, rows] = chunks[index];
				actionState = {
					key: 'upload', status: 'pending',
					message: `正在只读核对历史记录 ${index + 1}/${chunks.length}…`
				};
				const filtered = await importApi({
					operation: 'filter',
					expectedWorkbookHash: preflight.expectedWorkbookHash,
					key,
					rows
				});
				incremental[key].push(...filtered.newIndexes.map((rowIndex: number) => rows[rowIndex]));
			}
			actionState = { key: 'upload', status: 'pending', message: '正在原子写入新增日期与新增记录…' };
			const imported = await importApi({
				operation: 'commit',
				expectedWorkbookHash: preflight.expectedWorkbookHash,
				metadata,
				datasets: incremental
			});
			await invalidateAll();
			workbookInput.value = '';
			actionState = {
				key: 'upload', status: 'success',
				message: `${imported.sourceFile} 已增量更新至 ${imported.snapshot.asOfDate}，余额 ${Number(imported.snapshot.totalYi).toFixed(4)} 亿元；新增负债 ${imported.inserted}、新增日期 ${imported.newHistoryDateCount}、写入数据行 ${imported.insertedRows}`
			};
		} catch (error) {
			actionState = { key: 'upload', status: 'error', message: error instanceof Error ? error.message : String(error) };
		}
	}

	const enhanceParameters: SubmitFunction = () => {
		actionState = { key: 'finance', status: 'pending', message: '正在保存计算参数…' };
		return async ({ result, update }) => {
			if (result.type === 'success') {
				await update({ reset: false, invalidateAll: true });
				actionState = {
					key: 'finance',
					status: 'success',
					message: String(result.data?.message ?? '监管指标计算参数已更新')
				};
				return;
			}
			await update({ reset: false, invalidateAll: false });
			actionState = {
				key: 'finance',
				status: 'error',
				message: result.type === 'failure'
					? String(result.data?.message ?? '保存失败，请检查后重试')
					: '保存失败，请稍后重试'
			};
		};
	};

	const enhanceStatistics: SubmitFunction = () => {
		actionState = { key: 'statistics', status: 'pending', message: '正在扫描完整业务表并重新统计…' };
		return async ({ result, update }) => {
			if (result.type === 'success') {
				await update({ reset: false, invalidateAll: true });
				actionState = {
					key: 'statistics', status: 'success',
					message: String(result.data?.message ?? '统计快照已更新')
				};
				return;
			}
			await update({ reset: false, invalidateAll: false });
			actionState = {
				key: 'statistics', status: 'error',
				message: result.type === 'failure'
					? String(result.data?.message ?? '重新统计失败')
					: '重新统计失败，请稍后重试'
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
		<article class="section-card source-card">
			<div class="card-header">
				<div class="header-icon green"><FileSpreadsheet size={19} /></div>
				<div>
					<h2>当前数据源</h2>
					<p>仅保留最新工作簿对应的结构化数据</p>
				</div>
				<span class:pending={!importData.statsReady} class="status-badge">
					{#if importData.statsReady}<CheckCircle2 size={13} /> 已完成{:else}<History size={13} /> 待统计{/if}
				</span>
			</div>
			<div class="source-summary">
				<div class="file-block">
					<span class="file-icon">XLSX</span>
					<div>
						<strong>{importData.lastImport?.sourceFile ?? '尚未导入'}</strong>
						<p>当前口径 {importData.currentSnapshot?.asOfDate ?? '待导入'}</p>
					</div>
				</div>
				<div class="reconcile-block">
					<span>存续余额对账</span>
					<strong>{importData.currentSnapshot?.totalYi != null ? `${importData.currentSnapshot.totalYi.toFixed(4)} 亿元` : '待重新统计'}</strong>
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
				onsubmit={handleWorkbookUpload}
			>
				<label>
					<span>选择 Excel 文件</span>
					<input bind:this={workbookInput} name="workbook" type="file" accept=".xlsx" required />
				</label>
				<button class="secondary-action" type="submit" disabled={actionState.status === 'pending'}>
					<Upload size={15} />
					上传、校验并导入
				</button>
			</form>
		</article>

		<article class="section-card parameter-card">
			<div class="card-header">
				<div class="header-icon blue"><Landmark size={19} /></div>
				<div>
					<h2>监管指标计算参数</h2>
					<p>由管理员维护；未配置时仪表盘明确显示“待配置”</p>
				</div>
			</div>
			<form class="parameter-form" method="post" action="?/updateFinanceParameters" use:enhance={enhanceParameters}>
				{#each importData.financeParameters as parameter}
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
						{actionState.status === 'pending' && actionState.key === 'finance' ? '保存中…' : '保存参数'}
					</button>
				</div>
			</form>
		</article>

		<article class="section-card detail-card">
			<div class="card-header">
				<div class="header-icon violet"><Database size={19} /></div>
				<div>
					<h2>导入完整性</h2>
					<p>全部 Excel 字段均已规范化入库</p>
				</div>
				<div class="card-actions">
					{#if data.user?.role === 'admin'}
						<form method="post" action="?/recalculateStatistics" use:enhance={enhanceStatistics}>
							<button class="secondary-action" type="submit" disabled={actionState.status === 'pending'}>
								<RefreshCw size={15} class={actionState.status === 'pending' && actionState.key === 'statistics' ? 'spin' : undefined} />
								{actionState.status === 'pending' && actionState.key === 'statistics' ? '统计中…' : '重新统计'}
							</button>
						</form>
					{/if}
					<button class="link-button" type="button" onclick={() => (detailsExpanded = !detailsExpanded)}>
						{detailsExpanded ? '收起' : '展开'}
					</button>
				</div>
			</div>
			{#if detailsExpanded}
				<div class="stats-grid">
					<div><span>结构化债务</span><strong>{importData.importStats.debtCount.toLocaleString('zh-CN')} 条</strong></div>
					<div><span>字段值</span><strong>{importData.importStats.fieldValueCount.toLocaleString('zh-CN')} 条</strong></div>
					<div><span>付息/还本事件</span><strong>{importData.importStats.cashflowEventCount.toLocaleString('zh-CN')} 条</strong></div>
					<div><span>唯一历史日期</span><strong>{importData.importStats.historyDateCount.toLocaleString('zh-CN')} 个</strong></div>
					<div>
						<span>历史范围</span>
						<strong>{importData.importStats.historySpan.startDate ?? '待统计'} — {importData.importStats.historySpan.endDate ?? '待统计'}</strong>
					</div>
				</div>
					<p class="quality-note">
						<History size={16} />
						日常页面仅读取导入时保存的统计快照；只有管理员手动点击“重新统计”才会扫描完整业务表。
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

	.detail-card,
	.parameter-card {
		grid-column: 1 / -1;
	}

	.card-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.card-actions form {
		margin: 0;
	}

	.status-badge.pending {
		color: #b54708;
		background: #fffaeb;
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

	.parameter-form {
		display: grid;
		border-top: 1px solid var(--line);
	}

	.parameter-row {
		display: grid;
		grid-template-columns: minmax(13rem, 1.1fr) minmax(10rem, 0.8fr) minmax(10rem, 0.7fr);
		align-items: end;
		gap: 1rem;
		padding: 0.875rem 1.125rem;
		border-bottom: 1px solid var(--line);
	}

	.parameter-copy {
		display: grid;
		gap: 0.125rem;
	}

	.parameter-copy > span {
		width: fit-content;
		padding: 0.125rem 0.375rem;
		border-radius: 999rem;
		font-size: 0.75rem;
		font-weight: 700;
		color: #175cd3;
		background: #eff4ff;
	}

	.parameter-copy strong {
		font-size: 1rem;
		color: #1d2939;
	}

	.parameter-copy small {
		font-size: 0.75rem;
		line-height: 1.5;
		color: #667085;
	}

	.parameter-form label {
		display: grid;
		gap: 0.25rem;
	}

	.parameter-form label span {
		font-size: 0.75rem;
		font-weight: 650;
		color: #475467;
	}

	.parameter-form input {
		min-height: 2.75rem;
		padding: 0 0.75rem;
		border: 1px solid #d0d5dd;
		border-radius: 0.5rem;
		color: #344054;
		background: #fff;
		transition: border-color 180ms ease, box-shadow 180ms ease;
	}

	.parameter-form input:hover {
		border-color: #98a2b3;
	}

	.parameter-actions {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.875rem 1.125rem;
		background: #f8faff;
	}

	.parameter-actions p {
		margin: 0;
		font-size: 1rem;
		color: #475467;
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

		.parameter-row {
			grid-template-columns: 1fr;
		}

		.parameter-actions {
			align-items: stretch;
			flex-direction: column;
		}
	}
</style>
