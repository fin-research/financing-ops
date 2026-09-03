import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { fetchManualChoiceSources } from '../src/lib/server/liability-choice.js';

test('liability report generation uses one quant-calibrated CTR request and never calls EDB', async () => {
	const requests = [];
	const result = await fetchManualChoiceSources({
		dataApiUrl: 'https://data.example/data',
		asOfDate: '2026-08-31',
		fetchImpl: async (url) => {
			requests.push(String(url));
			return new Response(JSON.stringify({ function: 'CTR', fields: [], rows: [] }), { status: 200 });
		}
	});
	assert.equal(requests.length, 1);
	assert.equal(requests.filter((url) => url.includes('/choice/edb')).length, 0);
	assert.equal(requests.filter((url) => url.includes('/choice/ctr')).length, 1);
	const ctrRequest = requests.find((url) => url.includes('/choice/ctr'));
	const ctrUrl = new URL(ctrRequest);
	assert.equal(ctrUrl.searchParams.get('reportName'), 'BondIssueDetail');
	const ctrOptions = ctrUrl.searchParams.get('options');
	assert.match(ctrOptions, /Bond_Type=646003/);
	assert.match(ctrOptions, /Frequency=1/);
	assert.match(ctrOptions, /Issue_Date_Type=2/);
	assert.match(ctrOptions, /Company_Type=-/);
	assert.equal(result.window.startDate, '2026-08-24');
	assert.equal(result.ctr.status, 'available');
});

test('Choice CTR failures are retried without adding another logical request', async () => {
	let calls = 0;
	const result = await fetchManualChoiceSources({
		dataApiUrl: 'https://data.example/data', asOfDate: '2026-08-31',
		fetchImpl: async () => { calls += 1; return new Response('upstream failure', { status: 503 }); },
		retryDelayMs: 0
	});
	assert.equal(calls, 3);
	assert.equal(result.ctr.status, 'missing');
});

test('weekly page renders the complete report directly in the workspace', () => {
	const source = fs.readFileSync(new URL('../src/routes/liability-report/+page.svelte', import.meta.url), 'utf8');
	assert.match(source, /近期负债发行与到期动态/);
	assert.match(source, /负债核心数据总览与指标监控/);
	assert.match(source, /融资额度及余额情况/);
	assert.match(source, /负债规模及利率走势/);
	assert.match(source, /负债到期分布全景/);
	assert.match(source, /可比券商申报及发行/);
	assert.match(source, /利率走势看板/);
	assert.match(source, /本周券商债券发行定价/);
	assert.match(source, /本周券商债券申报动态/);
	assert.match(source, /ReportBalanceRateChart/);
	assert.match(source, /ReportIssuanceChart/);
	assert.match(source, /ReportStackedBarChart/);
	assert.match(source, /ReportLineChart/);
	assert.match(source, /ReportGaugeChart/);
	assert.match(source, /ReportDonutChart/);
	assert.match(source, /ReportProgressChart/);
	assert.doesNotMatch(source, /<svg|<path|conic-gradient|progress-bar/);
	assert.doesNotMatch(source, /相关模块已隐藏数值/);
	assert.doesNotMatch(source, /近期动态暂不展示/);
	assert.doesNotMatch(source, /到期分布暂不展示/);
	assert.doesNotMatch(source, /class="weekly-report"/);
	assert.doesNotMatch(source, /id="reportContainer"/);
	assert.doesNotMatch(source, /class="a4-page"/);
	assert.doesNotMatch(source, /class="edit-toolbar"/);
	assert.equal((source.match(/class="report-page"/g) ?? []).length, 6);
	assert.equal((source.match(/第 \d+ 页 · 共 6 页/g) ?? []).length, 6);
	assert.doesNotMatch(source, /aria-label="数据口径"/);
	assert.doesNotMatch(source, /负债、融资计划与市场数据/);
	assert.doesNotMatch(source, /生产数据库口径/);
	assert.doesNotMatch(source, /近期动态口径/);
	assert.doesNotMatch(source, /详见第七部分/);
	assert.doesNotMatch(source, /生成本期周报/);
	assert.doesNotMatch(source, /数据缺失与来源状态|数据源：public\.edb ｜ 每日更新|历史周报快照/);
	assert.equal((source.match(/class="report-section"/g) ?? []).length, 7);
});

