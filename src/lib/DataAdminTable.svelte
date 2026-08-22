<script lang="ts">
	import { createTable, FlexRender, tableFeatures, type ColumnDef } from '@tanstack/svelte-table';
	import {
		AlertCircle, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, LoaderCircle,
		Pencil, Plus, RefreshCw, Search, ShieldCheck, Trash2, X
	} from '@lucide/svelte';
	import { DATA_ENTITIES, formatDataValue, valueForDatabase, valueForEditor, type DataRow, type EntityConfig, type FieldConfig } from './data-admin';
	import { NeonDataApi } from './neon-data-api';

	const features = tableFeatures({});
	let { dataApiUrl }: { dataApiUrl: string } = $props();
	let activeKey = $state(DATA_ENTITIES[0].key);
	let rows = $state<DataRow[]>([]);
	let total = $state(0);
	let page = $state(0);
	let pageSize = $state(50);
	let search = $state('');
	let appliedSearch = $state('');
	let sortKey = $state(DATA_ENTITIES[0].defaultSort.key);
	let sortDirection = $state<'asc' | 'desc'>(DATA_ENTITIES[0].defaultSort.direction);
	let loading = $state(true);
	let saving = $state(false);
	let message = $state('');
	let errorMessage = $state('');
	let editorMode = $state<'create' | 'edit'>('create');
	let originalRow = $state<DataRow | null>(null);
	let formValues = $state<Record<string, unknown>>({});
	let editorDialog = $state<HTMLDialogElement>();
	const api = $derived(new NeonDataApi(dataApiUrl));

	const activeConfig = $derived(DATA_ENTITIES.find((item) => item.key === activeKey) ?? DATA_ENTITIES[0]);
	const visibleFields = $derived(activeConfig.fields.filter((field) => field.table !== false));
	const totalPages = $derived(Math.max(1, Math.ceil(total / pageSize)));
	const columns = $derived(visibleFields.map((field) => ({
		accessorKey: field.key,
		header: field.label,
		cell: ({ getValue }: { getValue: () => unknown }) => formatDataValue(field, getValue())
	})) as ColumnDef<typeof features, DataRow>[]);
	const table = createTable({
		features,
		get columns() { return columns; },
		get data() { return rows; }
	});

	$effect(() => {
		void loadRows();
	});

	async function loadRows() {
		loading = true;
		errorMessage = '';
		try {
			const result = await api.list(activeConfig, {
				page, pageSize, sortKey, sortDirection, search: appliedSearch
			});
			rows = result.rows;
			total = result.total;
			if (page > 0 && !rows.length && total > 0) {
				page = Math.max(0, Math.ceil(total / pageSize) - 1);
				await loadRows();
			}
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : String(error);
			rows = [];
			total = 0;
		} finally {
			loading = false;
		}
	}

	function switchEntity(config: EntityConfig) {
		activeKey = config.key;
		page = 0;
		search = '';
		appliedSearch = '';
		sortKey = config.defaultSort.key;
		sortDirection = config.defaultSort.direction;
		message = '';
		errorMessage = '';
	}

	function applySearch() {
		page = 0;
		appliedSearch = search.trim();
	}

	function toggleSort(key: string) {
		if (sortKey === key) sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
		else {
			sortKey = key;
			sortDirection = 'asc';
		}
		page = 0;
	}

	function editableFields(config = activeConfig) {
		return config.fields.filter((field) => field.form !== false && (!field.readOnly || editorMode === 'edit'));
	}

	function openCreate() {
		editorMode = 'create';
		originalRow = null;
		formValues = Object.fromEntries(activeConfig.fields.filter((field) => field.form !== false && !field.readOnly).map((field) => [field.key, field.type === 'boolean' ? false : '']));
		errorMessage = '';
		editorDialog?.showModal();
	}

	function openEdit(row: DataRow) {
		if (activeConfig.readOnly) return;
		editorMode = 'edit';
		originalRow = row;
		formValues = Object.fromEntries(activeConfig.fields.filter((field) => field.form !== false).map((field) => [field.key, valueForEditor(field, row[field.key])]));
		errorMessage = '';
		editorDialog?.showModal();
	}

	function isFieldReadOnly(field: FieldConfig) {
		return Boolean(field.readOnly || (editorMode === 'edit' && activeConfig.primaryKeys.includes(field.key)));
	}

	function setField(key: string, value: unknown) {
		formValues = { ...formValues, [key]: value };
	}

	function payload() {
		const result: DataRow = {};
		for (const field of activeConfig.fields) {
			if (field.form === false || field.readOnly) continue;
			if (editorMode === 'edit' && activeConfig.primaryKeys.includes(field.key)) continue;
			const raw = formValues[field.key];
			if (editorMode === 'create' && field.omitWhenEmptyOnCreate && (raw === '' || raw == null)) continue;
			const value = valueForDatabase(field, raw);
			if (field.required && (value === null || value === '')) throw new Error(`请填写${field.label}`);
			result[field.key] = value;
		}
		if (activeConfig.key === 'debt' && result.debt_type === '债券' && !result.subtype) {
			throw new Error('债券必须选择负债小类');
		}
		return result;
	}

	async function saveRow() {
		saving = true;
		errorMessage = '';
		try {
			const values = payload();
			if (editorMode === 'create') await api.insert(activeConfig, values);
			else if (originalRow) await api.update(activeConfig, originalRow, values);
			message = editorMode === 'create' ? '记录已新增并写入审计日志' : '记录已更新并写入审计日志';
			editorDialog?.close();
			await loadRows();
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : String(error);
		} finally {
			saving = false;
		}
	}

	async function deleteRow(row: DataRow) {
		if (!activeConfig.canDelete || activeConfig.readOnly) return;
		const identity = activeConfig.primaryKeys.map((key) => `${key}=${String(row[key])}`).join('，');
		if (!confirm(`确定删除这条${activeConfig.label}记录吗？\n${identity}\n关联约束和级联规则将由数据库执行。`)) return;
		saving = true;
		errorMessage = '';
		try {
			await api.delete(activeConfig, row);
			message = '记录已删除并写入审计日志';
			await loadRows();
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : String(error);
		} finally {
			saving = false;
		}
	}

	function goTo(nextPage: number) {
		page = Math.min(Math.max(nextPage, 0), totalPages - 1);
	}
