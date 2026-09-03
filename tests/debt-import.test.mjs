import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import * as XLSX from 'xlsx/xlsx.mjs';
import { parseDebtWorkbookData } from '../scripts/lib/excel-import.mjs';
import { transformWorkbook } from '../scripts/lib/debt-transform.mjs';

function workbookFixture() {
	const workbook = XLSX.utils.book_new();
	const summaryRows = [
		[],
		[],
		['品种', '2026-09-03'],
		['收益凭证', 1],
		['收益权转让', 2],
		['同业拆借', 3],
		['次级债', 4],
		['集团借款', 5],
		['转融资', 6],
		['短期融资券', 7],
		['私募债', 8],
		['小公募', 9],
		['互换便利', 10],
		['合计', 55]
	];
	XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(summaryRows), '借入资金汇总表');
	XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
		['名称', '借款对象', '借入金额', '起息日', '到期日', '利率'],
		['测试集团借款', '集团公司', 100000000, '2026-09-01', '2027-09-01', '2.1%']
	]), '集团借款');
	return XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
}

test('uploaded workbook is parsed and transformed directly without persisting the raw file', () => {
	const transformed = transformWorkbook(parseDebtWorkbookData(
		workbookFixture(),
		'东方财富证券借入资金汇总表20260903.xlsx'
	));
	assert.equal(transformed.snapshot.asOfDate, '2026-09-03');
	assert.equal(transformed.snapshot.totalYi, 55);
	assert.equal(transformed.debts.length, 1);
	assert.equal(transformed.debts[0].debtType, '集团借款');
	assert.equal(transformed.debts[0].amount, 100000000);
	assert.equal(transformed.debts[0].annualRate, 0.021);
	assert.equal(transformed.balances.length, 10);
});

test('online import uses Neon staging plus Workflow and has no R2 upload path', () => {
	const [route, workflow, config, panel] = [
		fs.readFileSync(new URL('../src/routes/data/import/+server.ts', import.meta.url), 'utf8'),
		fs.readFileSync(new URL('../src/workflows/debt-import.ts', import.meta.url), 'utf8'),
		fs.readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'),
		fs.readFileSync(new URL('../src/lib/DebtImportPanel.svelte', import.meta.url), 'utf8')
	];
	assert.match(route, /request\.arrayBuffer\(\)/);
	assert.match(route, /parseDebtWorkbookData\(workbookData, fileName\)/);
	assert.match(route, /stageDebtImportPayload/);
	assert.match(route, /DEBT_IMPORT_WORKFLOW\.create/);
	assert.doesNotMatch(route, /R2|LIABILITY_REPORT_SNAPSHOTS|\.put\(/);
	assert.match(workflow, /importDebtWorkbook/);
	assert.match(workflow, /refreshDebtImportDerivatives/);
	assert.match(workflow, /completeDebtImportRun/);
	assert.match(config, /"name": "financing-debt-import"/);
	assert.match(config, /"class_name": "DebtImportWorkflow"/);
	assert.match(panel, /function schedulePoll\(runId: string, delay = 1500\)/);
	assert.match(panel, /上传后立即解析，原始 Excel 不留存/);
});
