<script lang="ts">
	import './weekly-report.css';
	import { enhance } from '$app/forms';
	import { withBase } from '$lib/app-paths';

	let { data } = $props();
	let report = $derived(data.report);
	let missingModules = $derived((report.provenance?.missingModules ?? []) as any[]);
	let generating = $state(false);
	let currentEvents = $derived(
		report.events.filter((item: any) => item.week === 'current' && isDynamicEvent(item))
	);
	let nextEvents = $derived(
		report.events.filter((item: any) => item.week === 'next' && isDynamicEvent(item))
	);
	let dynamicProjects = $derived(
		report.projects.filter((item: any) => !['同业拆借', '浮动收益凭证'].includes(String(item.debtType ?? '')))
	);
	let maxComposition = $derived(Math.max(1, ...report.composition.map((item: any) => item.amountYi)));
	let maxMaturity = $derived(Math.max(1, ...report.maturityDistribution.map((item: any) => item.amountYi)));
	let latestMarket = $derived(report.marketObservations ?? []);

	function isDynamicEvent(item: any) {
		return !['同业拆借', '浮动收益凭证'].includes(String(item.debtType ?? ''));
	}

	function sumEvents(items: any[], kinds: string[]) {
		return items.reduce((sum, item) => kinds.includes(item.kind) ? sum + Number(item.amountYi ?? 0) : sum, 0);
	}

	function eventAmount(items: any[], kind: string) {
		return sumEvents(items, [kind]);
	}

	function amount(value: number | null | undefined, digits = 2) {
		return value == null || !Number.isFinite(Number(value))
			? '数据缺失'
			: new Intl.NumberFormat('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Number(value));
	}

	function amountOrDash(value: number | null | undefined, digits = 2) {
		return value == null || !Number.isFinite(Number(value)) ? '数据缺失' : amount(value, digits);
	}

	function percent(value: number | null | undefined, digits = 1) {
		return value == null || !Number.isFinite(Number(value)) ? '数据缺失' : `${amount(Number(value), digits)}%`;
	}

	function signed(value: number | null | undefined, digits = 2) {
		if (value == null || !Number.isFinite(Number(value))) return '数据缺失';
		return `${Number(value) >= 0 ? '+' : '-'}${amount(Math.abs(Number(value)), digits)}`;
	}

	function dateLabel(value: string | null | undefined) {
		return value ? String(value).slice(0, 10).replaceAll('-', '/') : '数据缺失';
	}

	function headerDate(value: string | null | undefined) {
		if (!value) return '数据缺失';
		const [year, month, day] = String(value).slice(0, 10).split('-');
		return `${year}年${month}月${day}日`;
	}

	function monthLabel(value: string) {
		const [year, month] = value.split('-');
		return `${year.slice(2)}/${Number(month)}`;
	}

	function eventLabel(kind: string) {
		return ({ maturity: '到期', interest: '付息', issue: '缴款', project: '发行计划' } as Record<string, string>)[kind] ?? kind;
	}

	function projectRate(project: any) {
		if (project.expectedRateMin == null || project.expectedRateMax == null) return '数据缺失';
		const min = amount(Number(project.expectedRateMin) * 100, 2);
		const max = amount(Number(project.expectedRateMax) * 100, 2);
		return min === max ? `${min}%` : `${min}%–${max}%`;
	}

	function marketCategory(value: string) {
		return ({
			credit_spread_broker_govt_1y: 'AAA-券商与国债信用利差（1年）',
			credit_spread_broker_govt_3y: 'AAA-券商与国债信用利差（3年）',
			credit_spread_broker_govt_5y: 'AAA-券商与国债信用利差（5年）',
			state_owned_bank_ncd: '国有行存单发行利率',
			chinabond_broker_aaa_minus_yield: '中债证券公司债到期收益率（AAA-）'
		} as Record<string, string>)[value] ?? value;
	}

	function gaugeRatio(value: number | null | undefined, limit: number) {
		return Math.max(0, Math.min(1, Number(value ?? 0) / limit));
	}

	function gaugeDash(value: number | null | undefined, limit: number) {
		return `${(141.37 * gaugeRatio(value, limit)).toFixed(2)} 141.37`;
	}

	function gaugeColor(value: number | null | undefined, warning: number, limit: number) {
		if (value == null) return '#94A3B8';
		if (value >= limit) return '#DC2626';
		if (value >= warning) return '#D97706';
		return '#059669';
	}

	function compositionGradient() {
		const colors = ['#0284C7', '#3E5C9A', '#8AA0B8', '#D7DEE8', '#059669', '#D97706', '#7C3AED', '#64748B'];
		const total = report.composition.reduce((sum: number, item: any) => sum + Number(item.amountYi ?? 0), 0);
		if (total <= 0) return '#E2E8F0';
		let cursor = 0;
		return `conic-gradient(${report.composition.slice(0, colors.length).map((item: any, index: number) => {
			const next = cursor + Number(item.amountYi ?? 0) / total * 100;
			const segment = `${colors[index]} ${cursor.toFixed(2)}% ${next.toFixed(2)}%`;
			cursor = next;
			return segment;
		}).join(', ')})`;
	}

	function enhanceGeneration() {
		generating = true;
		return async ({ update }: any) => {
			try {
				await update({ reset: false });
			} finally {
				generating = false;
			}
		};
	}
</script>

<svelte:head>
	<title>东方财富证券 · 资金管理部负债周报</title>
</svelte:head>

<div class="weekly-report">
	<div class="edit-toolbar" id="toolbar">
		<div class="toolbar-left">
			<span>东方财富证券 · 资金管理部负债周报</span>
			<span class="edit-tip">生产数据工作区 · 页面访问不会消耗 Choice 配额</span>
		</div>
		<div class="toolbar-right">
			<a class="tool-btn btn-reset" href="#history">历史快照</a>
			<button class="tool-btn btn-print" type="button" onclick={() => window.print()}>导出 PDF</button>
		</div>
	</div>

	<div id="reportContainer">
		<div class="a4-page" id="page-1">
			<div class="page-content" style="gap: 8px;">
				<header class="bento-header">
					<div class="header-title-row">
						<div>
							<h1>东方财富证券 · 资金管理部负债周报</h1>
							<p class="sub">负债、融资计划与市场数据 · 生产数据库口径</p>
						</div>
						<form method="POST" action="?/generate" class="header-generate-form" use:enhance={enhanceGeneration}>
							<input type="hidden" name="confirm" value="yes" />
							<button class="tool-btn btn-generate" type="submit" disabled={generating}>{generating ? '生成中…' : '生成本期周报'}</button>
						</form>
					</div>
					<div class="header-meta-row">
						<div class="scope-card"><span class="scope-label">近期动态口径</span><select class="p1sel" aria-label="近期动态口径" value="exclude"><option value="exclude">不含拆借、浮动收益凭证</option></select></div>
						<div class="header-date"><div>报表日期：{headerDate(report.asOfDate)}</div><div>编制：资金管理部 融资组</div></div>
					</div>
				</header>

				{#if missingModules.length}<div class="template-warning" role="status"><strong>数据缺失 {missingModules.length} 项</strong><span>详见第七部分“数据缺失与来源状态”，页面保留全部数据模块。</span></div>{/if}

				<div class="card-head"><div class="section-title-wrap"><span class="section-tag">第一部分</span><span class="section-title">近期负债发行与到期动态</span></div><span class="badge-tag">不含拆借、浮动收益凭证</span></div>
				<div class="bento-card dynamic-card">
					<div class="dynamic-grid">
						{#each [{ label: '本周', items: currentEvents, note: `缴款 ${amount(eventAmount(currentEvents, 'issue'))} 亿元 · 到期 ${amount(eventAmount(currentEvents, 'maturity'))} 亿元 · 付息 ${amount(eventAmount(currentEvents, 'interest'))} 亿元` }, { label: '下周', items: nextEvents, note: `发行计划 ${amount(eventAmount(nextEvents, 'project'))} 亿元 · 到期 ${amount(eventAmount(nextEvents, 'maturity'))} 亿元 · 付息 ${amount(eventAmount(nextEvents, 'interest'))} 亿元` }] as group}
							<div class="template-week-card"><div class="week-summary">{group.label}负债动态 <span>{group.note}</span></div><table class="event-table"><tbody>{#each group.items as item}<tr><td>{dateLabel(item.date).slice(5)}</td><td><span class={`event-kind event-${item.kind}`}>{eventLabel(item.kind)}</span>：【{item.name}】</td><td>{amount(item.amountYi)}E</td></tr>{:else}<tr><td colspan="3" class="table-empty">暂无符合口径的动态</td></tr>{/each}</tbody></table></div>
						{/each}
					</div>
					<div class="template-plan-card"><div class="plan-title">推进中的融资计划</div><table class="plan-table"><thead><tr><th>品种</th><th>规模</th><th>期限</th><th>预计利率区间</th><th>发行/簿记日期</th></tr></thead><tbody>{#each dynamicProjects as project}<tr><td>{project.name}</td><td>{project.amountDescription ?? `${amount(project.amountYi)}E`}</td><td>{project.tenorDescription ?? '数据缺失'}</td><td>{projectRate(project)}</td><td>{dateLabel(project.plannedIssueDate)}</td></tr>{:else}<tr><td colspan="5" class="table-empty">暂无符合口径的融资计划</td></tr>{/each}</tbody></table></div>
				</div>

				<div class="card-head section-gap"><div class="section-title-wrap"><span class="section-tag">第二部分</span><span class="section-title">负债核心数据总览与指标监控</span></div><span class="badge-tag">单位：亿元</span></div>
				<div class="core-panel"><div class="p1-grid">
					<div class="p1card accent-cyan"><div class="p1tag">资产负债规模</div><div class="dual-value"><span>总资产</span><strong>{amount(report.parameters.total_assets?.valueYi)}<em>亿元</em></strong></div><div class="dual-value"><span>总负债</span><strong>{amount(report.parameters.total_liabilities?.valueYi)}<em>亿元</em></strong></div><div class="p1sub">{dateLabel(report.parameters.total_assets?.periodEnd)}口径</div></div>
					<div class="p1card"><div class="p1tag">主动负债余额</div><div class="p1num">{amount(report.metrics.balanceYi)}<em>亿元</em></div><div class="p1sub">较上月末 <b>{signed(report.metrics.balanceMonthChangeYi)}</b><br />较上年末 <b>{signed(report.metrics.balanceYearChangeYi)}</b></div></div>
					<div class="p1card accent-cyan"><div class="p1tag">资产负债率</div><div class="p1num">{report.parameters.adjusted_asset_liability_ratio?.valueYi == null ? '数据缺失' : percent(report.parameters.adjusted_asset_liability_ratio.valueYi * 100, 2)}</div><div class="p1sub">扣代理买卖<br />{dateLabel(report.parameters.adjusted_asset_liability_ratio?.periodEnd)}口径</div></div>
					<div class="p1card accent-amber"><div class="p1tag">加权融资利率</div><div class="p1num">{report.metrics.weightedRatePct == null ? '数据缺失' : `${amount(report.metrics.weightedRatePct, 2)}%`}</div><div class="p1sub">金额覆盖 {amount(report.quality.rateCoveragePct, 1)}%</div></div>
						<div class="p1card accent-amber"><div class="p1tag">加权剩余期限</div><div class="p1num">{#if report.metrics.weightedRemainingDays == null}数据缺失{:else}{amount(report.metrics.weightedRemainingDays, 0)}<em>天</em>{/if}</div><div class="p1sub">起息与到期字段覆盖 {amount(report.quality.lifecycleCoveragePct, 1)}%</div></div>
					<div class="p1card accent-amber"><div class="p1tag">长期负债占比</div><div class="p1num">{percent(report.metrics.longBalanceRatio)}</div><div class="p1sub">发行期限口径<br />长期 {amount(report.metrics.longBalanceYi)} · 短期 {amount(report.metrics.shortBalanceYi)} 亿元</div></div>
					<div class="p1card accent-red"><div class="p1tag">未来30天到期</div><div class="p1num danger">{amount(report.metrics.due30Yi)}<em>亿元</em></div><div class="p1sub">统计日后 1–30 天</div></div>
					<div class="p1card accent-red"><div class="p1tag">年内到期</div><div class="p1num danger">{amount(report.metrics.dueYearYi)}<em>亿元</em></div><div class="p1sub">到期日 ≤ 当年12月31日<br />占主动负债 {report.metrics.balanceYi ? percent(report.metrics.dueYearYi / report.metrics.balanceYi * 100, 1) : '数据缺失'}</div></div>
				</div></div>
				<div class="p1-gauge-row">
					{#each [
						{ label: '（短融+短期公司债+同业拆借）/上月末净资本', value: report.metrics.shortCompanyDebtRatio, numerator: report.metrics.shortCompanyDebtYi, denominator: report.parameters.prior_month_net_capital?.valueYi, denominatorDate: report.parameters.prior_month_net_capital?.periodEnd, warning: 48, limit: 60, maxLabel: '60%' },
						{ label: '发行期限1年以内短期负债 / 净资本', value: report.metrics.shortDebtRatio, numerator: report.metrics.shortDebtYi, denominator: report.parameters.prior_month_net_capital?.valueYi, denominatorDate: report.parameters.prior_month_net_capital?.periodEnd, warning: 80, limit: 100, maxLabel: '100%' },
						{ label: '新增单笔借款 / 证券上年末净资产', value: report.metrics.largestBorrowingRatio, numerator: report.metrics.largestBorrowingYi, denominator: report.parameters.securities_prior_year_net_assets?.valueYi, denominatorDate: report.parameters.securities_prior_year_net_assets?.periodEnd, warning: 16, limit: 20, maxLabel: '20%' },
						{ label: '累计新增借款 / 证券上年末净资产', value: report.metrics.cumulativeSecuritiesRatio, numerator: report.metrics.cumulativeBorrowingYi, denominator: report.parameters.securities_prior_year_net_assets?.valueYi, denominatorDate: report.parameters.securities_prior_year_net_assets?.periodEnd, warning: 40, limit: 50, maxLabel: '50%' },
						{ label: '累计新增借款 / 集团上年末净资产', value: report.metrics.cumulativeGroupRatio, numerator: report.metrics.cumulativeBorrowingYi, denominator: report.parameters.group_prior_year_net_assets?.valueYi, denominatorDate: report.parameters.group_prior_year_net_assets?.periodEnd, warning: 8, limit: 10, maxLabel: '10%' }
					] as gauge}
						<div class="p1gauge"><svg viewBox="0 0 120 82" aria-label={gauge.label}><path d="M15,68 A45,45 0 0 1 105,68" fill="none" stroke="#E8EDF4" stroke-width="11" stroke-linecap="round" /><path d="M15,68 A45,45 0 0 1 105,68" fill="none" stroke={gaugeColor(gauge.value, gauge.warning, gauge.limit)} stroke-width="11" stroke-linecap="round" stroke-dasharray={gaugeDash(gauge.value, gauge.limit)} /><text x="60" y="64" text-anchor="middle" font-size="16" font-weight="700" fill={gaugeColor(gauge.value, gauge.warning, gauge.limit)}>{gauge.value == null ? '缺失' : percent(gauge.value)}</text><text x="18" y="77" text-anchor="middle" font-size="7" fill="#9CA3AF">0</text><text x="102" y="77" text-anchor="middle" font-size="7" fill="#9CA3AF">{gauge.maxLabel}</text></svg><div class="p1gauge-t">{gauge.label}</div><div class="p1gauge-s"><b>{amountOrDash(gauge.numerator)}</b> / {amountOrDash(gauge.denominator)} 亿元<br />期末：{dateLabel(gauge.denominatorDate)}</div><div class="p1gauge-warn">上限 {gauge.maxLabel}</div></div>
					{/each}
				</div>
			</div>
			<footer class="bento-footer"><div>东方财富证券股份有限公司 · 资金管理部</div><div>第 1 页 · 共 6 页</div></footer>
		</div>

		<div class="a4-page" id="page-2"><div class="page-content" style="gap: 10px;">
			<div class="card-head"><div class="section-title-wrap"><span class="section-tag">第三部分</span><span class="section-title">融资额度及余额情况</span></div></div>
			<div class="bento-card"><div class="card-head inner-head"><span>● 融资批复额度使用情况表</span><span class="badge-tag">单位：亿元</span></div><table class="bento-table quota-table"><thead><tr><th>融资品种</th><th class="num">可用额度</th><th class="num">已用额度</th><th class="num">剩余额度</th><th>获批日期与规则</th><th>额度使用进度</th></tr></thead><tbody>{#each report.limits as item}<tr><td class="quota-name">{item.debtType}</td><td class="num">{amount(item.limitYi)}</td><td class="num">{amount(item.issuedYi)}</td><td class="num" class:negative={item.remainingYi < 0}>{amount(item.remainingYi)}</td><td>{item.approvedDate ? `${dateLabel(item.approvedDate)}${item.expiryDate ? ` · 到期 ${dateLabel(item.expiryDate)}` : ''}` : '数据缺失'}</td><td><div class="progress-cell"><span class="progress-bar-bg"><b class="progress-bar-fill" style:width={`${Math.min(100, Math.max(0, item.limitYi ? item.issuedYi / item.limitYi * 100 : 0))}%`}></b></span><span class="progress-txt">{item.limitYi ? amount(item.issuedYi / item.limitYi * 100, 1) : '缺失'}%</span></div></td></tr>{:else}<tr><td colspan="6" class="table-empty">暂无额度数据</td></tr>{/each}</tbody><tfoot><tr><th>合计</th><th class="num">{amount(report.limitTotals.limitYi)}</th><th class="num">{amount(report.limitTotals.issuedYi)}</th><th class="num">{amount(report.limitTotals.remainingYi)}</th><th></th><th></th></tr></tfoot></table></div>
			<div class="card-head section-gap"><div class="section-title-wrap"><span class="section-tag">存量</span><span class="section-title">存量负债结构</span></div><span class="badge-tag">余额快照 {dateLabel(report.asOfDate)}</span></div><div class="bento-2grid"><div class="bento-card"><div class="inner-card-title">按品种余额</div><div class="bar-list">{#each report.composition as item}<div><span>{item.type || '未分类'}</span><strong>{amount(item.amountYi)} 亿元</strong><i><b style:width={`${item.amountYi / maxComposition * 100}%`}></b></i></div>{:else}<p class="table-empty">数据缺失</p>{/each}</div></div><div class="chart-container"><div class="inner-card-title">结构占比</div><div class="composition-donut" style={`background:${compositionGradient()}`}><div class="donut-center">{amount(report.metrics.balanceYi)}<small>亿元</small></div></div><div class="legend-list">{#each report.composition.slice(0, 8) as item}<div><span class="legend-dot"></span><span>{item.type || '未分类'}</span><strong>{report.metrics.balanceYi ? amount(item.amountYi / report.metrics.balanceYi * 100, 1) : '缺失'}%</strong></div>{/each}</div></div></div>
		</div><footer class="bento-footer"><div>东方财富证券股份有限公司 · 资金管理部</div><div>第 2 页 · 共 6 页</div></footer></div>

		<div class="a4-page" id="page-rate"><div class="page-content" style="gap: 10px;">
			<div class="card-head"><div class="section-title-wrap"><span class="section-tag">第四部分</span><span class="section-title">负债规模及利率走势</span></div><span class="badge-tag">底稿最新观测</span></div>
			<div class="bento-2grid trend-grid"><div class="chart-container"><div class="chart-title">存量负债余额（按品种）</div><div class="chart-bars">{#each report.composition.slice(0, 8) as item}<div class="chart-bar-row"><span>{item.type || '未分类'}</span><i><b style:width={`${item.amountYi / maxComposition * 100}%`}></b></i><strong>{amount(item.amountYi)}</strong></div>{:else}<p class="table-empty">数据缺失</p>{/each}</div><div class="chart-foot"><span>余额快照：{dateLabel(report.asOfDate)}</span><span>单位：亿元</span></div></div><div class="chart-container"><div class="chart-title">最新利率与信用利差</div><table class="bento-table compact-table"><thead><tr><th>指标</th><th>期限</th><th class="num">最新值</th><th>日期</th></tr></thead><tbody>{#each latestMarket.slice(0, 8) as item}<tr><td>{marketCategory(item.category)}</td><td>{item.tenor ?? '—'}</td><td class="num">{item.value == null ? '数据缺失' : `${amount(item.value, 4)}${item.unit ?? ''}`}</td><td>{dateLabel(item.observationDate)}</td></tr>{:else}<tr><td colspan="4" class="table-empty">市场数据缺失</td></tr>{/each}</tbody></table></div></div>
			<div class="chart-container"><div class="chart-title">近一年市场序列可用性</div><div class="missing-grid"><article class="data-ok"><span class="missing-mark">✓</span><div><strong>已接入生产底稿最新观测</strong><p>中债 AAA-、券商与国债信用利差及国有行存单利率均显示最新日期；历史趋势序列需另行补充底稿。</p></div></article></div></div>
		</div><footer class="bento-footer"><div>东方财富证券股份有限公司 · 资金管理部</div><div>第 3 页 · 共 6 页</div></footer></div>

		<div class="a4-page" id="page-3"><div class="page-content" style="gap: 10px;">
			<div class="card-head"><div class="section-title-wrap"><span class="section-tag">第五部分</span><span class="section-title">负债到期分布全景</span></div><span class="badge-tag">未来12个月</span></div><div class="chart-container"><div class="maturity-bars">{#each report.maturityDistribution as item}<div><strong>{item.amountYi > 0 ? amount(item.amountYi, 0) : ''}</strong><i style:height={`${Math.max(3, item.amountYi / maxMaturity * 100)}%`}></i><span>{monthLabel(item.month)}</span></div>{:else}<p class="table-empty">数据缺失</p>{/each}</div><div class="chart-foot"><span>图1：未来12个月逐月到期规模分布（按品种合计）</span><span>单位：亿元</span></div></div><div class="chart-container annual-maturity"><div class="chart-title">到期规模对比</div><div class="annual-bars"><div><strong>{amount(report.metrics.due30Yi)}</strong><i style:height={`${Math.min(100, Number(report.metrics.due30Yi ?? 0) / Math.max(1, Number(report.metrics.dueYearYi ?? 0)) * 100)}%`}></i><span>未来30天</span></div><div><strong>{amount(report.metrics.dueYearYi)}</strong><i style="height:100%"></i><span>年内到期</span></div></div></div>
			<div class="card-head section-gap"><div class="section-title-wrap"><span class="section-tag">未来30天</span><span class="section-title">负债到期明细</span></div><span class="badge-tag">剔除浮动收益凭证</span></div><div class="bento-card detail-card"><table class="bento-table detail-table"><thead><tr><th>到期日</th><th>品种</th><th>负债名称</th><th>对手方</th><th class="num">本金（亿元）</th><th class="num">利率</th></tr></thead><tbody>{#each report.dueDetails as item}<tr><td>{dateLabel(item.maturityDate)}</td><td>{item.debt_type}</td><td><a href={withBase(`/debts/${item.id}`)}>{item.name}</a></td><td>{item.counterparty ?? '数据缺失'}</td><td class="num">{amount(item.principalYi)}</td><td class="num">{item.annualRatePct == null ? '数据缺失' : `${amount(item.annualRatePct, 2)}%`}</td></tr>{:else}<tr><td colspan="6" class="table-empty">未来30天无到期明细或字段缺失</td></tr>{/each}</tbody></table></div>
		</div><footer class="bento-footer"><div>东方财富证券股份有限公司 · 资金管理部</div><div>第 4 页 · 共 6 页</div></footer></div>

		<div class="a4-page" id="page-4"><div class="page-content" style="gap: 10px;">
			<div class="card-head"><div class="section-title-wrap"><span class="section-tag">第六部分</span><span class="section-title">可比券商申报及发行</span></div><span class="badge-tag">最新12条</span></div><div class="bento-card"><div class="inner-card-title">可比券商发行明细</div><table class="bento-table peer-table"><thead><tr><th>发行人</th><th>债券</th><th>品种</th><th class="num">规模</th><th>期限</th><th>利率</th><th>发行日期</th></tr></thead><tbody>{#each report.peerIssuances as item}<tr><td>{item.issuerName ?? '数据缺失'}</td><td>{item.bondName}<small>{item.securityCode ?? '无代码'}</small></td><td>{item.market ?? '数据缺失'}</td><td class="num">{item.actualIssueAmountYi == null ? '数据缺失' : `${amount(item.actualIssueAmountYi)}亿`}</td><td>{item.issueTenor ?? '数据缺失'}</td><td>{item.couponRatePct == null ? '数据缺失' : `${amount(item.couponRatePct, 2)}%`}</td><td>{dateLabel(item.issueDate)}</td></tr>{:else}<tr><td colspan="7" class="table-empty">可比券商发行数据缺失</td></tr>{/each}</tbody></table></div><div class="bento-card"><div class="inner-card-title">可比券商项目注册进程</div><table class="bento-table registration-table"><thead><tr><th>项目</th><th>发行人</th><th>状态</th><th>品种</th><th class="num">规模</th><th>更新日</th><th>主承销商</th></tr></thead><tbody>{#each report.registrationProgress as item}<tr><td>{item.projectName}</td><td>{item.issuerName ?? '数据缺失'}</td><td><span class="status-badge status-green">{item.status ?? '数据缺失'}</span></td><td>{item.variety ?? '数据缺失'}</td><td class="num">{item.amountYi == null ? '数据缺失' : `${amount(item.amountYi)}亿`}</td><td>{dateLabel(item.updateDate)}</td><td>{item.leadUnderwriter ?? '数据缺失'}</td></tr>{:else}<tr><td colspan="7" class="table-empty">可比券商注册进程数据缺失</td></tr>{/each}</tbody></table></div>
		</div><footer class="bento-footer"><div>东方财富证券股份有限公司 · 资金管理部</div><div>第 5 页 · 共 6 页</div></footer></div>

		<div class="a4-page" id="page-5"><div class="page-content" style="gap: 10px;">
			<div class="card-head"><div class="section-title-wrap"><span class="section-tag">第七部分</span><span class="section-title">利率走势看板</span></div><span class="badge-tag">底稿最新观测</span></div><div class="rate-grid">{#each ['state_owned_bank_ncd', 'chinabond_broker_aaa_minus_yield', 'credit_spread_broker_govt_1y', 'credit_spread_broker_govt_3y', 'credit_spread_broker_govt_5y'] as category}<div class="chart-container rate-card"><div class="chart-title">{marketCategory(category)}</div><table class="bento-table compact-table"><thead><tr><th>序列</th><th>期限</th><th class="num">最新值</th><th>日期</th></tr></thead><tbody>{#each latestMarket.filter((item: any) => item.category === category) as item}<tr><td>{item.seriesName}</td><td>{item.tenor ?? '—'}</td><td class="num">{item.value == null ? '数据缺失' : `${amount(item.value, 4)}${item.unit ?? ''}`}</td><td>{dateLabel(item.observationDate)}</td></tr>{:else}<tr><td colspan="4" class="table-empty">该指标暂无可靠数据</td></tr>{/each}</tbody></table></div>{/each}</div>
			<div class="card-head section-gap"><div class="section-title-wrap"><span class="section-tag">状态</span><span class="section-title">数据缺失与来源状态</span></div><span class="badge-tag">{missingModules.length} 项</span></div><div class="missing-grid template-missing-grid">{#each missingModules as item}<article><span class="missing-mark">!</span><div><strong>{item.title}</strong><p>{item.detail}</p></div></article>{:else}<article class="data-ok"><span class="missing-mark">✓</span><div><strong>当前快照未发现数据缺失</strong><p>底稿、生产参数和本次手动 Choice 拉取均有记录。</p></div></article>{/each}</div>
			<div class="card-head section-gap" id="history"><div class="section-title-wrap"><span class="section-tag">回溯</span><span class="section-title">历史周报快照</span></div><span class="badge-tag">R2 / 数据库索引</span></div><div class="history-grid">{#each data.reportHistory ?? [] as run}<a class:current={run.id === data.selectedRunId} href={`?run=${encodeURIComponent(run.id)}`}><strong>{dateLabel(run.asOfDate)}</strong><span>生成于 {dateLabel(String(run.generatedAt).slice(0, 10))}</span><em>{run.missingModules?.length ? `缺失 ${run.missingModules.length} 项` : '数据齐全'}</em></a>{:else}<p class="table-empty">尚未生成历史快照，请点击首页眉“生成本期周报”。</p>{/each}</div>
		</div><footer class="bento-footer"><div>东方财富证券股份有限公司 · 资金管理部</div><div>第 6 页 · 共 6 页</div></footer></div>
	</div>
</div>
