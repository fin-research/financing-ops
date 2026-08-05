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
	import { roleLabel } from '$lib/roles';

	let { children, data } = $props();
	let remindersOpen = $state(false);
	let reminderMenu = $state<HTMLDivElement>();

	const workspaceItems = [
		{ href: '/', label: '仪表盘', mobileLabel: '仪表盘', icon: LayoutDashboard },
		{ href: '/workbench', label: '工作台', mobileLabel: '工作台', icon: CalendarDays },
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
		if (href === '/') return page.url.pathname === '/';
		if (href === '/workbench' && page.url.pathname.startsWith('/debts/')) return true;
		return page.url.pathname === href || page.url.pathname.startsWith(`${href}/`);
	};

	const currentPageTitle = () => {
		const pathname = page.url.pathname;
		if (/^\/projects\/[^/]+$/.test(pathname)) {
			return String((page.data as any)?.project?.name ?? '项目详情');
		}
		if (/^\/sop\/[^/]+$/.test(pathname) && pathname !== '/sop/reminders') {
			return String((page.data as any)?.template?.name ?? 'SOP 配置');
		}
		if (pathname === '/settings') return '个人设置';
		if (pathname === '/sop/reminders') return '提醒发送历史';
		if (pathname.startsWith('/debts/')) return '负债详情';
		return navItems.find((item) => isActive(item.href))?.label ?? '工作台';
	};

	const closeReminderMenu = (event: MouseEvent) => {
		if (remindersOpen && reminderMenu && !reminderMenu.contains(event.target as Node)) {
			remindersOpen = false;
		}
	};

	const handleReminderKey = (event: KeyboardEvent) => {
		if (event.key === 'Escape') remindersOpen = false;
	};
</script>

<svelte:window onclick={closeReminderMenu} onkeydown={handleReminderKey} />

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
				<div class="notification-menu" bind:this={reminderMenu}>
					<button
						class="reminder-button"
						type="button"
						aria-label={`查看提醒，共 ${data.reminders.total} 条`}
						aria-expanded={remindersOpen}
						aria-controls="topbar-reminder-list"
						onclick={() => (remindersOpen = !remindersOpen)}
					>
						<Bell size={18} />
						<span>提醒</span>
						{#if data.reminders.total > 0}
							<span class="notification-count" aria-hidden="true">
								{data.reminders.total > 99 ? '99+' : data.reminders.total}
							</span>
						{/if}
					</button>
					{#if remindersOpen}
						<section class="notification-popover" id="topbar-reminder-list" aria-label="待办与预警">
							<header>
								<div>
									<strong>待办与预警</strong>
									<span>未来 7 天及已逾期节点</span>
								</div>
								<span>{data.reminders.total} 条</span>
							</header>
							<div class="notification-list">
								{#each data.reminders.items as reminder}
									<a href={reminder.href} onclick={() => (remindersOpen = false)}>
										<span class={`reminder-level ${reminder.level}`} aria-hidden="true"></span>
										<span class="reminder-copy">
											<strong>{reminder.projectName}</strong>
											<span>{reminder.taskName}</span>
											<small>{reminder.debtType} · {reminder.assigneeName ? `负责人：${reminder.assigneeName}` : '待分配'}</small>
										</span>
										<span class={`reminder-due ${reminder.level}`}>{reminder.dueLabel}</span>
									</a>
								{:else}
									<p class="notification-empty">当前没有需要处理的项目节点</p>
								{/each}
							</div>
						</section>
					{/if}
				</div>
				<a class="profile-button" href="/settings" aria-label="打开个人设置">
					{#if data.user.avatarDataUrl}
						<img class="avatar" src={data.user.avatarDataUrl} alt="" />
					{:else}
						<span class="avatar">{data.user.personName.slice(0, 1).toUpperCase()}</span>
					{/if}
					<strong class="profile-name">{data.user.personName}</strong>
				</a>
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
