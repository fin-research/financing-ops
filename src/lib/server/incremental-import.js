// @ts-nocheck
import { TYPED_IMPORT_TABLES } from '../excel-import.js';
import {
	IMPORT_DATASET_KEYS,
	IMPORT_DATASET_SPECS,
	importDatasetCounts,
	importRowKey,
	normaliseImportDatasets
} from '../incremental-import.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const FILTER_MAX_ROWS = 2500;
const FILTER_MAX_BYTES = 500_000;
const INSERT_CHUNK_MAX_BYTES = 1_500_000;
const MAX_BATCH_STATEMENTS = 47;

const DEBT_COLUMNS = [
	'external_key', 'debt_type', 'category_level_1', 'category_level_2', 'instrument_name',
	'instrument_code', 'borrower', 'counterparty', 'principal_amount', 'outstanding_amount',
	'currency', 'annual_rate', 'issue_date', 'maturity_date', 'status'
];

const TYPED_CONFIGS = new Map(TYPED_IMPORT_TABLES.map((config) => [config.key, config]));
const COUNT_TABLES = new Map([
	['debts', 'debts'],
	...TYPED_IMPORT_TABLES.map((config) => [config.key, config.table]),
	['cashflows', 'debt_cashflow_events'],
	['balances', 'debt_balance_daily'],
	['workbookNotes', 'workbook_notes']
]);

