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
	assert.match(source, /数据缺失与来源状态/);
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
	assert.doesNotMatch(source, /第 \d+ 页 · 共 \d+ 页/);
	assert.doesNotMatch(source, /负债、融资计划与市场数据/);
	assert.doesNotMatch(source, /生产数据库口径/);
	assert.doesNotMatch(source, /近期动态口径/);
	assert.doesNotMatch(source, /详见第七部分/);
	assert.doesNotMatch(source, /生成本期周报/);
	assert.equal((source.match(/class="report-section"/g) ?? []).length, 7);
});

test('weekly report controls live in the application header', () => {
	const layout = fs.readFileSync(new URL('../src/routes/+layout.svelte', import.meta.url), 'utf8');
	assert.match(layout, /report-header-actions/);
	assert.match(layout, /生成本期周报/);
	assert.match(layout, /window\.print\(\)/);
	assert.match(layout, /liability-report#history/);
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

test('recent liability dynamics exclude interbank borrowing and floating income certificates', () => {
	const queries = fs.readFileSync(new URL('../src/lib/server/queries.js', import.meta.url), 'utf8');
	const eventRows = queries.slice(queries.indexOf('), event_rows AS'), queries.indexOf('), due_detail AS'));
	assert.match(eventRows, /NOT IN \('同业拆借', '浮动收益凭证'\)/g);
	assert.match(eventRows, /project\.debt_type/);
	const page = fs.readFileSync(new URL('../src/routes/liability-report/+page.svelte', import.meta.url), 'utf8');
	assert.match(page, /dynamicProjects = \$derived/);
	assert.match(page, /dynamicProjects as project/);
});

test('future 30-day maturity metric and details exclude interbank borrowing and floating income certificates', () => {
	const queries = fs.readFileSync(new URL('../src/lib/server/queries.js', import.meta.url), 'utf8');
	const weeklyQuery = queries.slice(queries.indexOf('export async function getLiabilityWeeklyReportData'), queries.indexOf('export async function getProjectGanttData'));
	const liveMetrics = weeklyQuery.slice(weeklyQuery.indexOf('), live_metrics AS'), weeklyQuery.indexOf('), largest_borrowing AS'));
	const dueDetails = weeklyQuery.slice(weeklyQuery.indexOf('), due_detail_rows AS'), weeklyQuery.indexOf('), due_detail AS'));
	assert.match(liveMetrics, /NOT IN \('同业拆借', '浮动收益凭证'\)[\s\S]*AS due_30_yi/);
	assert.equal((dueDetails.match(/NOT IN \('同业拆借', '浮动收益凭证'\)/g) ?? []).length, 2);
	const page = fs.readFileSync(new URL('../src/routes/liability-report/+page.svelte', import.meta.url), 'utf8');
	assert.match(page, /不含同业拆借及浮动收益凭证/);
});

test('weekly broker pricing and registration tables are independent left-right columns without continuation', () => {
	const page = fs.readFileSync(new URL('../src/routes/liability-report/+page.svelte', import.meta.url), 'utf8');
	const peerSection = page.slice(page.indexOf('section-6-title'), page.indexOf('section-7-title'));
	assert.match(peerSection, /class="peer-grid"/);
	assert.match(peerSection, /report\.peerIssuances as item/);
	assert.match(peerSection, /report\.registrationProgress as item/);
	assert.doesNotMatch(peerSection, /续|registrationColumns|peerIssuances\.slice/);
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
	}
	const charting = fs.readFileSync(new URL('../src/lib/charts/echarts.ts', import.meta.url), 'utf8');
	assert.match(charting, /from 'echarts\/core'/);
	assert.match(charting, /GaugeChart/);
	assert.match(charting, /PieChart/);
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
