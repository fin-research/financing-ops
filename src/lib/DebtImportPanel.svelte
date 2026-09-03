<script lang="ts">
	import { onMount } from 'svelte';
	import {
		AlertCircle,
		CheckCircle2,
		Clock3,
		Database,
		FileSpreadsheet,
		LoaderCircle,
		UploadCloud
	} from '@lucide/svelte';
	import { withBase } from './app-paths';
	import { globalMessages } from './global-messages';

	type ImportStatus = 'parsing' | 'queued' | 'running' | 'succeeded' | 'failed';
	type ImportStage = 'parsing' | 'queued' | 'importing' | 'refreshing' | 'finalizing' | 'completed';
	type ImportRun = {
		id: string;
		fileName: string;
		fileSizeBytes: number;
		status: ImportStatus;
		stage: ImportStage;
		progress: number;
		message: string;
		errorMessage: string | null;
		asOfDate: string | null;
		totalYi: number | null;
		sourceDebtCount: number | null;
		sourceCashflowCount: number | null;
		sourceBalanceCount: number | null;
		insertedDebtCount: number | null;
		updatedDebtCount: number | null;
		insertedCashflowCount: number | null;
		updatedCashflowCount: number | null;
		databaseDebtCount: number | null;
		databaseCashflowCount: number | null;
		historyDateCount: number | null;
		derivedMetricCount: number | null;
		createdAt: string;
		completedAt: string | null;
	};

	const stages: Array<{ key: ImportStage; label: string }> = [
		{ key: 'parsing', label: '解析校验' },
		{ key: 'queued', label: '等待执行' },
		{ key: 'importing', label: '更新台账' },
		{ key: 'refreshing', label: '刷新衍生' },
		{ key: 'finalizing', label: '最终核对' },
		{ key: 'completed', label: '完成' }
	];

	let selectedFile = $state<File | null>(null);
	let runs = $state<ImportRun[]>([]);
	let loadingHistory = $state(true);
	let uploading = $state(false);
	let pollTimer: ReturnType<typeof setTimeout> | null = null;
	const activeRun = $derived(runs.find((run) => ['parsing', 'queued', 'running'].includes(run.status)) ?? null);
	const displayedRun = $derived(activeRun ?? runs[0] ?? null);

	function upsertRun(run: ImportRun) {
		runs = [run, ...runs.filter((item) => item.id !== run.id)]
			.sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
			.slice(0, 8);
	}

	function formatFileSize(bytes: number) {
		return bytes >= 1024 * 1024
			? `${(bytes / 1024 / 1024).toFixed(1)} MB`
			: `${Math.max(1, Math.round(bytes / 1024))} KB`;
	}

	function formatDateTime(value: string | null) {
		if (!value) return '—';
		return new Intl.DateTimeFormat('zh-CN', {
			timeZone: 'Asia/Shanghai',
			month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
		}).format(new Date(value));
	}

	function stageIndex(run: ImportRun) {
		if (run.status === 'failed') return Math.max(0, stages.findIndex((item) => item.key === run.stage));
		return stages.findIndex((item) => item.key === run.stage);
	}

	function stageState(run: ImportRun, index: number) {
		const current = stageIndex(run);
		if (run.status === 'failed' && index === current) return 'failed';
		if (index < current || run.status === 'succeeded') return 'done';
		if (index === current) return 'active';
		return 'pending';
	}

	function schedulePoll(runId: string, delay = 1500) {
		if (pollTimer) clearTimeout(pollTimer);
		pollTimer = setTimeout(() => void pollRun(runId), delay);
	}

	async function pollRun(runId: string) {
		try {
			const response = await fetch(withBase(`/data/import/${encodeURIComponent(runId)}`), {
				headers: { Accept: 'application/json' }
			});
			if (response.status === 404 && uploading) {
				schedulePoll(runId, 500);
				return;
			}
			const payload = await response.json();
			if (!response.ok) throw new Error(payload.error ?? '导入进度读取失败');
			upsertRun(payload.run);
			if (['parsing', 'queued', 'running'].includes(payload.run.status)) schedulePoll(runId);
		} catch (error) {
			const current = runs.find((run) => run.id === runId);
			if (uploading || (current && ['parsing', 'queued', 'running'].includes(current.status))) {
				schedulePoll(runId, 3000);
			} else {
				globalMessages.error(error instanceof Error ? error.message : String(error), {
					key: 'debt-import-progress',
					title: '导入进度读取失败'
				});
			}
		}
	}

	async function loadRuns() {
		loadingHistory = true;
		try {
			const response = await fetch(withBase('/data/import'), { headers: { Accept: 'application/json' } });
			const payload = await response.json();
			if (!response.ok) throw new Error(payload.error ?? '导入记录读取失败');
			runs = payload.runs ?? [];
			const active = runs.find((run) => ['parsing', 'queued', 'running'].includes(run.status));
			if (active) schedulePoll(active.id, 500);
		} catch (error) {
			globalMessages.error(error instanceof Error ? error.message : String(error), {
				key: 'debt-import-history',
				title: '导入记录读取失败'
			});
		} finally {
			loadingHistory = false;
		}
	}

	function chooseFile(event: Event) {
		selectedFile = (event.currentTarget as HTMLInputElement).files?.[0] ?? null;
	}

	async function uploadWorkbook() {
		if (!selectedFile || uploading || activeRun) return;
		if (!selectedFile.name.toLowerCase().endsWith('.xlsx')) {
			globalMessages.error('仅支持 .xlsx 格式的借入资金汇总表', { key: 'debt-import-upload' });
			return;
		}
		if (selectedFile.size > 10 * 1024 * 1024) {
			globalMessages.error('文件超过 10 MB 上限', { key: 'debt-import-upload' });
			return;
		}

		const runId = crypto.randomUUID();
		const optimistic: ImportRun = {
			id: runId,
			fileName: selectedFile.name,
			fileSizeBytes: selectedFile.size,
			status: 'parsing',
			stage: 'parsing',
			progress: 10,
			message: '正在上传并直接解析工作簿',
			errorMessage: null,
			asOfDate: null,
			totalYi: null,
			sourceDebtCount: null,
			sourceCashflowCount: null,
			sourceBalanceCount: null,
			insertedDebtCount: null,
			updatedDebtCount: null,
			insertedCashflowCount: null,
			updatedCashflowCount: null,
			databaseDebtCount: null,
			databaseCashflowCount: null,
			historyDateCount: null,
			derivedMetricCount: null,
			createdAt: new Date().toISOString(),
			completedAt: null
		};
		uploading = true;
		upsertRun(optimistic);
		schedulePoll(runId, 500);
		try {
			const response = await fetch(withBase('/data/import'), {
				method: 'POST',
				body: selectedFile,
				headers: {
					'content-type': selectedFile.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
					'x-import-filename': encodeURIComponent(selectedFile.name),
					'x-import-file-size': String(selectedFile.size),
					'x-import-run-id': runId,
					Accept: 'application/json'
				}
			});
			const payload = await response.json();
			if (!response.ok) throw new Error(payload.error ?? '工作簿上传失败');
			upsertRun(payload.run);
			selectedFile = null;
			const input = document.querySelector<HTMLInputElement>('#debt-import-file');
			if (input) input.value = '';
			schedulePoll(runId, 250);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			upsertRun({
				...optimistic,
				status: 'failed',
				message: '导入失败，请按提示修正后重新上传',
				errorMessage: message,
				completedAt: new Date().toISOString()
			});
			globalMessages.error(message, { key: 'debt-import-upload', title: '台账导入失败' });
		} finally {
			uploading = false;
		}
	}

	onMount(() => {
		void loadRuns();
		return () => {
			if (pollTimer) clearTimeout(pollTimer);
		};
	});