function jsonSize(value) {
	return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function nonNegativeInteger(value, label) {
	const result = Number(value);
	if (!Number.isInteger(result) || result < 0) throw new Error(`${label}必须是非负整数`);
	return result;
}

function validateMetadata(input) {
	const workbookName = String(input?.workbookName ?? '').trim();
	const workbookHash = String(input?.workbookHash ?? '').trim();
	const asOfDate = String(input?.asOfDate ?? '').trim();
	if (!workbookName.toLowerCase().endsWith('.xlsx')) throw new Error('仅支持 .xlsx 工作簿');
	if (!/^[a-f0-9]{64}$/.test(workbookHash)) throw new Error('工作簿哈希无效');
	if (!ISO_DATE.test(asOfDate)) throw new Error('工作簿基准日无效');
	const datasetCounts = {};
	for (const key of IMPORT_DATASET_KEYS) {
		datasetCounts[key] = nonNegativeInteger(input?.datasetCounts?.[key], `${key}记录数`);
	}
	const unknownCounts = Object.keys(input?.datasetCounts ?? {}).filter((key) => !IMPORT_DATASET_SPECS[key]);
	if (unknownCounts.length) throw new Error(`存在未知导入数据集计数：${unknownCounts.join('、')}`);
	const metadata = {
		workbookName,
		workbookHash,
		asOfDate,
		debtCount: nonNegativeInteger(input?.debtCount, '负债数量'),
		fieldValueCount: nonNegativeInteger(input?.fieldValueCount, '字段值数量'),
		cashflowCount: nonNegativeInteger(input?.cashflowCount, '现金流数量'),
		historyDateCount: nonNegativeInteger(input?.historyDateCount, '历史日期数量'),
		excludedFutureCount: nonNegativeInteger(input?.excludedFutureCount, '隔离日期数量'),
		datasetCounts
	};
	if (metadata.debtCount !== datasetCounts.debts) throw new Error('负债数量与类型化数据集不一致');
	if (metadata.cashflowCount !== datasetCounts.cashflows) throw new Error('现金流数量与类型化数据集不一致');
	if (datasetCounts.balances !== metadata.historyDateCount * 10) {
		throw new Error('日余额数量与历史日期数量不一致');
	}
	return metadata;
}

function currentStateSql() {
	const counts = IMPORT_DATASET_KEYS.map((key) =>
		`(SELECT COUNT(*) FROM ${COUNT_TABLES.get(key)}) AS count_${key}`
	).join(',\n\t\t\t');
	return `
		SELECT s.workbook_hash AS workbookHash, s.workbook_name AS workbookName,
			s.as_of_date AS asOfDate,
			(SELECT MAX(as_of_date) FROM debt_balance_daily) AS maxBalanceDate,
			${counts}
		FROM (SELECT 1) singleton LEFT JOIN data_import_state s ON s.id = 1
	`;
}

async function readCurrentState(db) {
	const row = await db.prepare(currentStateSql()).get();
	return {
		exists: row?.workbookHash != null,
		workbookHash: row?.workbookHash ?? null,
		workbookName: row?.workbookName ?? null,
		asOfDate: row?.asOfDate ?? null,
		maxBalanceDate: row?.maxBalanceDate ?? null,
		counts: Object.fromEntries(IMPORT_DATASET_KEYS.map((key) => [key, Number(row?.[`count_${key}`] ?? 0)]))
	};
}

function assertExpectedState(state, expectedWorkbookHash) {
	const expected = expectedWorkbookHash == null ? null : String(expectedWorkbookHash);
	if (state.workbookHash !== expected) {
		throw new Error('线上数据已被另一导入更新，请重新选择工作簿并预检');
	}
}

function assertNewerWorkbook(metadata, state) {
	const boundary = state.asOfDate ?? state.maxBalanceDate;
	if (boundary && metadata.asOfDate <= boundary) {
		throw new Error(`新工作簿基准日 ${metadata.asOfDate} 必须晚于线上基准日 ${boundary}`);
	}
}

export async function preflightIncrementalImport(db, input) {
	const metadata = validateMetadata(input);
	const state = await readCurrentState(db);
	if (state.workbookHash === metadata.workbookHash) {
		return {
			unchanged: true,
			expectedWorkbookHash: state.workbookHash,
			currentAsOfDate: state.asOfDate,
			maxBalanceDate: state.maxBalanceDate,
			currentCounts: state.counts
		};
	}
	assertNewerWorkbook(metadata, state);
	return {
		unchanged: false,
		expectedWorkbookHash: state.workbookHash,
		currentAsOfDate: state.asOfDate,
		maxBalanceDate: state.maxBalanceDate,
		currentCounts: state.counts
	};
}

function lookupDefinition(key) {
	if (key === 'debts') {
		return {
			from: `json_each(?) input JOIN debts t ON t.external_key = json_extract(input.value, '$[0]')`
		};
	}
	const typed = TYPED_CONFIGS.get(key);
	if (typed) {
		return {
			from: `json_each(?) input
					JOIN debts d ON d.external_key = json_extract(input.value, '$[0]')
					JOIN ${typed.table} t ON t.debt_id = d.id`
		};
	}
	if (key === 'cashflows') {
		return {
			from: `json_each(?) input
					JOIN debt_cashflow_events t ON t.event_key = json_extract(input.value, '$[0]')
					JOIN debts d ON d.id = t.debt_id`
		};
	}
	if (key === 'balances') {
		return {
			from: `json_each(?) input JOIN debt_balance_daily t
					ON t.as_of_date = json_extract(input.value, '$[0]')
					AND t.debt_type = json_extract(input.value, '$[1]')`
		};
	}
	if (key === 'workbookNotes') {
		return {
			from: `json_each(?) input JOIN workbook_notes t
					ON t.sheet_name = json_extract(input.value, '$[0]')`
		};
	}
	throw new Error(`未知导入数据类型：${key}`);
}

function validateFilterRows(key, rows) {
	if (!Array.isArray(rows) || rows.length === 0 || rows.length > FILTER_MAX_ROWS) {
		throw new Error('增量比对分片记录数无效');
	}
	rows.forEach((row) => importRowKey(key, row));
	if (jsonSize(rows) > FILTER_MAX_BYTES) throw new Error('增量比对分片超过 500KB');
}

export async function filterIncrementalRows(db, expectedWorkbookHash, key, rows) {
	validateFilterRows(key, rows);
	const state = await readCurrentState(db);
	assertExpectedState(state, expectedWorkbookHash);
	const definition = lookupDefinition(key);
	const existing = await db.prepare(`
		SELECT CAST(input.key AS INTEGER) AS inputIndex
		FROM ${definition.from}
	`).all(JSON.stringify(rows));
	const existingIndexes = new Set(existing.map((row) => Number(row.inputIndex)));
	return { newIndexes: rows.map((_, index) => index).filter((index) => !existingIndexes.has(index)) };
}

function jsonChunks(rows) {
	const chunks = [];
	let current = [];
	let bytes = 2;
	for (const row of rows) {
		const rowBytes = jsonSize(row) + (current.length ? 1 : 0);
		if (rowBytes + 2 > INSERT_CHUNK_MAX_BYTES) throw new Error('单条增量记录超过 D1 参数上限');
		if (current.length && bytes + rowBytes > INSERT_CHUNK_MAX_BYTES) {
			chunks.push(JSON.stringify(current));
			current = [];
			bytes = 2;
		}
		current.push(row);
		bytes += rowBytes;
	}
	if (current.length) chunks.push(JSON.stringify(current));
	return chunks;
}

function guardSql(state) {
	return state.exists
		? `EXISTS (SELECT 1 FROM data_import_state WHERE id = 1 AND workbook_hash = ?)`
		: `NOT EXISTS (SELECT 1 FROM data_import_state WHERE id = 1)`;
}

function bindGuarded(db, sql, payload, state) {
	const statement = db.prepare(sql);
	return state.exists ? statement.bind(payload, state.workbookHash) : statement.bind(payload);
}

function insertSql(key, state) {
	const guard = guardSql(state);
	if (key === 'debts') {
		const values = DEBT_COLUMNS.map((_, index) => `json_extract(input.value, '$[${index}]')`);
		return `
			INSERT INTO debts (id, ${DEBT_COLUMNS.join(', ')})
			SELECT json_extract(input.value, '$[0]'), ${values.join(', ')}
			FROM json_each(?) input WHERE ${guard}
		`;
	}
	const typed = TYPED_CONFIGS.get(key);
	if (typed) {
		const values = typed.columns.slice(1).map((_, index) => `json_extract(input.value, '$[${index + 1}]')`);
		return `
			INSERT INTO ${typed.table} (${typed.columns.join(', ')})
			SELECT d.id, ${values.join(', ')}
			FROM json_each(?) input JOIN debts d ON d.external_key = json_extract(input.value, '$[0]')
			WHERE ${guard}
		`;
	}
	if (key === 'cashflows') {
		return `
			INSERT INTO debt_cashflow_events (event_key, debt_id, event_type, event_date, amount, sequence)
			SELECT json_extract(input.value, '$[0]'), d.id,
				json_extract(input.value, '$[2]'), json_extract(input.value, '$[3]'),
				json_extract(input.value, '$[4]'), json_extract(input.value, '$[5]')
			FROM json_each(?) input JOIN debts d ON d.external_key = json_extract(input.value, '$[1]')
			WHERE ${guard}
		`;
	}
	if (key === 'balances') {
		return `
			INSERT INTO debt_balance_daily (as_of_date, debt_type, balance_yi)
			SELECT json_extract(input.value, '$[0]'), json_extract(input.value, '$[1]'),
				json_extract(input.value, '$[2]')
			FROM json_each(?) input WHERE ${guard}
		`;
	}
	if (key === 'workbookNotes') {
		return `
			INSERT INTO workbook_notes (sheet_name, content)
			SELECT json_extract(input.value, '$[0]'), json_extract(input.value, '$[1]')
			FROM json_each(?) input WHERE ${guard}
		`;
	}
	throw new Error(`未知导入数据类型：${key}`);
}

async function assertDebtReferencesExist(db, datasets) {
	const incomingDebtKeys = new Set(datasets.debts.map((row) => String(row[0])));
	const references = new Set();
	for (const key of [...TYPED_CONFIGS.keys(), 'cashflows']) {
		for (const row of datasets[key]) {
			const externalKey = String(key === 'cashflows' ? row[1] : row[0]);
			if (!incomingDebtKeys.has(externalKey)) references.add(externalKey);
		}
	}
	if (!references.size) return;
	const payload = JSON.stringify([...references]);
	if (new TextEncoder().encode(payload).byteLength > 1_900_000) {
		throw new Error('增量记录引用的负债键超过单次校验上限');
	}
	const missing = await db.prepare(`
		SELECT input.value AS externalKey FROM json_each(?) input
		LEFT JOIN debts d ON d.external_key = input.value
		WHERE d.id IS NULL LIMIT 1
	`).get(payload);
	if (missing) throw new Error(`增量记录找不到负债主表：${missing.externalKey}`);
}

function validateIncrementalPayload(metadata, state, datasets) {
	assertNewerWorkbook(metadata, state);
	const projectedBalances = state.counts.balances + datasets.balances.length;
	if (projectedBalances !== metadata.datasetCounts.balances) {
		throw new Error(`balances 增量不完整：线上 ${state.counts.balances} + 新增 ${datasets.balances.length} != 工作簿 ${metadata.datasetCounts.balances}`);
	}
	for (const row of datasets.balances) {
		const asOfDate = String(row[0] ?? '');
		if (!ISO_DATE.test(asOfDate) || (state.maxBalanceDate && asOfDate <= state.maxBalanceDate)) {
			throw new Error(`日余额 ${asOfDate || '空日期'} 不晚于线上最大日期 ${state.maxBalanceDate ?? '无'}`);
		}
		if (asOfDate > metadata.asOfDate) throw new Error(`日余额 ${asOfDate} 晚于工作簿基准日 ${metadata.asOfDate}`);
	}
}

function stateStatement(db, metadata, state, incrementalCounts) {
	const values = [
		metadata.workbookName, metadata.workbookHash, metadata.asOfDate,
		incrementalCounts.debts,
		state.counts.debts + incrementalCounts.debts,
		metadata.fieldValueCount,
		state.counts.cashflows + incrementalCounts.cashflows,
		metadata.historyDateCount,
		metadata.excludedFutureCount
	];
	if (state.exists) {
		return db.prepare(`
			UPDATE data_import_state SET
				workbook_name = ?, workbook_hash = ?, as_of_date = ?, status = 'completed',
				started_at = CURRENT_TIMESTAMP, finished_at = CURRENT_TIMESTAMP,
				inserted_count = ?, updated_count = 0, deleted_count = 0,
				debt_count = ?, field_value_count = ?, cashflow_count = ?,
				history_date_count = ?, excluded_future_count = ?, error_message = NULL
			WHERE id = 1 AND workbook_hash = ?
		`).bind(...values, state.workbookHash);
	}
	return db.prepare(`
		INSERT INTO data_import_state (
			id, workbook_name, workbook_hash, as_of_date, status, started_at, finished_at,
			inserted_count, updated_count, deleted_count, debt_count, field_value_count,
			cashflow_count, history_date_count, excluded_future_count, error_message
		)
		SELECT 1, ?, ?, ?, 'completed', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP,
			?, 0, 0, ?, ?, ?, ?, ?, NULL
		WHERE NOT EXISTS (SELECT 1 FROM data_import_state WHERE id = 1)
	`).bind(...values);
}

async function readSnapshot(db, asOfDate) {
	const snapshot = await db.prepare(`
		SELECT as_of_date AS asOfDate, SUM(balance_yi) AS totalYi, COUNT(*) AS debtTypeCount
		FROM debt_balance_daily WHERE as_of_date = ? GROUP BY as_of_date
	`).get(asOfDate);
	if (!snapshot || Number(snapshot.debtTypeCount) !== 10) {
		throw new Error(`${asOfDate} 日余额快照不完整`);
	}
	return { asOfDate: snapshot.asOfDate, totalYi: Number(snapshot.totalYi) };
}

export async function commitIncrementalImport(db, input) {
	const metadata = validateMetadata(input?.metadata);
	const datasets = normaliseImportDatasets(input?.datasets ?? {});
	const state = await readCurrentState(db);
	assertExpectedState(state, input?.expectedWorkbookHash ?? null);
	if (state.workbookHash === metadata.workbookHash) {
		return {
			unchanged: true,
			sourceFile: metadata.workbookName,
			inserted: 0,
			updated: 0,
			deleted: 0,
			insertedRows: 0,
			newHistoryDateCount: 0,
			snapshot: await readSnapshot(db, metadata.asOfDate),
			queryCount: 2,
			rowsWritten: 0
		};
	}
	validateIncrementalPayload(metadata, state, datasets);
	await assertDebtReferencesExist(db, datasets);

	const statements = [];
	const counts = importDatasetCounts(datasets);
	for (const key of IMPORT_DATASET_KEYS) {
		for (const payload of jsonChunks(datasets[key])) {
			statements.push(bindGuarded(db, insertSql(key, state), payload, state));
		}
	}
	statements.push(stateStatement(db, metadata, state, counts));
	if (statements.length > MAX_BATCH_STATEMENTS) {
		throw new Error(`增量提交需要 ${statements.length} 条 D1 查询，超过单次安全上限 ${MAX_BATCH_STATEMENTS}`);
	}
	const results = await db.batch(statements);
	const stateResult = results.at(-1);
	if (Number(stateResult?.meta?.changes ?? 0) !== 1) {
		throw new Error('线上数据已在提交前发生变化，本次增量未写入');
	}
	const snapshot = await readSnapshot(db, metadata.asOfDate);
	const insertedRows = Object.values(counts).reduce((sum, value) => sum + value, 0);
	const newHistoryDateCount = new Set(datasets.balances.map((row) => row[0])).size;
	return {
		unchanged: false,
		sourceFile: metadata.workbookName,
		inserted: datasets.debts.length,
		updated: 0,
		deleted: 0,
		insertedRows,
		incrementalCounts: counts,
		newHistoryDateCount,
		fieldValueCount: metadata.fieldValueCount,
		cashflowEventCount: state.counts.cashflows + counts.cashflows,
		historyDateCount: metadata.historyDateCount,
		snapshot,
		queryCount: statements.length + 3,
		rowsWritten: results.reduce((sum, result) => sum + Number(result?.meta?.rows_written ?? 0), 0)
	};
}

export { readCurrentState as getIncrementalImportState, validateMetadata as validateIncrementalImportMetadata };
