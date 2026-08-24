<script lang="ts">
	import './layout.css';
	import { page } from '$app/state';
	import { withBase, withoutBase } from '$lib/app-paths';
	import {
		BarChart3,
		BriefcaseBusiness,
		FileSpreadsheet,
		LayoutDashboard,
		LogOut,
		Megaphone,
		ShieldCheck,
		Workflow
	} from '@lucide/svelte';
	import { roleLabel } from '$lib/roles';
	import GlobalMessages from '$lib/GlobalMessages.svelte';

	let { children, data } = $props();

	const workspaceItems = [
		{ href: '/', label: '仪表盘', mobileLabel: '仪表盘', icon: LayoutDashboard },
		{ href: '/projects', label: '项目进度', mobileLabel: '项目', icon: BriefcaseBusiness }
	];

	const managementItems = [
		{ href: '/sop', label: 'SOP 管理', mobileLabel: 'SOP', icon: Workflow },
		{ href: '/data', label: '数据后台', mobileLabel: '数据', icon: FileSpreadsheet },
		{ href: '/people', label: '人员与权限', mobileLabel: '人员', icon: ShieldCheck }
	];
	const navItems = [...workspaceItems, ...managementItems];
	const mobileItems = [...workspaceItems, managementItems[0], managementItems[1]];

	const isActive = (href: string) => {
		const pathname = withoutBase(page.url.pathname);
		if (href === '/') return pathname === '/' || pathname.startsWith('/debts/');
		return pathname === href || pathname.startsWith(`${href}/`);
	};
	const avatarUrl = (user: NonNullable<typeof data.user>) =>
		`${withBase('/avatar')}?v=${encodeURIComponent(`${user.personId}:${user.avatarVersion}`)}`;

	const currentPageTitle = () => {
		const pathname = withoutBase(page.url.pathname);
		if (/^\/projects\/[^/]+$/.test(pathname)) {
			return String((page.data as any)?.project?.name ?? '项目详情');
		}
		if (/^\/sop\/[^/]+$/.test(pathname) && pathname !== '/sop/reminders') {
			return String((page.data as any)?.template?.name ?? 'SOP 配置');
		}
		if (pathname === '/settings') return '个人设置';
		if (pathname === '/sop/reminders') return '提醒发送历史';
		if (pathname.startsWith('/debts/')) return '负债详情';
		return navItems.find((item) => isActive(item.href))?.label ?? '仪表盘';
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
		<a class="brand" href={withBase('/')} aria-label="融资工作台首页">
			<span class="brand-mark"><BarChart3 size={19} strokeWidth={2.2} /></span>
			<span>
				<strong>融资工作台</strong>
				<small>FINANCING OPS</small>
			</span>
		</a>

		<nav class="main-nav" aria-label="主导航">
			<p class="nav-caption">工作空间</p>
			{#each workspaceItems as item}
				<a class:active={isActive(item.href)} href={withBase(item.href)}>
					<item.icon size={18} strokeWidth={1.8} />
					<span>{item.label}</span>
				</a>
			{/each}
			<p class="nav-caption nav-caption-spaced">数据管理</p>
			{#each managementItems as item}
				<a class:active={isActive(item.href)} href={withBase(item.href)}>
					<item.icon size={18} strokeWidth={1.8} />
					<span>{item.label}</span>
				</a>
			{/each}
		</nav>

	</aside>

	<div class="workspace">
		<GlobalMessages hasReminderTicker={data.reminders.total > 0} />
		<header class="topbar">
			<div class="mobile-brand">
				<span class="brand-mark"><BarChart3 size={18} /></span>
			</div>
			<div class="breadcrumb">
				<strong>{currentPageTitle()}</strong>
				<span
					class={`role-chip role-${data.user.role}`}
					aria-label={`当前角色：${roleLabel(data.user.role)}`}
				>
					<span>{roleLabel(data.user.role)}</span>
				</span>
			</div>
			<div class="top-actions">
				<a class="profile-button" href={withBase('/settings')} aria-label="打开个人设置">
					{#if data.user.hasAvatar}
						<img class="avatar" src={avatarUrl(data.user)} alt="" />
					{:else}
						<span class="avatar">{data.user.personName.slice(0, 1).toUpperCase()}</span>
					{/if}
					<strong class="profile-name">{data.user.personName}</strong>
				</a>
				<form method="POST" action={withBase('/logout')}>
					<button class="icon-button" type="submit" aria-label="退出登录" title="退出登录">
						<LogOut size={18} />
					</button>
				</form>
			</div>
		</header>

		<div class="mobile-nav" aria-label="移动端导航">
			{#each mobileItems as item}
				<a class:active={isActive(item.href)} href={withBase(item.href)}>
					<item.icon size={18} />
					<span>{item.mobileLabel}</span>
				</a>
			{/each}
		</div>

		{#if data.reminders.total > 0}
			<div class="reminder-ticker" role="region" aria-label="待办提醒滚动播报">
				<span class="ticker-label"><Megaphone size={15} /><span>提醒</span></span>
				<div class="ticker-viewport">
					<div
						class="ticker-track"
						style={`--ticker-duration: ${Math.max(16, data.reminders.items.length * 8)}s`}
					>
						{#each [0, 1] as copy}
							<div class="ticker-run" aria-hidden={copy === 1}>
								{#each data.reminders.items as reminder}
					<a class={`ticker-item ${reminder.level}`} href={withBase(reminder.href)}>
										<strong>{reminder.projectName}</strong>
										<span>{reminder.taskName}</span>
										<b>{reminder.dueLabel}</b>
									</a>
								{/each}
							</div>
						{/each}
					</div>
				</div>
			</div>
		{/if}

		<main class="page-content" id="main-content" tabindex="-1">
			{@render children()}
		</main>
	</div>
</div>
{:else}
	{@render children()}
{/if}
