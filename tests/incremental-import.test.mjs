import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import {
	IMPORT_DATASET_KEYS,
	normaliseImportDatasets
} from '../src/lib/incremental-import.js';
import {
	commitIncrementalImport,
	filterIncrementalRows,
	preflightIncrementalImport
} from '../src/lib/server/incremental-import.js';
import {
	getCachedImportAsOfDate,
	getCachedImportStatistics,
	recalculateImportStatistics
} from '../src/lib/server/import-statistics.js';
import { createSchema } from '../src/lib/server/schema.js';
import { createSqliteD1Adapter } from '../src/lib/server/sqlite-d1.js';

const DEBT_TYPES = ['收益凭证', '收益权转让', '同业拆借', '次级债', '集团借款', '转融资', '短期融资券', '私募债', '小公募', '互换便利'];

function emptyDatasets() {
	return Object.fromEntries(IMPORT_DATASET_KEYS.map((key) => [key, []]));
}

function metadata({ hash, date, historyDateCount, debtCount = 0, snapshotTotalYi = 45 }) {
	const datasetCounts = Object.fromEntries(IMPORT_DATASET_KEYS.map((key) => [key, 0]));
	datasetCounts.balances = historyDateCount * DEBT_TYPES.length;
	datasetCounts.debts = debtCount;
	return {
		workbookName: `借入资金${date.replaceAll('-', '')}.xlsx`,
		workbookHash: hash,
		asOfDate: date,
		snapshotTotalYi,
		historyStartDate: '2026-07-31',
		historyEndDate: date,
		debtCount,
		fieldValueCount: 0,
		cashflowCount: 0,
		historyDateCount,
		excludedFutureCount: 0,
		datasetCounts
	};
}

function balances(date, offset = 0) {
	return DEBT_TYPES.map((debtType, index) => [date, debtType, index + offset]);
}

test('balance normalization keeps the last source column without using database replace', () => {
	const datasets = emptyDatasets();
	datasets.balances = [
		['2026-07-31', '收益凭证', 1],
		['2026-07-31', '收益凭证', 2]
	];
	assert.deepEqual(normaliseImportDatasets(datasets).balances, [['2026-07-31', '收益凭证', 2]]);

	const duplicateDebts = emptyDatasets();
	duplicateDebts.debts = [
		['key', '收益凭证', null, null, null, null, null, null, 1, 1, 'CNY', null, null, null, 'active'],
		['key', '收益凭证', null, null, null, null, null, null, 2, 2, 'CNY', null, null, null, 'active']
	];
	assert.throws(() => normaliseImportDatasets(duplicateDebts), /内容不一致/);
});

test('incremental import writes only later dates and identical workbook is a zero-write no-op', async (t) => {
	const sqlite = new Database(':memory:');
	t.after(() => sqlite.close());
	createSchema(sqlite);
	const db = createSqliteD1Adapter(sqlite);

	const firstMetadata = metadata({ hash: '1'.repeat(64), date: '2026-07-31', historyDateCount: 1, debtCount: 1 });
	const firstDatasets = emptyDatasets();
	firstDatasets.debts = [
		['stable-key', '收益凭证', null, null, '历史记录', null, null, null, 1, 1, 'CNY', null, null, null, 'active']
	];
	firstDatasets.balances = balances('2026-07-31');
	const first = await commitIncrementalImport(db, {
		expectedWorkbookHash: null,
		metadata: firstMetadata,
		datasets: firstDatasets
	});
	assert.equal(first.insertedRows, 11);
	assert.equal(first.rowsWritten, 12);
	const firstStatistics = await getCachedImportStatistics(db);
	assert.equal(firstStatistics.debtCount, 1);
	assert.equal(firstStatistics.totalYi, 45);
	assert.equal(firstStatistics.historyStartDate, '2026-07-31');
	assert.equal(firstStatistics.historyEndDate, '2026-07-31');
	assert.equal(firstStatistics.statsReady, true);

	const repeated = await preflightIncrementalImport(db, firstMetadata);
	assert.equal(repeated.unchanged, true);

	const historical = await filterIncrementalRows(
		db,
		repeated.expectedWorkbookHash,
		'balances',
		[['2026-07-31', '收益凭证', 999]]
	);
	assert.deepEqual(historical.newIndexes, []);
	const changedHistoricalDebt = await filterIncrementalRows(
		db,
		repeated.expectedWorkbookHash,
		'debts',
		[['stable-key', '收益凭证', null, null, '后续文件中的变动值', null, null, null, 999, 999, 'CNY', null, null, null, 'active']]
	);
	assert.deepEqual(changedHistoricalDebt.newIndexes, []);
	await assert.rejects(
		preflightIncrementalImport(db, metadata({ hash: '3'.repeat(64), date: '2026-07-31', historyDateCount: 1, debtCount: 1 })),
		/必须晚于线上基准日/
	);

	const secondMetadata = metadata({
		hash: '2'.repeat(64), date: '2026-08-01', historyDateCount: 2, debtCount: 1, snapshotTotalYi: 145
	});
	const preflight = await preflightIncrementalImport(db, secondMetadata);
	const secondDatasets = emptyDatasets();
	secondDatasets.balances = balances('2026-08-01', 10);
	const second = await commitIncrementalImport(db, {
		expectedWorkbookHash: preflight.expectedWorkbookHash,
		metadata: secondMetadata,
		datasets: secondDatasets
	});
	assert.equal(second.insertedRows, 10);
	assert.equal(second.newHistoryDateCount, 1);
	assert.equal(second.updated, 0);
	assert.equal(second.deleted, 0);
	assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM debt_balance_daily').get().count, 20);
	assert.equal((await preflightIncrementalImport(db, secondMetadata)).unchanged, true);
	assert.equal(await getCachedImportAsOfDate(db), '2026-08-01');

	sqlite.prepare(`
		UPDATE data_import_state SET debt_count = 0, cashflow_count = 99,
			history_date_count = 0, snapshot_total_yi = NULL,
			history_start_date = NULL, history_end_date = NULL
	`).run();
	const recalculated = await recalculateImportStatistics(db);
	assert.deepEqual(recalculated, {
		debtCount: 1,
		cashflowEventCount: 0,
		historyDateCount: 2,
		historyStartDate: '2026-07-31',
		historyEndDate: '2026-08-01',
		totalYi: 145
	});
	assert.equal((await getCachedImportStatistics(db)).statsReady, true);
});