test('weekly report actions and history date selector stay in the application header', () => {
	const layout = fs.readFileSync(new URL('../src/routes/+layout.svelte', import.meta.url), 'utf8');
	const page = fs.readFileSync(new URL('../src/routes/liability-report/+page.svelte', import.meta.url), 'utf8');
	assert.match(layout, /report-header-actions/);
	assert.match(layout, /生成本期周报/);
	assert.match(layout, /window\.print\(\)/);
	assert.doesNotMatch(layout, /liability-report#history|历史快照/);
	assert.match(layout, /class="report-history-picker"/);
	assert.match(layout, /<label for="report-history-date">历史日期<\/label>/);
	assert.match(layout, /<select[\s\S]*name="run"[\s\S]*liabilityReportHistory/);
	assert.doesNotMatch(page, /history-picker|report-history-date/);
});

test('weekly report preserves the 1080px desktop canvas when scaled to A4', () => {
	const layout = fs.readFileSync(new URL('../src/routes/+layout.svelte', import.meta.url), 'utf8');
	const layoutCss = fs.readFileSync(new URL('../src/routes/layout.css', import.meta.url), 'utf8');
	const reportCss = fs.readFileSync(new URL('../src/routes/liability-report/weekly-report.css', import.meta.url), 'utf8');
	assert.match(layout, /class:liability-report-content=\{isLiabilityReport\(\)\}/);
	assert.match(layoutCss, /\.page-content\.liability-report-content\s*\{\s*max-width:\s*1080px/);
	assert.match(reportCss, /@page\s*\{\s*size:\s*A4 portrait;\s*margin:\s*0/);
	const printRules = reportCss.slice(reportCss.indexOf('@media print'));
	assert.match(printRules, /\.report-page\s*\{[\s\S]*width:\s*1080px !important/);
	assert.match(printRules, /height:\s*1527px !important/);
	assert.match(printRules, /zoom:\s*0\.734908136/);
	assert.match(reportCss, /break-after:\s*page/);
	assert.match(reportCss, /\.bento-footer/);
	const headerRules = reportCss.match(/\.bento-header\s*\{[^}]*\}/g) ?? [];
	assert.ok(headerRules.length >= 3);
	assert.ok(headerRules.every((rule) => !/min-height/.test(rule)));
});

test('weekly report query supplies every chart data contract', () => {
	const queries = fs.readFileSync(new URL('../src/lib/server/queries.js', import.meta.url), 'utf8');
	for (const field of ['maturityByType', 'annualMaturity', 'balanceRateTrend', 'issuanceTrend', 'marketHistory', 'peerIssueSummary']) {
		assert.match(queries, new RegExp(`AS ${field}`));
	}
	assert.match(queries, /'bondType', bond_type/);
	assert.match(queries, /principal_yi/);
	assert.match(queries, /interest_yi/);
	assert.match(queries, /FROM public\.edb/);
	assert.match(queries, /market_spread_history/);
	assert.doesNotMatch(queries.slice(queries.indexOf('export async function getLiabilityWeeklyReportData'), queries.indexOf('export async function getProjectGanttData')), /FROM liability_market_observations/);
});

test('recent liability dynamics keep the agreed weekly exclusions while plans remain separate', () => {
	const queries = fs.readFileSync(new URL('../src/lib/server/queries.js', import.meta.url), 'utf8');
	const eventRows = queries.slice(queries.indexOf('), event_rows AS'), queries.indexOf('), due_detail_rows AS'));
	assert.equal((eventRows.match(/NOT IN \('同业拆借', '浮动收益凭证'\)/g) ?? []).length, 3);
	assert.doesNotMatch(eventRows, /SELECT 'project'|project\.planned_issue_date/);
	assert.match(eventRows, /certificate\.subscription_date/);
	const page = fs.readFileSync(new URL('../src/routes/liability-report/+page.svelte', import.meta.url), 'utf8');
	assert.doesNotMatch(page, /sumEvents\(group\.items, \['issue', 'project'\]\)/);
	assert.match(page, /isDynamicEvent/);
	assert.match(page, /dynamicProjects as project/);
});

test('core maturity metrics include all arranged debt while only 30-day details apply exclusions', () => {
	const queries = fs.readFileSync(new URL('../src/lib/server/queries.js', import.meta.url), 'utf8');
	const weeklyQuery = queries.slice(queries.indexOf('export async function getLiabilityWeeklyReportData'), queries.indexOf('export async function getProjectGanttData'));
	const scheduledMetrics = weeklyQuery.slice(weeklyQuery.indexOf('), scheduled_maturity_metrics AS'), weeklyQuery.indexOf('), largest_borrowing AS'));
	const dueDetails = weeklyQuery.slice(weeklyQuery.indexOf('), due_detail_rows AS'), weeklyQuery.indexOf('), due_detail AS'));
	assert.match(scheduledMetrics, /FROM debt d CROSS JOIN latest/);
	assert.match(scheduledMetrics, /AS due_30_yi/);
	assert.match(scheduledMetrics, /AS due_year_yi/);
	assert.doesNotMatch(scheduledMetrics, /issue_date|NOT IN \('同业拆借', '浮动收益凭证'\)/);
	assert.match(dueDetails, /FROM debt d CROSS JOIN latest/);
	assert.equal((dueDetails.match(/NOT IN \('同业拆借', '浮动收益凭证'\)/g) ?? []).length, 1);
	assert.doesNotMatch(dueDetails, /cashflow_type = 'interest'|-利息/);
	const page = fs.readFileSync(new URL('../src/routes/liability-report/+page.svelte', import.meta.url), 'utf8');
	assert.match(page, /全量负债，含已安排未发行/);
	assert.equal((page.match(/全量负债，含已安排未发行/g) ?? []).length, 2);
	assert.match(page, /仅列负债本金到期/);
	assert.match(page, /不含同业拆借及浮动收益凭证/);
	assert.doesNotMatch(page, /付息\/到期日|未来30天无到期或付息明细/);
});

test('generation publishes missing-data reminders through global system messages', () => {
	const layout = fs.readFileSync(new URL('../src/routes/+layout.svelte', import.meta.url), 'utf8');
	const server = fs.readFileSync(new URL('../src/routes/liability-report/+page.server.ts', import.meta.url), 'utf8');
	assert.match(layout, /globalMessages\.warning\(/);
	assert.match(layout, /liability-report-missing-modules/);
	assert.match(layout, /本次周报有 \$\{missingModules\.length\} 项待核对/);
	assert.match(server, /missingModules: result\.missingModules/);
});

test('monitoring gauges reuse the market-briefing pointer and anchor treatment without texture', () => {
	const chart = fs.readFileSync(new URL('../src/routes/liability-report/ReportGaugeChart.svelte', import.meta.url), 'utf8');
	const page = fs.readFileSync(new URL('../src/routes/liability-report/+page.svelte', import.meta.url), 'utf8');
	assert.match(chart, /type: 'gauge'/);
	assert.match(chart, /pointer:\s*\{[\s\S]*show: hasValue[\s\S]*length: '50%'/);
	assert.match(chart, /anchor:\s*\{[\s\S]*show: hasValue[\s\S]*borderColor: tone/);
	assert.match(chart, /shadowBlur: 6/);
	assert.doesNotMatch(chart, /progress:/);
	assert.match(chart, /stateLabel/);
	assert.match(chart, /tooltip:/);
	assert.doesNotMatch(chart, /decal|LinearGradient|RadialGradient/);
	assert.match(page, /gaugeState\(/);
	assert.match(page, /监管监控/);
});

test('weekly peer tables follow the installation-package weekly filters and coupon field', () => {
	const queries = fs.readFileSync(new URL('../src/lib/server/queries.js', import.meta.url), 'utf8');
	const reportQuery = queries.slice(queries.indexOf('export async function getLiabilityWeeklyReportData'), queries.indexOf('export async function getProjectGanttData'));
	assert.match(reportQuery, /peer\.issue_date BETWEEN week\.week_start - 7 AND week\.week_start - 3/);
	assert.match(reportQuery, /peer\.bond_type IN \('证券公司债', '证券公司次级债', '证券公司短期融资券'\)/);
	assert.match(reportQuery, /registration\.variety IN \('小公募', '私募'\)/);
	const importer = fs.readFileSync(new URL('../scripts/import-liability-weekly-data.mjs', import.meta.url), 'utf8');
	assert.match(importer, /couponRatePct: number\(row\[30\]\)/);
});

test('weekly broker pricing and registration tables are independent left-right columns without continuation', () => {
	const page = fs.readFileSync(new URL('../src/routes/liability-report/+page.svelte', import.meta.url), 'utf8');
	const peerSection = page.slice(page.indexOf('section-6-title'), page.indexOf('section-7-title'));
	assert.match(peerSection, /class="peer-grid"/);
	assert.match(peerSection, /report\.peerIssuances as item/);
	assert.match(peerSection, /report\.registrationProgress as item/);
	assert.match(peerSection, /brokerShortName\(item\.issuerName\)/);
	assert.doesNotMatch(peerSection, /续|registrationColumns|peerIssuances\.slice/);
});

test('all weekly report tables and quota progress charts size to their available columns without scrollbars', () => {
	const css = fs.readFileSync(new URL('../src/routes/liability-report/weekly-report.css', import.meta.url), 'utf8');
	assert.match(css, /\.table-scroll\s*\{[^}]*overflow:\s*visible/);
	assert.match(css, /\.bento-table\s*\{[\s\S]*table-layout:\s*auto/);
	assert.match(css, /\.quota-progress\s*\{[^}]*width:\s*clamp\(/);
	assert.doesNotMatch(css, /overflow-x:\s*auto|min-width:\s*(?:32|47|58|9)rem|table-layout:\s*fixed/);
});

test('all liability report charts use the shared ECharts host instead of hand-drawn markup', () => {
	const chartFiles = [
		'ReportBalanceRateChart.svelte', 'ReportIssuanceChart.svelte', 'ReportLineChart.svelte',
		'ReportStackedBarChart.svelte', 'ReportGaugeChart.svelte', 'ReportDonutChart.svelte',
		'ReportProgressChart.svelte'
	];
	for (const file of chartFiles) {
		const source = fs.readFileSync(new URL(`../src/routes/liability-report/${file}`, import.meta.url), 'utf8');
		assert.match(source, /EChart/);
		assert.doesNotMatch(source, /<svg|<path|<rect|conic-gradient/);
		assert.doesNotMatch(source, /decal:\s*\{\s*show:\s*true/);
	}
	const charting = fs.readFileSync(new URL('../src/lib/charts/echarts.ts', import.meta.url), 'utf8');
	assert.match(charting, /from 'echarts\/core'/);
	assert.match(charting, /GaugeChart/);
	assert.match(charting, /PieChart/);
	assert.match(charting, /MarkPointComponent/);
});

test('liability charts and source queries follow the installation-package chart contract', () => {
	const balance = fs.readFileSync(new URL('../src/routes/liability-report/ReportBalanceRateChart.svelte', import.meta.url), 'utf8');
	const issuance = fs.readFileSync(new URL('../src/routes/liability-report/ReportIssuanceChart.svelte', import.meta.url), 'utf8');
	const stacked = fs.readFileSync(new URL('../src/routes/liability-report/ReportStackedBarChart.svelte', import.meta.url), 'utf8');
	const chartTypes = fs.readFileSync(new URL('../src/lib/liability-report-charts.ts', import.meta.url), 'utf8');
	const page = fs.readFileSync(new URL('../src/routes/liability-report/+page.svelte', import.meta.url), 'utf8');
	const queries = fs.readFileSync(new URL('../src/lib/server/queries.js', import.meta.url), 'utf8');

	assert.match(balance, /areaStyle:/);
	assert.match(balance, /firstIndexOfEachYear/);
	assert.match(balance, /markPoint:/);
	assert.match(balance, /value\.slice\(0, 4\)/);
	assert.match(chartTypes, /\['短融', '3年公募债', '5年公募债', '3年次级债', '5年次级债'\]/);
	assert.match(issuance, /\.\.\.issuanceTrendTypes\.map\(\(type\) => \(\{/);
	assert.match(issuance, /data:\s*\[\.\.\.issuanceTrendTypes\]/);
	assert.match(issuance, /params\.dataIndex === lastRateIndices\[type\]/);
	assert.doesNotMatch(issuance, /data:\s*\[[^\]]*加权发行利率/);

	assert.match(stacked, /position:\s*'inside'/);
	assert.match(stacked, /maximum:\s*\{\s*color:\s*'#dc2626'/);
	assert.match(stacked, /inverse:\s*true/);
	assert.match(stacked, /isHighlighted/);
	assert.match(page, /highlightLabel="东方财富"/);
	assert.match(page, /sort\(\(a, b\) => b\[1\] - a\[1\]\)/);

	assert.match(queries, /trend_snapshot_totals AS/);
	assert.match(queries, /LEFT JOIN balance_snapshot snapshot ON snapshot\.as_of_date = trend_snapshot_dates\.snapshot_date/);
	assert.match(queries, /SELECT LEAST\(/);
	assert.match(queries, /classified_issuances AS/);
	assert.match(queries, /issuance_types\(type\) AS/);
	assert.match(queries, /FROM issuance_months CROSS JOIN issuance_types/);
	assert.match(queries, /THEN '3年公募债'/);
	assert.match(queries, /THEN '5年次级债'/);
	assert.match(queries, /maturity_date - issue_date <= 366 THEN '短期公司债'/);
});

test('page load never fetches quota-limited Choice sources', () => {
	const page = fs.readFileSync(new URL('../src/routes/liability-report/+page.server.ts', import.meta.url), 'utf8');
	assert.doesNotMatch(page, /fetchManualChoiceSources/);
	assert.match(page, /action.*generate|generateLiabilityWeeklyReport/s);
});

test('liability market rates come from scheduled public.edb data, not manual Choice EDB', () => {
	const [service, choice, page] = [
		fs.readFileSync(new URL('../src/lib/server/liability-weekly-reports.js', import.meta.url), 'utf8'),
		fs.readFileSync(new URL('../src/lib/server/liability-choice.js', import.meta.url), 'utf8'),
		fs.readFileSync(new URL('../src/routes/liability-report/+page.server.ts', import.meta.url), 'utf8')
	];
	assert.match(service, /public\.edb/);
	assert.match(service, /edbLogicalRequests: 0/);
	assert.match(service, /peer\.bond_type IN \('证券公司债', '证券公司次级债', '证券公司短期融资券'\)/);
	assert.match(service, /registration\.variety IN \('小公募', '私募'\)/);
	assert.doesNotMatch(choice, /\/choice\/edb|edbIds/);
	assert.match(page, /利率数据读取 public\.edb/);
});

test('weekly report snapshots overwrite the existing eastmoney liability-report key by date', () => {
	const service = fs.readFileSync(new URL('../src/lib/server/liability-weekly-reports.js', import.meta.url), 'utf8');
	const config = fs.readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
	assert.match(service, /liability-report\/\$\{asOfDate\}\.json/);
	assert.match(service, /WHERE as_of_date = \?/);
	assert.match(service, /missing_maturity_details/);
	assert.match(config, /"bucket_name": "eastmoney"/);
});

test('importer has a migration-era swap identity fallback', () => {
	const source = fs.readFileSync(new URL('../scripts/import-debts.mjs', import.meta.url), 'utf8');
	assert.match(source, /source\.debt_type = '互换便利'/);
	assert.match(source, /existing\.maturity_date IS NOT DISTINCT FROM source\.maturity_date/);
});
