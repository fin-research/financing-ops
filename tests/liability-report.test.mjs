import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { fetchManualChoiceSources } from '../src/lib/server/liability-choice.js';

test('liability report generation uses bounded EDB and quant-calibrated CTR parameters', async () => {
	const requests = [];
	const result = await fetchManualChoiceSources({
		dataApiUrl: 'https://data.example/data',
		asOfDate: '2026-08-31',
		fetchImpl: async (url) => {
			requests.push(String(url));
			return new Response(JSON.stringify({ function: url.pathname.endsWith('/edb') ? 'EDB' : 'CTR', fields: [], rows: [] }), { status: 200 });
		}
	});
	assert.equal(requests.length, 2);
	assert.equal(requests.filter((url) => url.includes('/choice/edb')).length, 1);
	assert.equal(requests.filter((url) => url.includes('/choice/ctr')).length, 1);
	assert.match(requests.find((url) => url.includes('/choice/edb')), /edbIds=E1707781/);
	const ctrRequest = requests.find((url) => url.includes('/choice/ctr'));
	const ctrUrl = new URL(ctrRequest);
	assert.equal(ctrUrl.searchParams.get('reportName'), 'BondIssueDetail');
	const ctrOptions = ctrUrl.searchParams.get('options');
	assert.match(ctrOptions, /Bond_Type=646003/);
	assert.match(ctrOptions, /Frequency=1/);
	assert.match(ctrOptions, /Issue_Date_Type=2/);
	assert.match(ctrOptions, /Company_Type=-/);
	assert.equal(result.window.startDate, '2026-08-24');
	assert.equal(result.edb.status, 'available');
	assert.equal(result.ctr.status, 'available');
});

test('Choice failures are retried without changing the two logical request bound', async () => {
	let calls = 0;
	const result = await fetchManualChoiceSources({
		dataApiUrl: 'https://data.example/data', asOfDate: '2026-08-31',
		fetchImpl: async () => { calls += 1; return new Response('upstream failure', { status: 503 }); },
		retryDelayMs: 0
	});
	assert.equal(calls, 6);
	assert.equal(result.edb.status, 'missing');
	assert.equal(result.ctr.status, 'missing');
});

test('weekly page keeps data sections visible when reconciliation is unavailable', () => {
	const source = fs.readFileSync(new URL('../src/routes/liability-report/+page.svelte', import.meta.url), 'utf8');
	assert.match(source, /数据缺失与来源状态/);
	assert.match(source, /利率与信用利差/);
	assert.match(source, /可比券商发行明细/);
	assert.match(source, /可比券商项目注册进程/);
	assert.doesNotMatch(source, /相关模块已隐藏数值/);
	assert.doesNotMatch(source, /近期动态暂不展示/);
	assert.doesNotMatch(source, /到期分布暂不展示/);
});

test('page load never fetches quota-limited Choice sources', () => {
	const page = fs.readFileSync(new URL('../src/routes/liability-report/+page.server.ts', import.meta.url), 'utf8');
	assert.doesNotMatch(page, /fetchManualChoiceSources/);
	assert.match(page, /action.*generate|generateLiabilityWeeklyReport/s);
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
