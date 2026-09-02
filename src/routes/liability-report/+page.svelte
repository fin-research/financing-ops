<script lang="ts">
	import './weekly-report.css';
	import { withBase } from '$lib/app-paths';
	import ReportBalanceRateChart from './ReportBalanceRateChart.svelte';
	import ReportIssuanceChart from './ReportIssuanceChart.svelte';
	import ReportLineChart from './ReportLineChart.svelte';
	import ReportStackedBarChart from './ReportStackedBarChart.svelte';

	let { data } = $props();
	let report = $derived(data.report);
	let missingModules = $derived((report.provenance?.missingModules ?? []) as any[]);
	let currentEvents = $derived(report.events.filter((item: any) => item.week === 'current' && isDynamicEvent(item)));
	let nextEvents = $derived(report.events.filter((item: any) => item.week === 'next' && isDynamicEvent(item)));
	let dynamicProjects = $derived(report.projects.filter((item: any) => !['同业拆借', '浮动收益凭证'].includes(String(item.debtType ?? ''))));
	let compositionTotal = $derived(report.composition.reduce((sum: number, item: any) => sum + Number(item.amountYi ?? 0), 0));
	let maturityLabels = $derived(report.maturityDistribution.map((item: any) => item.month));
	let maturityTypes = $derived(orderedTypes(report.maturityByType ?? []));
	let maturityRows = $derived((report.maturityByType ?? []).map((item: any) => ({ label: item.month, type: item.type, value: Number(item.amountYi ?? 0) })));
	let annualLabels = $derived([...new Set((report.annualMaturity ?? []).map((item: any) => item.bucket))] as string[]);
	let annualTypes = $derived(orderedTypes(report.annualMaturity ?? []));
	let annualRows = $derived((report.annualMaturity ?? []).map((item: any) => ({ label: item.bucket, type: item.type, value: Number(item.amountYi ?? 0) })));
	let peerLabels = $derived(peerIssuerLabels(report.peerIssueSummary ?? []));
	let peerTypes = $derived(orderedPeerTypes(report.peerIssueSummary ?? []));
	let peerRows = $derived((report.peerIssueSummary ?? []).map((item: any) => ({ label: item.issuerName, type: item.bondType, value: Number(item.amountYi ?? 0) })));
	let registrationSplit = $derived(Math.ceil((report.registrationProgress?.length ?? 0) / 2));
	let registrationColumns = $derived([report.registrationProgress.slice(0, registrationSplit), report.registrationProgress.slice(registrationSplit)]);

	const chartColors = ['#3e5c9a', '#5a78c0', '#8b7bd9', '#4fa3d1', '#e06a74', '#8aa0b8', '#e0a24e', '#54bfa0', '#8fcdf2', '#7fd1b0'];
	const marketCategories = [
		{ key: 'state_owned_bank_ncd', title: '2026年国有行同业存单发行利率走势' },
		{ key: 'credit_spread_broker_govt_1y', title: '2026年AAA-券商与国债到期收益率与利差（1年）' },
		{ key: 'credit_spread_broker_govt_3y', title: '2026年AAA-券商与国债到期收益率与利差（3年）' },
		{ key: 'credit_spread_broker_govt_5y', title: '2026年AAA-券商与国债到期收益率与利差（5年）' }
	];

	function orderedTypes(rows: any[]) {
		const compositionOrder = report.composition.map((item: any) => item.type);
		return [...new Set(rows.map((item: any) => String(item.type)))].sort((a, b) => {
			const left = compositionOrder.indexOf(a);
			const right = compositionOrder.indexOf(b);
			return (left < 0 ? 99 : left) - (right < 0 ? 99 : right) || a.localeCompare(b, 'zh-CN');
		});
	}

	function isDynamicEvent(item: any) {
		return !['同业拆借', '浮动收益凭证'].includes(String(item.debtType ?? ''));
	}

	function orderedPeerTypes(rows: any[]) {
		const preferred = ['公募债', '次级债', '短期融资券', '私募债'];
		return [...new Set(rows.map((item: any) => String(item.bondType)))].sort((a, b) => {
			const left = preferred.indexOf(a);
			const right = preferred.indexOf(b);
			return (left < 0 ? 99 : left) - (right < 0 ? 99 : right) || a.localeCompare(b, 'zh-CN');
		});
	}

	function peerIssuerLabels(rows: any[]) {
		const totals = new Map<string, number>();
		for (const row of rows) totals.set(row.issuerName, (totals.get(row.issuerName) ?? 0) + Number(row.amountYi ?? 0));
		return [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
	}

	function sumEvents(items: any[], kinds: string[]) { return items.reduce((sum, item) => kinds.includes(item.kind) ? sum + Number(item.amountYi ?? 0) : sum, 0); }
	function amount(value: number | null | undefined, digits = 2) { return value == null || !Number.isFinite(Number(value)) ? '数据缺失' : new Intl.NumberFormat('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Number(value)); }
	function numberOrDash(value: number | null | undefined, digits = 2) { return value == null || !Number.isFinite(Number(value)) ? '—' : amount(value, digits); }
	function percent(value: number | null | undefined, digits = 1) { return value == null || !Number.isFinite(Number(value)) ? '数据缺失' : `${amount(Number(value), digits)}%`; }
	function signed(value: number | null | undefined, digits = 2) { if (value == null || !Number.isFinite(Number(value))) return '数据缺失'; return `${Number(value) >= 0 ? '+' : '-'}${amount(Math.abs(Number(value)), digits)}`; }
	function dateLabel(value: string | null | undefined) { return value ? String(value).slice(0, 10).replaceAll('-', '/') : '数据缺失'; }
	function headerDate(value: string | null | undefined) { if (!value) return '数据缺失'; const [year, month, day] = String(value).slice(0, 10).split('-'); return `${year}年${month}月${day}日`; }
	function weekdayDate(value: string | null | undefined) { if (!value) return '日期缺失'; const date = new Date(`${String(value).slice(0, 10)}T00:00:00Z`); return `周${'日一二三四五六'[date.getUTCDay()]} ${String(value).slice(5, 10)}`; }
	function eventLabel(kind: string) { return ({ maturity: '到期', interest: '付息', issue: '发行', project: '发行计划' } as Record<string, string>)[kind] ?? kind; }
	function projectRate(project: any) { if (project.expectedRateMin == null || project.expectedRateMax == null) return '数据缺失'; const min = amount(Number(project.expectedRateMin) * 100, 2); const max = amount(Number(project.expectedRateMax) * 100, 2); const interval = min === max ? `${min}%` : `${min}%–${max}%`; return project.fundingCostRate == null ? interval : `${interval}（资金成本 ${amount(Number(project.fundingCostRate) * 100, 2)}%）`; }
	function gaugeRatio(value: number | null | undefined, limit: number) { return Math.max(0, Math.min(1, Number(value ?? 0) / limit)); }
	function gaugeDash(value: number | null | undefined, limit: number) { return `${(141.37 * gaugeRatio(value, limit)).toFixed(2)} 141.37`; }
	function gaugeColor(value: number | null | undefined, warning: number, limit: number) { if (value == null) return '#94a3b8'; if (value >= limit) return '#dc2626'; if (value >= warning) return '#d97706'; return '#059669'; }
	function compositionGradient() { if (compositionTotal <= 0) return '#e2e8f0'; let cursor = 0; return `conic-gradient(${report.composition.map((item: any, index: number) => { const next = cursor + Number(item.amountYi ?? 0) / compositionTotal * 100; const segment = `${chartColors[index % chartColors.length]} ${cursor.toFixed(2)}% ${next.toFixed(2)}%`; cursor = next; return segment; }).join(', ')})`; }
	function quotaTone(item: any) { const used = item.limitYi ? Number(item.issuedYi ?? 0) / Number(item.limitYi) * 100 : 0; return used >= 80 ? 'risk' : used >= 45 ? 'warning' : 'safe'; }
	function marketRows(category: string) { return (report.marketHistory ?? []).filter((item: any) => item.category === category); }
</script>

<svelte:head><title>东方财富证券 · 资金管理部负债周报</title></svelte:head>

<header class="bento-header"><h1>东方财富证券 · 资金管理部负债周报</h1><div class="header-meta-row"><div class="report-period"><span>报表日期：{headerDate(report.asOfDate)}</span><span>编制：资金管理部 融资组</span></div></div></header>

<div class="report-facts" aria-label="数据口径与来源状态"><span><b>数据基准日</b>{dateLabel(report.asOfDate)}</span><span><b>数据滞后</b>{report.staleDays}天</span><span><b>明细勾稽差额</b>{signed(report.quality.reconciliationDeltaYi, 4)}亿元</span><span class:fact-warning={missingModules.length > 0}><b>来源状态</b>{missingModules.length ? `${missingModules.length} 项待核对` : '已核对'}</span></div>

<section class="report-section" aria-labelledby="section-1-title">
	<div class="card-head"><div class="section-title-wrap"><span class="section-tag">第一部分</span><h2 id="section-1-title" class="section-title">近期负债发行与到期动态</h2></div></div>
	<div class="bento-card dynamic-card"><div class="dynamic-grid">{#each [{ label: '本周', items: currentEvents, issueLabel: '负债缴款' }, { label: '下周', items: nextEvents, issueLabel: '负债发行' }] as group}<div class="template-week-card"><div class="week-summary">{group.label}{group.issueLabel} <strong class="positive">{amount(sumEvents(group.items, ['issue', 'project']))}</strong> 亿元，到期 <strong class="negative-text">{amount(sumEvents(group.items, ['maturity']))}</strong> 亿元，付息 <strong class="negative-text">{amount(sumEvents(group.items, ['interest']))}</strong> 亿元</div><div class="table-scroll"><table class="event-table"><tbody>{#each group.items as item}<tr><td>{weekdayDate(item.date)}</td><td><span class={`event-kind event-${item.kind}`}>{eventLabel(item.kind)}</span>：【{item.name}】</td><td>{amount(item.amountYi, 4)}E</td></tr>{:else}<tr><td colspan="3" class="table-empty">暂无符合口径的动态</td></tr>{/each}</tbody></table></div></div>{/each}</div><div class="template-plan-card"><div class="plan-title">推进中的融资计划</div><div class="table-scroll"><table class="plan-table"><thead><tr><th>品种</th><th>规模</th><th>期限</th><th>预计利率区间</th><th>发行/簿记日期</th></tr></thead><tbody>{#each dynamicProjects as project}<tr><td>{project.name}</td><td>{project.amountDescription ?? `${amount(project.amountYi)}E`}</td><td>{project.tenorDescription ?? '数据缺失'}</td><td>{projectRate(project)}</td><td>{dateLabel(project.plannedIssueDate)}</td></tr>{:else}<tr><td colspan="5" class="table-empty">暂无符合口径的融资计划</td></tr>{/each}</tbody></table></div></div></div>
</section>

<section class="report-section" aria-labelledby="section-2-title">
	<div class="card-head"><div class="section-title-wrap"><span class="section-tag">第二部分</span><h2 id="section-2-title" class="section-title">负债核心数据总览与指标监控</h2></div></div>
	<div class="core-panel"><div class="p1-grid"><div class="p1card accent-cyan"><div class="p1tag">资产负债规模</div><div class="dual-value"><span>总资产</span><strong>{amount(report.parameters.total_assets?.valueYi)}<em>亿元</em></strong></div><div class="dual-value"><span>总负债</span><strong>{amount(report.parameters.total_liabilities?.valueYi)}<em>亿元</em></strong></div><div class="p1sub">{dateLabel(report.parameters.total_assets?.periodEnd)}口径</div></div><div class="p1card"><div class="p1tag">主动负债余额</div><div class="p1num">{amount(report.metrics.balanceYi)}<em>亿元</em></div><div class="p1sub">较上月末 <b>{signed(report.metrics.balanceMonthChangeYi)}</b> 亿元<br />较上年末 <b>{signed(report.metrics.balanceYearChangeYi)}</b> 亿元</div></div><div class="p1card accent-cyan"><div class="p1tag">资产负债率</div><div class="p1num">{report.parameters.adjusted_asset_liability_ratio?.valueYi == null ? '数据缺失' : percent(report.parameters.adjusted_asset_liability_ratio.valueYi * 100, 2)}</div><div class="p1sub">扣代理买卖<br />{dateLabel(report.parameters.adjusted_asset_liability_ratio?.periodEnd)}口径</div></div><div class="p1card accent-amber"><div class="p1tag">加权融资利率</div><div class="p1num">{report.metrics.weightedRatePct == null ? '数据缺失' : `${amount(report.metrics.weightedRatePct, 2)}%`}</div><div class="p1sub">较上月末 <b>{signed(report.metrics.weightedRateMonthBp, 1)}</b> bp<br />金额覆盖 {amount(report.quality.rateCoveragePct, 1)}%</div></div><div class="p1card accent-amber"><div class="p1tag">加权剩余期限</div><div class="p1num">{#if report.metrics.weightedRemainingDays == null}数据缺失{:else}{amount(report.metrics.weightedRemainingDays, 0)}<em>天</em>{/if}</div><div class="p1sub">起息与到期字段覆盖 {amount(report.quality.lifecycleCoveragePct, 1)}%</div></div><div class="p1card accent-amber"><div class="p1tag">长期负债占比</div><div class="p1num">{percent(report.metrics.longBalanceRatio)}</div><div class="p1sub">发行期限口径<br />长期 <b>{amount(report.metrics.longBalanceYi, 0)}</b> 亿元、短期 <b>{amount(report.metrics.shortBalanceYi, 0)}</b> 亿元</div></div><div class="p1card accent-red"><div class="p1tag">未来30天到期</div><div class="p1num danger">{amount(report.metrics.due30Yi)}<em>亿元</em></div><div class="p1sub">统计日后 1–30 天到期规模</div></div><div class="p1card accent-red"><div class="p1tag">年内到期</div><div class="p1num danger">{amount(report.metrics.dueYearYi)}<em>亿元</em></div><div class="p1sub">到期日 ≤ 当年12月31日<br />占主动负债 {report.metrics.balanceYi ? percent(report.metrics.dueYearYi / report.metrics.balanceYi * 100, 1) : '数据缺失'}</div></div></div></div>
	<div class="p1-gauge-row">{#each [{ label: '（短融+短期公司债+同业拆借）/上月末净资本', value: report.metrics.shortCompanyDebtRatio, numerator: report.metrics.shortCompanyDebtYi, denominator: report.parameters.prior_month_net_capital?.valueYi, warning: 48, limit: 60, maxLabel: '60%' }, { label: '发行期限1年以内短期负债 / 净资本', value: report.metrics.shortDebtRatio, numerator: report.metrics.shortDebtYi, denominator: report.parameters.prior_month_net_capital?.valueYi, warning: 80, limit: 100, maxLabel: '100%' }, { label: '新增单笔借款 / 证券上年末净资产', value: report.metrics.largestBorrowingRatio, numerator: report.metrics.largestBorrowingYi, denominator: report.parameters.securities_prior_year_net_assets?.valueYi, warning: 16, limit: 20, maxLabel: '20%' }, { label: '月末累计新增借款 / 证券上年末净资产', value: report.metrics.cumulativeSecuritiesRatio, numerator: report.metrics.cumulativeBorrowingYi, denominator: report.parameters.securities_prior_year_net_assets?.valueYi, warning: 40, limit: 50, maxLabel: '50%' }, { label: '月末累计新增借款 / 集团上年末净资产', value: report.metrics.cumulativeGroupRatio, numerator: report.metrics.cumulativeBorrowingYi, denominator: report.parameters.group_prior_year_net_assets?.valueYi, warning: 8, limit: 10, maxLabel: '10%' }] as gauge}<div class="p1gauge"><svg viewBox="0 0 120 82" role="img" aria-label={`${gauge.label}，${percent(gauge.value)}`}><path d="M15,68 A45,45 0 0 1 105,68" fill="none" stroke="#e8edf4" stroke-width="11" stroke-linecap="round" /><path d="M15,68 A45,45 0 0 1 105,68" fill="none" stroke={gaugeColor(gauge.value, gauge.warning, gauge.limit)} stroke-width="11" stroke-linecap="round" stroke-dasharray={gaugeDash(gauge.value, gauge.limit)} /><text x="60" y="64" text-anchor="middle" font-size="16" font-weight="700" fill={gaugeColor(gauge.value, gauge.warning, gauge.limit)}>{gauge.value == null ? '缺失' : percent(gauge.value)}</text><text x="18" y="77" text-anchor="middle" font-size="7" fill="#9ca3af">0</text><text x="102" y="77" text-anchor="middle" font-size="7" fill="#9ca3af">{gauge.maxLabel}</text></svg><div class="p1gauge-t">{gauge.label}</div><div class="p1gauge-s"><b>{numberOrDash(gauge.numerator)}</b> / {numberOrDash(gauge.denominator)} 亿元</div><div class="p1gauge-warn">上限 {gauge.maxLabel}</div></div>{/each}</div>
</section>

<section class="report-section" aria-labelledby="section-3-title">
	<div class="card-head"><div class="section-title-wrap"><span class="section-tag">第三部分</span><h2 id="section-3-title" class="section-title">融资额度及余额情况</h2></div></div>
	<div class="bento-card"><div class="inner-card-title">● 融资批复额度使用情况表 <span>单位：亿元</span></div><div class="table-scroll"><table class="bento-table quota-table"><thead><tr><th>融资品种</th><th class="num">可用额度</th><th class="num">已用额度</th><th class="num">剩余额度</th><th>获批日期与规则</th><th>额度使用进度</th></tr></thead><tbody>{#each report.limits as item, limitIndex}<tr><td class="quota-name"><i style={`--quota-color:${chartColors[limitIndex % chartColors.length]}`}></i>{item.debtType}</td><td class="num">{amount(item.limitYi)}</td><td class="num">{amount(item.issuedYi)}</td><td class="num" class:negative={item.remainingYi < 0}>{amount(item.remainingYi)}</td><td>{item.approvedDate ? `${dateLabel(item.approvedDate)}${item.expiryDate ? `–${dateLabel(item.expiryDate)}` : ''}` : '数据缺失'}</td><td><div class={`progress-cell ${quotaTone(item)}`}><span class="progress-bar-bg"><b class="progress-bar-fill" style:width={`${Math.min(100, Math.max(0, item.limitYi ? item.issuedYi / item.limitYi * 100 : 0))}%`}></b></span><span class="progress-txt">{item.limitYi ? amount(item.issuedYi / item.limitYi * 100, 1) : '—'}%</span></div></td></tr>{:else}<tr><td colspan="6" class="table-empty">暂无额度数据</td></tr>{/each}</tbody><tfoot><tr><th>合计</th><th class="num">{amount(report.limitTotals.limitYi)}</th><th class="num">{amount(report.limitTotals.issuedYi)}</th><th class="num">{amount(report.limitTotals.remainingYi)}</th><th></th><th><div class="progress-cell safe"><span class="progress-bar-bg"><b class="progress-bar-fill" style:width={`${Math.min(100, report.limitTotals.limitYi ? report.limitTotals.issuedYi / report.limitTotals.limitYi * 100 : 0)}%`}></b></span><span class="progress-txt">{report.limitTotals.limitYi ? amount(report.limitTotals.issuedYi / report.limitTotals.limitYi * 100, 1) : '—'}%</span></div></th></tr></tfoot></table></div></div>
	<div class="chart-container composition-panel"><div class="chart-scope-line">数据截至 {headerDate(report.asOfDate)}<br />融资品种口径：全量</div><div class="composition-layout"><div class="composition-donut" style={`background:${compositionGradient()}`} role="img" aria-label={`融资余额结构，合计 ${amount(compositionTotal)} 亿元`}><div class="donut-center"><small>融资品种合计</small>{amount(compositionTotal)}<small>亿元</small></div></div><div class="table-scroll"><table class="bento-table composition-table"><thead><tr><th>融资品种</th><th class="num">余额（亿元）</th><th class="num">占比</th></tr></thead><tbody>{#each report.composition as item, index}<tr><td><i style={`--legend-color:${chartColors[index % chartColors.length]}`}></i>{item.type || '未分类'}</td><td class="num">{amount(item.amountYi)}</td><td class="num">{compositionTotal ? percent(item.amountYi / compositionTotal * 100, 2) : '数据缺失'}</td></tr>{/each}<tr class="total-row"><td>合计</td><td class="num">{amount(compositionTotal)}</td><td class="num">100.00%</td></tr></tbody></table></div></div></div>
</section>

<section class="report-section" aria-labelledby="section-4-title"><div class="card-head"><div class="section-title-wrap"><span class="section-tag">第四部分</span><h2 id="section-4-title" class="section-title">负债规模及利率走势</h2></div></div><div class="chart-container large-chart"><h3>公司融资余额及综合融资利率走势</h3><ReportBalanceRateChart rows={report.balanceRateTrend ?? []} /><div class="chart-foot"><span>图：2021 年至今公司加权平均融资利率与融资余额（亿元，%）</span></div></div><div class="chart-container large-chart"><h3>近一年公司债券发行规模及利率走势</h3><ReportIssuanceChart rows={report.issuanceTrend ?? []} /><div class="chart-foot"><span>图：公司近一年公募债及次级债发行规模及利率（亿元，%）</span></div></div></section>

<section class="report-section" aria-labelledby="section-5-title"><div class="card-head"><div class="section-title-wrap"><span class="section-tag">第五部分</span><h2 id="section-5-title" class="section-title">负债到期分布全景</h2></div></div><div class="chart-container large-chart"><ReportStackedBarChart title="未来12个月负债逐月到期规模分布" rows={maturityRows} labels={maturityLabels} types={maturityTypes} height={300} /><div class="chart-foot"><span>图 1：未来 12 个月负债逐月到期规模分布（按品种）（亿元）</span><span>逐月到期堆叠柱状图</span></div></div><div class="chart-container large-chart"><ReportStackedBarChart title="存量负债年度到期阶梯与品种构成" rows={annualRows} labels={annualLabels} types={annualTypes} height={280} /><div class="chart-foot"><span>图 2：存量负债年度到期阶梯与品种构成（亿元）</span><span>年度到期阶梯图</span></div></div><div class="card-head inner-section-head"><h3>未来30天负债到期明细</h3><span class="badge-tag">数据基准 {dateLabel(report.asOfDate)} ｜ 单位：亿元</span></div><div class="table-scroll"><table class="bento-table maturity-table"><thead><tr><th>品种</th><th>对手方</th><th class="num">本金</th><th class="num">利息</th><th class="num">利率</th><th>付息/到期日</th></tr></thead><tbody>{#each report.dueDetails as item}<tr><td><a href={withBase(`/debts/${String(item.id).split(':')[0]}`)}>{item.debt_type}</a></td><td>{item.counterparty ?? '—'}</td><td class="num">{amount(item.principalYi)}</td><td class="num">{numberOrDash(item.interestYi)}</td><td class="num">{item.annualRatePct == null ? '数据缺失' : `${amount(item.annualRatePct, 2)}%`}</td><td>{dateLabel(item.dueDate ?? item.maturityDate)}</td></tr>{:else}<tr><td colspan="6" class="table-empty">未来30天无到期或付息明细</td></tr>{/each}</tbody><tfoot><tr><th>合计</th><th></th><th class="num">{amount(report.dueDetails.reduce((sum: number, item: any) => sum + Number(item.principalYi ?? 0), 0))}</th><th class="num">{amount(report.dueDetails.reduce((sum: number, item: any) => sum + Number(item.interestYi ?? 0), 0))}</th><th></th><th></th></tr></tfoot></table></div></section>

<section class="report-section" aria-labelledby="section-6-title">
	<div class="card-head"><div class="section-title-wrap"><span class="section-tag">第六部分</span><h2 id="section-6-title" class="section-title">可比券商申报及发行</h2></div></div>
	<div class="chart-container large-chart"><h3>{String(report.asOfDate).slice(0, 4)}年以来证券公司债券发行规模与品种构成（亿元）</h3><ReportStackedBarChart title="可比券商债券发行规模与品种构成" rows={peerRows} labels={peerLabels} types={peerTypes} height={430} horizontal /></div>
	<div class="peer-grid">
		<div class="bento-card">
			<div class="inner-card-title">● 本周券商债券发行定价</div>
			<div class="table-scroll"><table class="bento-table peer-pricing-table"><thead><tr><th>发行人</th><th>品种</th><th class="num">规模</th><th>期限</th><th class="num">利率</th><th>发行日期</th></tr></thead><tbody>{#each report.peerIssuances.slice(0, 5) as item}<tr><td>{item.issuerName ?? '数据缺失'}</td><td>{item.bondType ?? '数据缺失'}</td><td class="num">{item.actualIssueAmountYi == null ? '数据缺失' : `${amount(item.actualIssueAmountYi)}亿`}</td><td>{item.issueTenor ?? '数据缺失'}</td><td class="num">{item.couponRatePct == null ? '数据缺失' : `${amount(item.couponRatePct, 2)}%`}</td><td>{dateLabel(item.issueDate)}</td></tr>{:else}<tr><td colspan="6" class="table-empty">可比券商发行数据缺失</td></tr>{/each}</tbody></table></div>
			<div class="inner-card-title peer-subtitle">● 本周券商债券申报动态</div>
			<div class="table-scroll"><table class="bento-table registration-table"><thead><tr><th>发行方</th><th>品种</th><th class="num">申报</th><th>状态</th><th>更新日</th></tr></thead><tbody>{#each registrationColumns[0] ?? [] as item}<tr><td>{item.issuerName ?? '数据缺失'}</td><td>{item.variety ?? '数据缺失'}</td><td class="num">{item.amountYi == null ? '数据缺失' : `${amount(item.amountYi, 0)}亿`}</td><td><span class="status-badge status-green">{item.status ?? '数据缺失'}</span></td><td>{dateLabel(item.updateDate)}</td></tr>{:else}<tr><td colspan="5" class="table-empty">可比券商申报数据缺失</td></tr>{/each}</tbody></table></div>
		</div>
		<div class="bento-card">
			<div class="inner-card-title">● 本周券商债券申报动态（续）</div>
			<div class="table-scroll"><table class="bento-table registration-table"><thead><tr><th>发行方</th><th>品种</th><th class="num">申报</th><th>状态</th><th>更新日</th></tr></thead><tbody>{#each registrationColumns[1] ?? [] as item}<tr><td>{item.issuerName ?? '数据缺失'}</td><td>{item.variety ?? '数据缺失'}</td><td class="num">{item.amountYi == null ? '数据缺失' : `${amount(item.amountYi, 0)}亿`}</td><td><span class="status-badge status-green">{item.status ?? '数据缺失'}</span></td><td>{dateLabel(item.updateDate)}</td></tr>{:else}<tr><td colspan="5" class="table-empty">可比券商申报数据缺失</td></tr>{/each}</tbody></table></div>
		</div>
	</div>
</section>

<section class="report-section" aria-labelledby="section-7-title"><div class="card-head"><div class="section-title-wrap"><span class="section-tag">第七部分</span><h2 id="section-7-title" class="section-title">利率走势看板</h2></div></div><div class="chart-container large-chart"><h3>2026年中债证券公司债（AAA-）期限利率走势</h3><ReportLineChart title="中债证券公司债AAA-期限利率走势" rows={marketRows('chinabond_broker_aaa_minus_yield')} height={330} /></div><div class="rate-grid">{#each marketCategories as category}<div class="chart-container rate-card"><h3>{category.title}</h3><ReportLineChart title={category.title} rows={marketRows(category.key)} height={250} compact /></div>{/each}</div></section>

<section class="report-appendix" aria-labelledby="source-status-title"><div class="card-head"><div class="section-title-wrap"><span class="section-tag">数据</span><h2 id="source-status-title" class="section-title">数据缺失与来源状态</h2></div><span class="badge-tag">{missingModules.length} 项</span></div>{#if data.snapshotError}<p class="snapshot-error" role="alert">{data.snapshotError}</p>{/if}<div class="missing-grid">{#each missingModules as item}<article><span class="missing-mark" aria-hidden="true">!</span><div><strong>{item.title}</strong><p>{item.detail}</p></div></article>{:else}<article class="data-ok"><span class="missing-mark" aria-hidden="true">✓</span><div><strong>当前快照未发现数据缺失</strong><p>底稿、生产参数和本次手动 Choice 拉取均有记录。</p></div></article>{/each}</div></section>

<section class="report-appendix" id="history" aria-labelledby="history-title"><div class="card-head"><div class="section-title-wrap"><span class="section-tag">回溯</span><h2 id="history-title" class="section-title">历史周报快照</h2></div><span class="badge-tag">R2 / 数据库索引</span></div><div class="history-grid">{#each data.reportHistory ?? [] as run}<a class:current={run.id === data.selectedRunId} href={`?run=${encodeURIComponent(run.id)}`}><strong>{dateLabel(run.asOfDate)}</strong><span>生成于 {dateLabel(String(run.generatedAt).slice(0, 10))}</span><em>{run.missingModules?.length ? `待核对 ${run.missingModules.length} 项` : '数据齐全'}</em></a>{:else}<p class="table-empty">尚未生成历史快照。</p>{/each}</div></section>
