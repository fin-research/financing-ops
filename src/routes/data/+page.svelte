<script lang="ts">
	import '../management.css';
	import DataAdminTable from '$lib/DataAdminTable.svelte';
</script>

<svelte:head>
	<title>数据后台 · 融资工作台</title>
</svelte:head>

<div class="management-page data-page">
	<DataAdminTable />
</div>

<style>
	.data-page { padding-bottom: 5.5rem; }
</style>
