<script lang="ts">
	import { Calculator, CalendarDays, CircleAlert, Info, Landmark, WalletCards } from '@lucide/svelte';
	import DebtPresetFilter from '$lib/DebtPresetFilter.svelte';
	import './workbench.css';

	let { data } = $props();
	const workbench = $derived(data.workbench);
	const initialWorkbench = () => data.workbench;
	let preset = $state('default');
	let selectedTypes = $state<string[]>(initialWorkbench().typeOptions.filter((type: string) => !['同业拆借', '浮动收益凭证'].includes(type)));
	let simulationType = $state('小公募');
	let simulationDate = $state(initialWorkbench().today);
	let simulationAmount = $state<number | null>(null);
	let simulationTenor = $state('3Y');
	const presets = [
		{ key: 'default', label: '不含拆借、浮动收益凭证', exclude: ['同业拆借', '浮动收益凭证'] },
		{ key: 'all', label: '全部', exclude: [] }
	];
	const visibleEvents = $derived(workbench.events.filter((event: any) => selectedTypes.length === 0 || selectedTypes.includes(event.filterType)));
	const calendarStart = $derived.by(() => {
		const firstDate = new Date(`${workbench.calendarMonth}-01T00:00:00Z`);
		const startOffset = (firstDate.getUTCDay() + 6) % 7;
		firstDate.setUTCDate(firstDate.getUTCDate() - startOffset);
		return firstDate;
	});
	const calendarCells = $derived(Array.from({ length: 42 }, (_, index) => {
		const date = new Date(calendarStart); date.setUTCDate(date.getUTCDate() + index);
		const key = date.toISOString().slice(0, 10);
		return { date: key, day: date.getUTCDate(), other: key.slice(0, 7) !== workbench.calendarMonth, today: key === workbench.today, events: visibleEvents.filter((event: any) => event.date === key) };
	}));
	const summaryDefinitions = [
		{ label: '公司债券', types: ['小公募', '私募债', '科创债'] },
		{ label: '次级债', types: ['次级债'] }, { label: '短融', types: ['短期融资券'] },
		{ label: '固定收益凭证', types: ['固定收益凭证'] }, { label: '转融资', types: ['转融资'] },
		{ label: '集团借款', types: ['集团借款'] }
	];
	const calendarSubtitle = $derived(summaryDefinitions.map((group) => {
		const amount = visibleEvents.filter((event: any) => event.id.startsWith('maturity:') && group.types.includes(event.filterType)).reduce((sum: number, event: any) => sum + event.amountYi, 0);
		return `${amount.toFixed(2)}亿元${group.label}`;
	}).join('、'));
	const simulationLimit = $derived(workbench.limits.find((item: any) => item.debtType === simulationType));
	const simulationResult = $derived.by(() => {
		if (!simulationAmount || simulationAmount <= 0) return null;
		if (!simulationLimit) return { pass: false, message: '该品种尚未配置发行额度' };
		const remaining = simulationLimit.remainingYi - simulationAmount;
		return remaining >= 0
			? { pass: true, message: `额度校验通过，试算后剩余 ${remaining.toFixed(2)} 亿元` }
			: { pass: false, message: `超出可用额度 ${Math.abs(remaining).toFixed(2)} 亿元` };
	});
	const dateLabel = (date: string | null) => date ? date.replaceAll('-', '/') : '';
	const weekdays = ['一', '二', '三', '四', '五', '六', '日'];
</script>

<svelte:head><title>工作台 · 融资工作台</title></svelte:head>

