<script lang="ts">
	import '../management.css';
	import DataAdminTable from '$lib/DataAdminTable.svelte';
	import DebtImportPanel from '$lib/DebtImportPanel.svelte';
	import { hasPermission } from '$lib/permissions.js';

	let { data } = $props();
</script>

<svelte:head>
	<title>数据后台 · 融资工作台</title>
</svelte:head>

<div class="management-page data-page">
	{#if hasPermission(data.permissions, 'data_manage')}
		<DebtImportPanel />
		<DataAdminTable />
	{:else}
		<section class="section-card permission-empty">
			<h2>暂无数据后台权限</h2>
			<p>请联系具有“权限配置”权限的人员，为当前角色开通数据后台。</p>
		</section>
	{/if}
</div>

<style>
	.data-page { padding-bottom: 5.5rem; }
	.permission-empty { padding: 1.25rem; }
	.permission-empty h2 { margin: 0; }
	.permission-empty p { margin: 0.5rem 0 0; color: #475467; }
</style>