</script>

<section class="section-card import-card" aria-labelledby="debt-import-title">
	<div class="card-header">
		<div class="header-icon blue"><FileSpreadsheet size={20} /></div>
		<div>
			<h2 id="debt-import-title">在线导入借入资金汇总表</h2>
			<p>上传后立即解析，原始 Excel 不留存；校验通过后由 Workflow 更新线上台账和衍生指标。</p>
		</div>
		<div class="header-actions">
			<label class="secondary-action file-picker" class:disabled={Boolean(activeRun) || uploading}>
				<FileSpreadsheet size={18} />
				<span>选择文件</span>
				<input id="debt-import-file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onchange={chooseFile} disabled={Boolean(activeRun) || uploading} />
			</label>
			<button class="primary-action" type="button" onclick={() => void uploadWorkbook()} disabled={!selectedFile || Boolean(activeRun) || uploading}>
				{#if uploading}<LoaderCircle class="spin" size={18} />{:else}<UploadCloud size={18} />{/if}
				上传并导入
			</button>
		</div>
	</div>

	<div class="import-body">
		{#if selectedFile && !activeRun}
			<div class="selected-file" aria-live="polite">
				<FileSpreadsheet size={18} />
				<strong>{selectedFile.name}</strong>
				<span>{formatFileSize(selectedFile.size)}</span>
			</div>
		{/if}

		{#if displayedRun}
			<div class:failed={displayedRun.status === 'failed'} class:complete={displayedRun.status === 'succeeded'} class="run-panel" aria-live="polite">
				<div class="run-heading">
					<div>
						<strong>{displayedRun.fileName}</strong>
						<span>{formatFileSize(displayedRun.fileSizeBytes)} · {formatDateTime(displayedRun.createdAt)}</span>
					</div>
					<span class="run-status">
						{#if displayedRun.status === 'failed'}<AlertCircle size={17} /> 导入失败
						{:else if displayedRun.status === 'succeeded'}<CheckCircle2 size={17} /> 已完成
						{:else}<LoaderCircle class="spin" size={17} /> 处理中{/if}
					</span>
				</div>
				<progress max="100" value={displayedRun.progress} aria-label={`台账导入进度 ${displayedRun.progress}%`}></progress>
				<div class="progress-copy">
					<span>{displayedRun.message}</span>
					<strong>{displayedRun.progress}%</strong>
				</div>
				<ol class="stage-list" aria-label="导入阶段">
					{#each stages as stage, index}
						{@const state = stageState(displayedRun, index)}
						<li class:done={state === 'done'} class:active={state === 'active'} class:failed={state === 'failed'}>
							<span>{#if state === 'done'}<CheckCircle2 size={16} />{:else if state === 'failed'}<AlertCircle size={16} />{:else}<Clock3 size={16} />{/if}</span>
							{stage.label}
						</li>
					{/each}
				</ol>

				{#if displayedRun.errorMessage}
					<p class="run-error" role="alert">{displayedRun.errorMessage}</p>
				{/if}

				{#if displayedRun.asOfDate}
					<div class="summary-grid">
						<div><span>台账基准日</span><strong>{displayedRun.asOfDate}</strong></div>
						<div><span>汇总余额</span><strong>{displayedRun.totalYi?.toLocaleString('zh-CN')} 亿元</strong></div>
						<div><span>负债记录</span><strong>{displayedRun.sourceDebtCount?.toLocaleString('zh-CN')} 笔</strong></div>
						<div><span>现金流记录</span><strong>{displayedRun.sourceCashflowCount?.toLocaleString('zh-CN')} 笔</strong></div>
						{#if displayedRun.status === 'succeeded'}
							<div><span>负债新增 / 更新</span><strong>{displayedRun.insertedDebtCount} / {displayedRun.updatedDebtCount}</strong></div>
							<div><span>现金流新增 / 更新</span><strong>{displayedRun.insertedCashflowCount} / {displayedRun.updatedCashflowCount}</strong></div>
							<div><span>余额历史日期</span><strong>{displayedRun.historyDateCount} 个</strong></div>
							<div><span>衍生月度指标</span><strong>{displayedRun.derivedMetricCount} 期</strong></div>
						{/if}
					</div>
				{/if}
			</div>
		{:else if loadingHistory}
			<div class="loading-state"><LoaderCircle class="spin" size={18} /> 正在读取导入记录</div>
		{:else}
			<div class="empty-import"><Database size={20} /> 暂无线上导入记录</div>
		{/if}
	</div>
</section>

<style>
	.import-card { margin-bottom: 1rem; }
	.file-picker { position: relative; cursor: pointer; }
	.file-picker.disabled { cursor: not-allowed; opacity: .55; }
	.file-picker input { position: absolute; inset: 0; cursor: pointer; opacity: 0; }
	.file-picker.disabled input { cursor: not-allowed; }
	.import-body { display: grid; gap: .75rem; padding: 0 1.125rem 1.125rem; border-top: 1px solid var(--line); }
	.selected-file { display: flex; min-width: 0; align-items: center; gap: .5rem; margin-top: 1rem; padding: .75rem; border: 1px solid var(--line); border-radius: .5rem; background: var(--blue-soft); }
	.selected-file strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.selected-file span { margin-left: auto; color: var(--muted); white-space: nowrap; }
	.run-panel { display: grid; gap: .75rem; margin-top: 1rem; padding: 1rem; border: 1px solid var(--line); border-radius: .625rem; background: var(--surface); }
	.run-panel.complete { border-color: color-mix(in srgb, var(--teal) 38%, var(--line)); }
	.run-panel.failed { border-color: color-mix(in srgb, var(--red) 38%, var(--line)); }
	.run-heading, .progress-copy { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
	.run-heading > div { display: grid; min-width: 0; }
	.run-heading strong { overflow-wrap: anywhere; }
	.run-heading span, .progress-copy span { color: var(--muted); }
	.run-status { display: inline-flex; flex: 0 0 auto; align-items: center; gap: .375rem; font-weight: 700; color: var(--blue) !important; }
	.complete .run-status { color: var(--teal) !important; }
	.failed .run-status { color: var(--red) !important; }
	progress { width: 100%; height: .625rem; overflow: hidden; border: 0; border-radius: 999rem; accent-color: var(--blue); }
	.complete progress { accent-color: var(--teal); }
	.failed progress { accent-color: var(--red); }
	.progress-copy { font-size: .75rem; }
	.stage-list { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: .5rem; margin: 0; padding: 0; list-style: none; }
	.stage-list li { display: flex; min-width: 0; align-items: center; gap: .375rem; color: var(--subtle); font-size: .75rem; }
	.stage-list li span { display: grid; flex: 0 0 auto; place-items: center; }
	.stage-list li.done { color: var(--teal); }
	.stage-list li.active { color: var(--blue); font-weight: 700; }
	.stage-list li.failed { color: var(--red); font-weight: 700; }
	.run-error { margin: 0; padding: .75rem; border-radius: .5rem; color: var(--red); background: color-mix(in srgb, var(--red) 7%, var(--surface)); }
	.summary-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: .5rem; padding-top: .75rem; border-top: 1px solid var(--line); }
	.summary-grid div { display: grid; gap: .1875rem; padding: .625rem; border-radius: .5rem; background: var(--canvas); }
	.summary-grid span { color: var(--muted); font-size: .75rem; }
	.summary-grid strong { font-variant-numeric: tabular-nums; }
	.loading-state, .empty-import { display: flex; align-items: center; justify-content: center; gap: .5rem; min-height: 5rem; margin-top: 1rem; color: var(--muted); }
	@media (max-width: 64rem) {
		.stage-list { grid-template-columns: repeat(3, minmax(0, 1fr)); }
		.summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
	}
	@media (max-width: 35rem) {
		.import-body { padding-inline: .75rem; }
		.header-actions { width: 100%; flex-wrap: wrap; }
		.header-actions > * { flex: 1 1 auto; }
		.run-heading, .progress-copy { align-items: flex-start; flex-direction: column; gap: .25rem; }
		.stage-list, .summary-grid { grid-template-columns: 1fr 1fr; }
	}
	@media (prefers-reduced-motion: reduce) {
		:global(.spin) { animation: none; }
	}
</style>