<section class="workbench-card limit-card">
	<header><span class="section-icon violet"><WalletCards size={19} /></span><div><h2>负债额度管理</h2><p>已发行额度从台账自动计算，其余按当前批复口径</p></div></header>
	<table><thead><tr><th>融资品种</th><th>可发行额度</th><th>已发行额度</th><th>剩余可用额度</th><th>获批日期</th><th>到期日期</th></tr></thead><tbody>
		{#each workbench.limits as item}<tr><td><strong>{item.debtType}</strong>{#if item.calculationMode === 'net_capital_60'}<small>净资本×60%</small>{/if}</td><td>{item.limitYi.toFixed(2)}</td><td>{item.issuedYi.toFixed(2)}</td><td class:negative={item.remainingYi < 0}><strong>{item.remainingYi.toFixed(2)}</strong><span class="quota-track" aria-label={`已使用 ${item.limitYi > 0 ? Math.min(100, item.issuedYi / item.limitYi * 100).toFixed(0) : 0}%`}><i class:over-limit={item.remainingYi < 0} style:width={`${item.limitYi > 0 ? Math.min(100, item.issuedYi / item.limitYi * 100) : 0}%`}></i></span></td><td>{dateLabel(item.approvedDate)}</td><td>{dateLabel(item.expiryDate)}</td></tr>{/each}
	</tbody><tfoot><tr><th>合计</th><th>{workbench.limitTotals.limitYi.toFixed(2)}</th><th>{workbench.limitTotals.issuedYi.toFixed(2)}</th><th>{workbench.limitTotals.remainingYi.toFixed(2)}</th><th></th><th></th></tr></tfoot></table>
</section>

{#if workbench.financeParameterReminder}
	<div class="parameter-reminder" role="status"><CircleAlert size={18} /><span>请在本月初更新“上月末净资本”，收益凭证可发行额度按其 60% 计算。</span><a href="/data">去配置</a></div>
{/if}

<section class="workbench-card calendar-card">
	<header>
		<span class="section-icon blue"><CalendarDays size={19} /></span>
		<div><h2>融资日历</h2><p>本月到期{calendarSubtitle}</p></div>
		<div class="calendar-filter"><DebtPresetFilter options={workbench.typeOptions} {presets} bind:preset bind:values={selectedTypes} note={`台账截至 ${workbench.asOfDate}`} compact /></div>
	</header>
	<div class="calendar-grid">
		{#each weekdays as weekday}<div class="weekday">{weekday}</div>{/each}
		{#each calendarCells as cell}
			<div class:other={cell.other} class:today={cell.today} class="calendar-cell">
				<span class="day-number">{cell.day}</span>
				<div class="calendar-events">
					{#each cell.events as event}<a class={event.tone} href={event.href} title={event.title}>{event.title}</a>{/each}
				</div>
			</div>
		{/each}
	</div>
</section>

<section class="workbench-card simulator-card">
	<header><span class="section-icon teal"><Calculator size={19} /></span><div><h2>发行试算</h2><p>发行前先校验负债额度，集中度与财务指标将纳入后续迭代</p></div></header>
	<div class="simulator-form">
		<label><span>拟发行品种</span><select bind:value={simulationType}>{#each workbench.limits as item}<option>{item.debtType}</option>{/each}</select></label>
		<label><span>起息日</span><input type="date" bind:value={simulationDate} /></label>
		<label><span>规模（亿元）</span><input type="number" min="0.01" step="0.01" bind:value={simulationAmount} placeholder="0.00" /></label>
		<label><span>期限</span><input bind:value={simulationTenor} placeholder="例如 3Y/5Y" /></label>
	</div>
	<div class="simulation-results">
		<div class:pass={simulationResult?.pass} class:fail={simulationResult && !simulationResult.pass}><Landmark size={18} /><span><strong>负债额度</strong>{simulationResult?.message ?? '输入发行规模后自动校验'}</span></div>
		<div class="todo"><Info size={18} /><span><strong>到期当月集中度</strong>TODO：纳入拟发行后的月度到期分布</span></div>
		<div class="todo"><Info size={18} /><span><strong>LCR / NSFR / 资产负债率 / 长短期负债比</strong>TODO：接入财务数据后试算</span></div>
	</div>
</section>