</script>

<section class="data-editor" aria-label="融资数据表">
	<div class="entity-tabs" role="tablist" aria-label="数据表">
		{#each DATA_ENTITIES as config}
			<button type="button" role="tab" aria-selected={activeKey === config.key} class:active={activeKey === config.key} onclick={() => switchEntity(config)}>{config.label}</button>
		{/each}
	</div>

	<div class="table-toolbar">
		<form class="search-form" onsubmit={(event) => { event.preventDefault(); applySearch(); }}>
			<label><span class="sr-only">搜索{activeConfig.label}</span><Search size={18} /><input bind:value={search} type="search" placeholder={`搜索${activeConfig.label}`} /></label>
			<button type="submit">查询</button>
		</form>
		<div class="table-meta">
			<span><ShieldCheck size={17} /> {activeConfig.readOnly ? '审计记录只读' : '三种角色均可编辑'}</span>
			<strong>{total.toLocaleString('zh-CN')} 条</strong>
			<button type="button" class="icon-action" aria-label="刷新数据" title="刷新数据" onclick={() => void loadRows()} disabled={loading}><RefreshCw size={18} class={loading ? 'spin' : ''} /></button>
		</div>
	</div>

	{#if message}<div class="table-feedback success" role="status"><ShieldCheck size={18} /> {message}</div>{/if}
	{#if errorMessage && !editorDialog?.open}<div class="table-feedback error" role="alert"><AlertCircle size={18} /> {errorMessage}</div>{/if}

	<div class="table-shell" aria-busy={loading}>
		<table>
			<thead>
				{#each table.getHeaderGroups() as headerGroup (headerGroup.id)}
					<tr>
						{#each headerGroup.headers as header (header.id)}
							<th scope="col"><button type="button" class="sort-button" onclick={() => toggleSort(header.column.id)}><FlexRender {header} />{#if sortKey === header.column.id}{#if sortDirection === 'asc'}<ChevronUp size={15} />{:else}<ChevronDown size={15} />{/if}{/if}</button></th>
						{/each}
						{#if !activeConfig.readOnly}<th scope="col" class="action-column">操作</th>{/if}
					</tr>
				{/each}
			</thead>
			<tbody>
				{#if loading}
					<tr><td colspan={visibleFields.length + (activeConfig.readOnly ? 0 : 1)} class="empty-row"><LoaderCircle size={20} class="spin" /> 正在读取 Neon Data API…</td></tr>
				{:else if table.getRowModel().rows.length === 0}
					<tr><td colspan={visibleFields.length + (activeConfig.readOnly ? 0 : 1)} class="empty-row">暂无匹配记录</td></tr>
				{:else}
					{#each table.getRowModel().rows as row (row.id)}
						<tr ondblclick={() => openEdit(row.original)}>
							{#each row.getAllCells() as cell (cell.id)}<td><FlexRender {cell} /></td>{/each}
							{#if !activeConfig.readOnly}
								<td class="row-actions">
									<button type="button" aria-label="编辑记录" title="编辑记录" onclick={() => openEdit(row.original)}><Pencil size={17} /></button>
									{#if activeConfig.canDelete}<button type="button" class="danger" aria-label="删除记录" title="删除记录" onclick={() => void deleteRow(row.original)}><Trash2 size={17} /></button>{/if}
								</td>
							{/if}
						</tr>
					{/each}
				{/if}
			</tbody>
		</table>
	</div>

	<div class="pagination-bar">
		<label>每页 <select value={pageSize} onchange={(event) => { pageSize = Number(event.currentTarget.value); page = 0; }}><option value="25">25</option><option value="50">50</option><option value="100">100</option></select></label>
		<span>第 {page + 1} / {totalPages} 页</span>
		<div><button type="button" aria-label="上一页" onclick={() => goTo(page - 1)} disabled={page === 0 || loading}><ChevronLeft size={18} /></button><button type="button" aria-label="下一页" onclick={() => goTo(page + 1)} disabled={page + 1 >= totalPages || loading}><ChevronRight size={18} /></button></div>
	</div>
</section>

{#if activeConfig.canCreate && !activeConfig.readOnly}
	<button class="floating-create-button data-create" type="button" aria-label={`新增${activeConfig.label}`} title={`新增${activeConfig.label}`} onclick={openCreate}><Plus size={24} /></button>
{/if}

<dialog bind:this={editorDialog} class="data-dialog" onclose={() => { errorMessage = ''; }}>
	<form method="dialog" class="dialog-head"><h2>{editorMode === 'create' ? `新增${activeConfig.label}` : `编辑${activeConfig.label}`}</h2><button type="submit" aria-label="关闭编辑窗口" title="关闭"><X size={20} /></button></form>
	<form class="editor-form" onsubmit={(event) => { event.preventDefault(); void saveRow(); }}>
		<div class="editor-fields">
			{#each editableFields() as field (field.key)}
				<label class:wide={field.type === 'textarea'}>
					<span>{field.label}{field.required && !isFieldReadOnly(field) ? ' *' : ''}</span>
					{#if field.type === 'select'}
						<select value={String(formValues[field.key] ?? '')} disabled={isFieldReadOnly(field)} onchange={(event) => setField(field.key, event.currentTarget.value)} required={field.required}>
							{#if !field.required && !(field.options ?? []).some((choice) => choice.value === '')}<option value="">未设置</option>{/if}
							{#each field.options ?? [] as choice}<option value={choice.value}>{choice.label}</option>{/each}
						</select>
					{:else if field.type === 'textarea'}
						<textarea value={String(formValues[field.key] ?? '')} disabled={isFieldReadOnly(field)} oninput={(event) => setField(field.key, event.currentTarget.value)}></textarea>
					{:else if field.type === 'boolean'}
						<input type="checkbox" checked={Boolean(formValues[field.key])} disabled={isFieldReadOnly(field)} onchange={(event) => setField(field.key, event.currentTarget.checked)} />
					{:else}
						<input type={field.type === 'datetime' ? 'text' : field.type ?? 'text'} value={String(formValues[field.key] ?? '')} disabled={isFieldReadOnly(field)} required={field.required && !isFieldReadOnly(field)} min={field.min} max={field.max} step={field.step} oninput={(event) => setField(field.key, event.currentTarget.value)} />
					{/if}
				</label>
			{/each}
		</div>
		{#if errorMessage}<div class="table-feedback error" role="alert"><AlertCircle size={18} /> {errorMessage}</div>{/if}
		<div class="dialog-actions"><button type="button" class="secondary-action" onclick={() => editorDialog?.close()} disabled={saving}>取消</button><button type="submit" class="primary-action" disabled={saving}>{#if saving}<LoaderCircle size={18} class="spin" />{/if}{saving ? '保存中…' : '保存'}</button></div>
	</form>
</dialog>

<style>
	.data-editor { min-width: 0; overflow: hidden; border: 1px solid var(--line); border-radius: .625rem; background: var(--surface); box-shadow: var(--shadow); }
	.entity-tabs { display: flex; gap: .25rem; overflow-x: auto; padding: .75rem 1rem 0; border-bottom: 1px solid var(--line); }
	.entity-tabs button { min-height: 2.75rem; padding: .625rem .875rem; border: 0; border-bottom: .1875rem solid transparent; background: transparent; color: var(--muted); font: inherit; white-space: nowrap; cursor: pointer; }
	.entity-tabs button.active { border-bottom-color: var(--blue); color: var(--blue); font-weight: 700; }
	.table-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: .75rem 1rem; }
	.search-form { display: flex; align-items: center; gap: .5rem; min-width: min(100%, 26rem); }
	.search-form label { display: flex; flex: 1; align-items: center; gap: .5rem; min-height: 2.75rem; padding: 0 .75rem; border: 1px solid var(--line); border-radius: .5rem; background: #fff; }
	.search-form input { width: 100%; min-width: 0; border: 0; outline: 0; background: transparent; font: inherit; }
	.search-form button, .pagination-bar button, .icon-action, .row-actions button { min-width: 2.75rem; min-height: 2.75rem; border: 1px solid var(--line); border-radius: .5rem; background: #fff; color: var(--ink); font: inherit; cursor: pointer; }
	.search-form button { padding-inline: .875rem; color: #fff; background: var(--blue); border-color: var(--blue); }
	.table-meta { display: flex; align-items: center; gap: .75rem; white-space: nowrap; }
	.table-meta span { display: inline-flex; align-items: center; gap: .375rem; color: var(--teal); }
	.table-feedback { display: flex; align-items: center; gap: .5rem; margin: 0 1rem .75rem; padding: .75rem 1rem; border-radius: .5rem; }
	.table-feedback.success { color: #08715c; background: #ecfdf3; }
	.table-feedback.error { color: var(--red); background: #fff1f0; }
	.table-shell { min-width: 0; max-width: 100%; overflow: auto; border-block: 1px solid var(--line); }
	table { width: max(100%, 70rem); border-collapse: collapse; font-size: 1rem; }
	th, td { padding: .75rem; border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); text-align: left; vertical-align: middle; white-space: nowrap; font-variant-numeric: tabular-nums; }
	th { position: sticky; top: 0; z-index: 1; background: #f8fafc; color: var(--ink); }
	tbody tr:hover { background: #f8fbff; }
	.sort-button { display: inline-flex; align-items: center; gap: .25rem; width: 100%; min-height: 2.25rem; padding: 0; border: 0; background: transparent; color: inherit; font: inherit; font-weight: 700; cursor: pointer; }
	.action-column { position: sticky; right: 0; min-width: 6.5rem; }
	.row-actions { position: sticky; right: 0; display: flex; gap: .375rem; background: inherit; }
	.row-actions button { min-width: 2.25rem; min-height: 2.25rem; }
	.row-actions button.danger { color: var(--red); }
	.empty-row { height: 8rem; text-align: center; color: var(--muted); }
	.empty-row :global(svg) { display: inline-block; vertical-align: middle; margin-right: .375rem; }
	.pagination-bar { display: flex; align-items: center; justify-content: flex-end; gap: 1rem; padding: .75rem 1rem; }
	.pagination-bar label, .pagination-bar > div { display: flex; align-items: center; gap: .5rem; }
	.pagination-bar select { min-height: 2.75rem; border: 1px solid var(--line); border-radius: .5rem; background: #fff; padding-inline: .5rem; font: inherit; }
	.data-create { z-index: 15; }
	.data-dialog { width: min(94vw, 54rem); max-height: min(90dvh, 52rem); padding: 0; border: 0; border-radius: .75rem; background: #fff; box-shadow: 0 1.5rem 4rem rgb(15 23 42 / .25); }
	.data-dialog::backdrop { background: rgb(15 23 42 / .48); }
	.dialog-head { position: sticky; top: 0; z-index: 2; display: flex; align-items: center; justify-content: space-between; padding: 1rem 1.25rem; border-bottom: 1px solid var(--line); background: #fff; }
	.dialog-head h2 { margin: 0; font-size: 1.125rem; }
	.dialog-head button { display: grid; place-items: center; width: 2.75rem; height: 2.75rem; border: 0; border-radius: .5rem; background: transparent; cursor: pointer; }
	.editor-form { overflow: auto; max-height: calc(90dvh - 4.75rem); }
	.editor-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; padding: 1.25rem; }
	.editor-fields label { display: grid; align-content: start; gap: .375rem; min-width: 0; }
	.editor-fields label.wide { grid-column: 1 / -1; }
	.editor-fields label > span { color: var(--ink); font-weight: 600; }
	.editor-fields input:not([type='checkbox']), .editor-fields select, .editor-fields textarea { width: 100%; min-height: 2.75rem; border: 1px solid var(--line); border-radius: .5rem; background: #fff; padding: .625rem .75rem; color: var(--ink); font: inherit; }
	.editor-fields textarea { min-height: 6rem; resize: vertical; }
	.editor-fields input:disabled, .editor-fields select:disabled, .editor-fields textarea:disabled { background: #f1f5f9; color: var(--muted); }
	.dialog-actions { position: sticky; bottom: 0; display: flex; justify-content: flex-end; gap: .75rem; padding: 1rem 1.25rem; border-top: 1px solid var(--line); background: #fff; }
	.dialog-actions button { display: inline-flex; align-items: center; justify-content: center; gap: .375rem; min-height: 2.75rem; padding-inline: 1rem; }
	button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible { outline: 2px solid var(--blue); outline-offset: 2px; }
	button:disabled { opacity: .55; cursor: not-allowed; }
	:global(.spin) { animation: spin .8s linear infinite; }
	@keyframes spin { to { transform: rotate(360deg); } }
	@media (max-width: 64rem) { .table-toolbar { align-items: stretch; flex-direction: column; } .table-meta { justify-content: space-between; } }
	@media (max-width: 35rem) {
		.entity-tabs, .table-toolbar, .pagination-bar { padding-inline: .75rem; }
		.search-form { min-width: 0; }
		.table-meta span { display: none; }
		.pagination-bar { justify-content: space-between; flex-wrap: wrap; }
		.editor-fields { grid-template-columns: 1fr; padding: 1rem; }
		.editor-fields label.wide { grid-column: auto; }
	}
	@media (prefers-reduced-motion: reduce) { :global(.spin) { animation: none; } }
</style>
