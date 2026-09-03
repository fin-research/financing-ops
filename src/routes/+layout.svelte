<script lang="ts">
	import './layout.css';
	import { enhance } from '$app/forms';
	import { preloadData } from '$app/navigation';
	import { navigating, page } from '$app/state';
	import { withBase, withoutBase } from '$lib/app-paths';
	import {
		BarChart3,
		BriefcaseBusiness,
		FileText,
		FileSpreadsheet,
		LayoutDashboard,
		LoaderCircle,
		LogOut,
		Megaphone,
		Printer,
		ShieldCheck,
		Workflow
	} from '@lucide/svelte';
	import { roleLabel } from '$lib/roles';
	import GlobalMessages from '$lib/GlobalMessages.svelte';
	import { globalMessages } from '$lib/global-messages';

	let { children, data } = $props();

	const workspaceItems = [
		{ href: '/', label: '仪表盘', mobileLabel: '仪表盘', icon: LayoutDashboard },
		{ href: '/liability-report', label: '负债周报', mobileLabel: '周报', icon: FileText },
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
		return matchesNavigation(pathname, href);
	};
	const matchesNavigation = (pathname: string, href: string) => {
		if (href === '/') return pathname === '/' || pathname.startsWith('/debts/');
		return pathname === href || pathname.startsWith(`${href}/`);
	};
	const isPending = (href: string) => {
		const pathname = navigating.to?.url.pathname;
		return pathname ? matchesNavigation(withoutBase(pathname), href) : false;
	};
	const preloadNavigation = (href: string) => {
		if (isActive(href)) return;
		void preloadData(withBase(href)).catch(() => undefined);
	};
	let navigationSlow = $state(false);
	let reportGenerating = $state(false);
	$effect(() => {
		if (!navigating.to) {
			navigationSlow = false;
			return;
		}
		navigationSlow = false;
		const timer = setTimeout(() => (navigationSlow = true), 300);
		return () => clearTimeout(timer);
	});
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
	const isLiabilityReport = () => withoutBase(page.url.pathname) === '/liability-report';
	const liabilityReportHistory = () => ((page.data as any)?.reportHistory ?? []) as Array<{
		id: string;
		asOfDate: string;
	}>;
	const selectedLiabilityReportRunId = () => String((page.data as any)?.selectedRunId ?? '');
	const liabilityReportDateLabel = (value: string | null | undefined) => {
		if (!value) return '日期缺失';
		const [year, month, day] = String(value).slice(0, 10).split('-');
		return `${year}年${month}月${day}日`;
	};
	const submitReportHistorySelection = (event: Event) => {
		(event.currentTarget as HTMLSelectElement).form?.requestSubmit();
	};
	const enhanceReportGeneration = () => {
		reportGenerating = true;
		return async ({ result, update }: any) => {
			try {
				await update({ reset: false, invalidateAll: result.type === 'success' });
				if (result.type === 'success') {
					globalMessages.success(String(result.data?.message ?? '周报已生成'), {
						key: 'liability-report-generation',
						title: '周报生成完成'
					});
					const missingModules = Array.isArray(result.data?.missingModules) ? result.data.missingModules : [];
					if (missingModules.length > 0) {
						globalMessages.warning(
							missingModules.map((item: any) => `${item.title}：${item.detail}`).join('；'),
							{
								key: 'liability-report-missing-modules',
								title: `本次周报有 ${missingModules.length} 项待核对`,
								duration: 12000
							}
						);
					}
				} else {
					const message = result.type === 'failure'
						? String(result.data?.message ?? '周报生成失败，请检查后重试。')
						: result.type === 'error' && result.error?.message
							? result.error.message
							: '周报生成失败，请稍后重试。';
					globalMessages.error(message, { key: 'liability-report-generation' });
				}
			} finally {
				reportGenerating = false;
			}
		};
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

		<nav
			class="main-nav"
			aria-label="主导航"
			data-sveltekit-preload-data="hover"
			data-sveltekit-preload-code="viewport"
		>
			<p class="nav-caption">工作空间</p>
			{#each workspaceItems as item}
				<a
					class:active={isActive(item.href)}
					class:pending={isPending(item.href)}
					href={withBase(item.href)}
					onfocus={() => preloadNavigation(item.href)}
				>
					<item.icon size={18} strokeWidth={1.8} />
					<span>{item.label}</span>
				</a>
			{/each}
			<p class="nav-caption nav-caption-spaced">数据管理</p>
			{#each managementItems as item}
				<a
					class:active={isActive(item.href)}
					class:pending={isPending(item.href)}
					href={withBase(item.href)}
					onfocus={() => preloadNavigation(item.href)}
				>
					<item.icon size={18} strokeWidth={1.8} />
					<span>{item.label}</span>
				</a>
			{/each}
		</nav>

	</aside>

	<div class="workspace">
		<GlobalMessages hasReminderTicker={data.reminders.total > 0} />
		{#if navigationSlow}
			<div class="navigation-progress" role="progressbar" aria-label="页面加载中"></div>
		{/if}
		<header class="topbar" class:liability-report-topbar={isLiabilityReport()}>
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
				{#if isLiabilityReport()}
					<div class="report-header-actions" aria-label="负债周报操作">
						<form class="report-history-picker" method="GET" action={withBase('/liability-report')}>
							<label for="report-history-date">历史日期</label>
							<select
								id="report-history-date"
								name="run"
								value={selectedLiabilityReportRunId()}
								disabled={liabilityReportHistory().length === 0}
								onchange={submitReportHistorySelection}
							>
								{#each liabilityReportHistory() as run}
									<option value={run.id}>{liabilityReportDateLabel(run.asOfDate)}</option>
								{:else}
									<option value="">暂无历史周报</option>
								{/each}
							</select>
						</form>
						<button class="header-action" type="button" onclick={() => window.print()} aria-label="导出 PDF" title="导出 PDF">
							<Printer size={17} /><span class="header-action-label">导出 PDF</span>
						</button>
						<form method="POST" action={withBase('/liability-report?/generate')} use:enhance={enhanceReportGeneration}>
							<input type="hidden" name="confirm" value="yes" />
							<button class="header-action header-primary-action" type="submit" disabled={reportGenerating} aria-label={reportGenerating ? '正在生成本期周报' : '生成本期周报'} title="生成本期周报">
								<LoaderCircle class={reportGenerating ? 'spinning' : ''} size={17} />
								<span>{reportGenerating ? '生成中…' : '生成本期周报'}</span>
							</button>
						</form>
					</div>
				{/if}
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

		<div
			class="mobile-nav"
			aria-label="移动端导航"
			data-sveltekit-preload-data="hover"
			data-sveltekit-preload-code="viewport"
		>
			{#each mobileItems as item}
				<a
					class:active={isActive(item.href)}
					class:pending={isPending(item.href)}
					href={withBase(item.href)}
					onfocus={() => preloadNavigation(item.href)}
				>
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

		<main class="page-content" class:liability-report-content={isLiabilityReport()} id="main-content" tabindex="-1" aria-busy={Boolean(navigating.to)}>
			{@render children()}
		</main>
	</div>
</div>
{:else}
	{@render children()}
{/if}
