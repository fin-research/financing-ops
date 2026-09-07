<script lang="ts">
	import { onMount } from 'svelte';
	import { Landmark, LoaderCircle, Pencil, Plus, RefreshCw, X } from '@lucide/svelte';
	import type { DataRow } from './data-admin';
	import { FINANCE_PARAMETER_CONFIG, FINANCE_PARAMETERS, financeParameterDefinition, financeParameterPayload, financeParameterValue } from './finance-parameters';
	import { NeonDataApi } from './neon-data-api';

	const api = new NeonDataApi();
	let rows = $state<DataRow[]>([]);
	let loading = $state(true);
	let loadError = $state('');
	let saveError = $state('');
	let saving = $state(false);
	let notice = $state('');
	let dialog: HTMLDialogElement;
	let original = $state<DataRow | null>(null);
	let code = $state('');
	let value = $state('');
	let periodEnd = $state('');
	let notes = $state('');
	const missing = $derived(FINANCE_PARAMETERS.filter((parameter) => !rows.some((row) => row.code === parameter.code)));
	const cards = $derived([
		...FINANCE_PARAMETERS,
		...rows.filter((row) => !FINANCE_PARAMETERS.some((parameter) => parameter.code === row.code))
			.map((row) => financeParameterDefinition(String(row.code), row.label))
	]);
	const definition = $derived(financeParameterDefinition(code, original?.label));

	onMount(() => { void loadRows(); });

	async function loadRows() {
		loading = true;
		loadError = '';
		try {
			const nextRows: DataRow[] = [];
			let page = 0;
			while (true) {
				const result = await api.list(FINANCE_PARAMETER_CONFIG, {
					page, pageSize: 100, sortKey: 'code', sortDirection: 'asc', search: ''
				});
				nextRows.push(...result.rows);
				if (nextRows.length >= result.total || !result.rows.length) break;
				page += 1;
			}
			rows = nextRows;
		} catch (error) {
			loadError = error instanceof Error ? error.message : '财务指标读取失败，请重试';
		} finally {
			loading = false;
		}
	}

	function openEditor(selectedCode: string) {
		original = rows.find((row) => row.code === selectedCode) ?? null;
		code = selectedCode;
		value = financeParameterValue(code, original?.value_yi);
		periodEnd = String(original?.period_end ?? '');
		notes = String(original?.notes ?? '');
		saveError = '';
		notice = '';
		dialog.showModal();
	}

	async function save() {
		if (saving) return;
		saving = true;
		saveError = '';
		try {
			const payload = financeParameterPayload(code, value, periodEnd, notes, original?.label);
			if (!original && !missing.some((parameter) => parameter.code === code)) throw new Error('该指标已存在，请刷新后编辑');
			const { code: savedCode, ...changes } = payload;
			const savedRows = original
				? await api.update(FINANCE_PARAMETER_CONFIG, original, changes)
				: await api.insert(FINANCE_PARAMETER_CONFIG, payload);
			const saved = savedRows[0];
			if (!saved || saved.code !== savedCode) throw new Error('未取得保存结果，请核对数据后重试');
			rows = original ? rows.map((row) => row.code === saved.code ? saved : row) : [...rows, saved];
			notice = `${definition.label}已保存`;
			dialog.close();
		} catch (error) {
			saveError = error instanceof Error ? error.message : '保存失败，请重试';
		} finally {
			saving = false;
		}
	}
</script>

