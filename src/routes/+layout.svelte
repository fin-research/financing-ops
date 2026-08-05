<script lang="ts">
	import './layout.css';
	import { page } from '$app/state';
	import {
		BarChart3,
		Bell,
		BriefcaseBusiness,
		CalendarDays,
		FileSpreadsheet,
		LayoutDashboard,
		LogOut,
		ShieldCheck,
		Workflow
	} from '@lucide/svelte';

	let { children, data } = $props();

	const workspaceItems = [
		{ href: '/', label: '仪表盘', mobileLabel: '仪表盘', icon: LayoutDashboard },
		{ href: '/workbench', label: '工作台', mobileLabel: '工作台', icon: CalendarDays },
		{ href: '/projects', label: '项目进度', mobileLabel: '项目', icon: BriefcaseBusiness }
	];

	const managementItems = [
		{ href: '/settings', label: 'SOP 管理', mobileLabel: 'SOP', icon: Workflow },
		{ href: '/data', label: '数据后台', mobileLabel: '数据', icon: FileSpreadsheet },
		{ href: '/people', label: '人员与权限', mobileLabel: '人员', icon: ShieldCheck }
	];
	const navItems = [...workspaceItems, ...managementItems];
	const mobileItems = [...workspaceItems, managementItems[0], managementItems[1]];

	const isActive = (href: string) => {
		if (href === '/') return page.url.pathname === '/';
		if (href === '/workbench' && page.url.pathname.startsWith('/debts/')) return true;
		return page.url.pathname === href || page.url.pathname.startsWith(`${href}/`);
	};
</script>

<svelte:head>
	<title>融资工作台</title>
	<meta
		name="description"
		content="负债数据、融资项目、SOP 节点与提醒的一体化管理工作台"
	/>
</svelte:head>

{#if data.user}
<div class="app-shell">
	<a class="skip-link" href="#main-content">跳到主要内容</a>
	<aside class="sidebar">
		<a class="brand" href="/workbench" aria-label="融资工作台首页">
			<span class="brand-mark"><BarChart3 size={19} strokeWidth={2.2} /></span>
			<span>
				<strong>融资工作台</strong>
				<small>FINANCING OPS</small>
			</span>
		</a>

		<nav class="main-nav" aria-label="主导航">
			<p class="nav-caption">工作空间</p>
			{#each workspaceItems as item}
				<a class:active={isActive(item.href)} href={item.href}>
					<item.icon size={18} strokeWidth={1.8} />
					<span>{item.label}</span>
				</a>
			{/each}
			<p class="nav-caption nav-caption-spaced">数据管理</p>
			{#each managementItems as item}
				<a class:active={isActive(item.href)} href={item.href}>
					<item.icon size={18} strokeWidth={1.8} />
					<span>{item.label}</span>
				</a>
			{/each}
		</nav>

		<div class="sidebar-status">
			<div class="status-title">
				<span class="status-dot"></span>
				<span>数据已同步</span>
			</div>
			<p>借入资金台账</p>
			<small>更新至 {data.dataAsOfDate ?? '待导入'}</small>
		</div>
	</aside>

	<div class="workspace">
		<header class="topbar">
			<div class="mobile-brand">
				<span class="brand-mark"><BarChart3 size={18} /></span>
				<strong>融资工作台</strong>
			</div>
			<div class="breadcrumb">
				<span>资金运营中心</span>
				<span class="breadcrumb-divider">/</span>
				<strong>
					{navItems.find((item) => isActive(item.href))?.label ?? '工作台'}
				</strong>
			</div>
			<div class="top-actions">
				<a class="today-pill" href="/workbench">
					<CalendarDays size={15} />
					<span>{data.today}</span>
				</a>
				<button class="icon-button" type="button" aria-label="查看提醒">
					<Bell size={18} />
					<span class="notification-dot"></span>
				</button>
				<div class="profile-button" aria-label="当前登录账号">
					<span class="avatar">{data.user.username.slice(0, 1).toUpperCase()}</span>
					<span class="profile-copy">
						<strong>{data.user.username}</strong>
						<small>{data.user.role === 'admin' ? '管理员' : '只读用户'}</small>
					</span>
				</div>
				<form method="POST" action="/logout">
					<button class="icon-button" type="submit" aria-label="退出登录" title="退出登录">
						<LogOut size={18} />
					</button>
				</form>
			</div>
		</header>

		<div class="mobile-nav" aria-label="移动端导航">
			{#each mobileItems as item}
				<a class:active={isActive(item.href)} href={item.href}>
					<item.icon size={18} />
					<span>{item.mobileLabel}</span>
				</a>
			{/each}
		</div>

		<main class="page-content" id="main-content" tabindex="-1">
			{@render children()}
		</main>
	</div>
</div>
{:else}
	{@render children()}
{/if}