<section class="section-card parameter-panel" aria-label="财务指标" aria-busy={loading}>
	<header class="card-header">
		<div class="header-icon blue"><Landmark size={21} /></div>
		<h2>财务指标</h2>
		<button class="secondary-action" type="button" onclick={() => void loadRows()} disabled={loading || saving} aria-label="刷新财务指标"><RefreshCw size={17} class={loading ? 'spin' : ''} />刷新</button>
	</header>
	<p class="parameter-help">按指标维护当前值及口径日期；更新会替换原值。金额单位为亿元，比率单位为 %。</p>
	<p class="save-notice" aria-live="polite">{notice}</p>
	{#if loading}
		<p class="empty-state"><LoaderCircle size={18} class="spin" /> 正在读取财务指标…</p>
	{:else if loadError}
		<p class="error-message" role="alert">{loadError}</p>
	{:else}
		<div class="parameter-grid">
			{#each cards as parameter (parameter.code)}
				{@const row = rows.find((item) => item.code === parameter.code)}
				{@const displayValue = financeParameterValue(parameter.code, row?.value_yi)}
				<article class="parameter-card">
					<div class="parameter-heading"><h3>{parameter.label}</h3><button class="edit-button" type="button" aria-label={`${row ? '编辑' : '新增'}${parameter.label}`} title={`${row ? '编辑' : '新增'}${parameter.label}`} onclick={() => openEditor(parameter.code)}>{#if row}<Pencil size={17} />{:else}<Plus size={17} />{/if}</button></div>
					<p class="parameter-value">{#if displayValue !== ''}<strong>{Number(displayValue).toLocaleString('zh-CN', { maximumFractionDigits: parameter.unit === '%' ? 2 : 4 })}</strong><span>{parameter.unit}</span>{:else}<span>暂无数据</span>{/if}</p>
					<p class="parameter-date">口径日期：{row?.period_end ? String(row.period_end) : '未设置'}</p>
					{#if row?.notes}<p class="parameter-notes">{String(row.notes)}</p>{/if}
				</article>
			{/each}
		</div>
	{/if}
</section>

{#if !loading && !loadError && missing.length}
	<button class="floating-create-button" type="button" aria-label="新增财务指标" title="新增财务指标" onclick={() => openEditor(missing[0].code)}><Plus size={24} /></button>
{/if}

<dialog class="config-modal" bind:this={dialog} aria-labelledby="parameter-editor-title" oncancel={(event) => { if (saving) event.preventDefault(); }}>
	<form onsubmit={(event) => { event.preventDefault(); void save(); }}>
		<div class="modal-header"><h2 id="parameter-editor-title">{original ? '编辑' : '新增'}财务指标</h2><button type="button" aria-label="关闭财务指标编辑" onclick={() => dialog.close()} disabled={saving}><X size={20} /></button></div>
		<fieldset disabled={saving}>
			<div class="form-grid">
				<label class="wide"><span>指标名称</span>
					{#if original}<input value={definition.label} readonly />{:else}<select bind:value={code} onchange={() => { value = ''; saveError = ''; }} required>{#each missing as parameter}<option value={parameter.code}>{parameter.label}</option>{/each}</select>{/if}
				</label>
				<label><span>数值（{definition.unit}）</span><input type="number" value={value} oninput={(event) => value = event.currentTarget.value} min="0" step={definition.unit === '%' ? '0.01' : '0.0001'} required /></label>
				<label><span>口径日期</span><input type="date" bind:value={periodEnd} required /></label>
				<label class="wide"><span>说明</span><textarea bind:value={notes} rows="3"></textarea></label>
			</div>
		</fieldset>
		{#if code === 'prior_month_net_capital'}<p class="parameter-help">请使用上月最后一天作为口径日期。</p>{:else if code.includes('prior_year')}<p class="parameter-help">请使用上年 12 月 31 日作为口径日期。</p>{/if}
		{#if saveError}<p class="error-message" role="alert">{saveError}。输入已保留；如有并发冲突，请取消后刷新。</p>{/if}
		<div class="modal-actions"><button type="button" onclick={() => dialog.close()} disabled={saving}>取消</button><button class="secondary-action" type="submit" disabled={saving}>{#if saving}<LoaderCircle size={17} class="spin" />{/if}{saving ? '保存中…' : '保存'}</button></div>
	</form>
</dialog>

<style>
	.parameter-panel { min-width: 0; }
	.parameter-help { margin: 0; padding: 0 1.125rem 1rem; color: var(--muted); font-size: .875rem; }
	.save-notice { margin: 0; padding-inline: 1.125rem; color: var(--teal); }
	.save-notice:not(:empty) { padding-bottom: 1rem; }
	.parameter-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1rem; padding: 0 1.125rem 1.125rem; }
	.parameter-card { min-width: 0; padding: .875rem; border: 1px solid var(--line); border-radius: .5rem; overflow-wrap: anywhere; }
	.parameter-heading { display: flex; align-items: center; justify-content: space-between; gap: .5rem; }
	h3 { margin: 0; font-size: 1rem; font-weight: 650; }
	.edit-button { display: inline-grid; place-items: center; flex: 0 0 auto; min-width: 2.75rem; min-height: 2.75rem; border: 1px solid var(--line); border-radius: .5rem; background: var(--surface); color: var(--blue); cursor: pointer; }
	.parameter-value { display: flex; flex-wrap: wrap; align-items: baseline; gap: .375rem; margin: .5rem 0; font-variant-numeric: tabular-nums; }
	.parameter-value strong { font-size: clamp(1.25rem, 2vw, 1.75rem); }
	.parameter-value span, .parameter-date, .parameter-notes { color: var(--muted); font-size: .875rem; }
	.parameter-date, .parameter-notes { margin: .25rem 0 0; }
	.parameter-notes { white-space: pre-wrap; }
	.error-message { margin: 0; padding: 1rem 1.125rem; color: var(--red); overflow-wrap: anywhere; }
	fieldset { min-width: 0; margin: 0; padding: 0; border: 0; }
	.config-modal .parameter-help, .config-modal .error-message { padding-inline: 0; }
	input, select, textarea { min-width: 0; font: inherit; }
	button, input, select, textarea { transition: border-color 150ms, background-color 150ms; }
	button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible { outline: 2px solid var(--blue); outline-offset: 2px; }
	.edit-button:hover { background: var(--blue-soft); }
	@media (max-width: 75rem) { .parameter-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
	@media (max-width: 35rem) { .parameter-grid { grid-template-columns: minmax(0, 1fr); } }
	@media (prefers-reduced-motion: reduce) { button, input, select, textarea { transition: none; } }
</style>
