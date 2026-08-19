// @ts-nocheck
import { TYPED_IMPORT_TABLES } from '../excel-import.js';

const DEBT_COLUMNS = [
	'external_key', 'debt_type', 'category_level_1', 'category_level_2', 'instrument_name',
	'instrument_code', 'borrower', 'counterparty', 'principal_amount', 'outstanding_amount',
	'currency', 'annual_rate', 'issue_date', 'maturity_date', 'status'
];

const STAGING_CONFIGS = new Map([
	['debts', { table: 'debt_import_staging', columns: DEBT_COLUMNS }],
	...TYPED_IMPORT_TABLES.map((config) => [config.key, {
		table: config.stagingTable,
		columns: ['external_key', ...config.columns.slice(1)]
	}]),
	['cashflows', {
		table: 'cashflow_staging',
		columns: ['event_key', 'external_key', 'event_type', 'event_date', 'amount', 'sequence']
	}],
	['balances', { table: 'balance_staging', columns: ['as_of_date', 'debt_type', 'balance_yi'] }],
	['workbookNotes', { table: 'workbook_notes_staging', columns: ['sheet_name', 'content'] }]
]);

const STAGING_TABLES = [
	'debt_import_staging',
	...TYPED_IMPORT_TABLES.map((config) => config.stagingTable),
	'cashflow_staging', 'balance_staging', 'workbook_notes_staging'
];

const LIVE_DELETE_TABLES = [
	'bond_payment_schedules', 'income_right_payment_schedules', 'group_loan_schedules',
	'bond_debt_details', 'income_certificate_details', 'income_right_details',
	'interbank_borrowing_details', 'refinancing_details', 'group_loan_details',
	'swap_facility_details', 'debt_cashflow_events', 'debt_balance_daily', 'workbook_notes'
];

function nonNegativeInteger(value, label) {
	const result = Number(value);
	if (!Number.isInteger(result) || result < 0) throw new Error(`${label}必须是非负整数`);
	return result;
}

async function currentUpload(db, token) {
	const state = await db.prepare(`
		SELECT upload_token AS uploadToken, workbook_name AS workbookName,
			workbook_hash AS workbookHash, as_of_date AS asOfDate,
			debt_count AS debtCount, field_value_count AS fieldValueCount,
			cashflow_count AS cashflowCount, history_date_count AS historyDateCount,
			excluded_future_count AS excludedFutureCount
		FROM debt_import_upload WHERE id = 1 AND upload_token = ?
	`).get(token);
	if (!state) throw new Error('导入会话不存在或已过期，请重新选择工作簿');
	return state;
}

export async function beginStagedImport(db, metadata) {
	const workbookName = String(metadata.workbookName ?? '').trim();
	const workbookHash = String(metadata.workbookHash ?? '').trim();
	const asOfDate = String(metadata.asOfDate ?? '').trim();
	if (!workbookName.toLowerCase().endsWith('.xlsx')) throw new Error('仅支持 .xlsx 工作簿');
	if (!/^[a-f0-9]{64}$/.test(workbookHash)) throw new Error('工作簿哈希无效');
	if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) throw new Error('工作簿基准日无效');
	const values = {
		debtCount: nonNegativeInteger(metadata.debtCount, '负债数量'),
		fieldValueCount: nonNegativeInteger(metadata.fieldValueCount, '字段值数量'),
		cashflowCount: nonNegativeInteger(metadata.cashflowCount, '现金流数量'),
		historyDateCount: nonNegativeInteger(metadata.historyDateCount, '历史日期数量'),
		excludedFutureCount: nonNegativeInteger(metadata.excludedFutureCount, '隔离日期数量')
	};
	const token = globalThis.crypto.randomUUID();
	await db.batch([
		...STAGING_TABLES.map((table) => db.prepare(`DELETE FROM ${table}`).bind()),
		db.prepare('DELETE FROM debt_import_upload').bind(),
		db.prepare(`
			INSERT INTO debt_import_upload (
				id, upload_token, workbook_name, workbook_hash, as_of_date,
				debt_count, field_value_count, cashflow_count, history_date_count, excluded_future_count
			) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`).bind(token, workbookName, workbookHash, asOfDate, values.debtCount,
			values.fieldValueCount, values.cashflowCount, values.historyDateCount, values.excludedFutureCount)
	]);
	return { token };
}

export async function stageImportRows(db, token, key, rows) {
	await currentUpload(db, token);
	const config = STAGING_CONFIGS.get(key);
	if (!config) throw new Error(`未知导入数据类型：${key}`);
	if (!Array.isArray(rows) || rows.length === 0 || rows.length > 3000) throw new Error('导入分片记录数无效');
	for (const row of rows) {
		if (!Array.isArray(row) || row.length !== config.columns.length) {
			throw new Error(`${key} 分片字段数量不一致`);
		}
	}
	const payload = JSON.stringify(rows);
	if (new TextEncoder().encode(payload).byteLength > 500_000) throw new Error('导入分片超过 500KB');
	const select = config.columns.map((_, index) => `json_extract(value, '$[${index}]')`).join(', ');
	await db.prepare(`
		INSERT OR REPLACE INTO ${config.table} (${config.columns.join(', ')})
		SELECT ${select} FROM json_each(?)
	`).run(payload);
	return { accepted: rows.length };
}

function insertTypedFromStaging(db, config) {
	const selected = config.columns.slice(1).map((column) => `s.${column}`).join(', ');
	return db.prepare(`
		INSERT INTO ${config.table} (${config.columns.join(', ')})
		SELECT d.id, ${selected}
		FROM ${config.stagingTable} s JOIN debts d ON d.external_key = s.external_key
	`).bind();
}

export async function finalizeStagedImport(db, token) {
	const state = await currentUpload(db, token);
	const counts = await db.prepare(`
		SELECT
			(SELECT COUNT(*) FROM debt_import_staging) AS debtCount,
			(SELECT COUNT(*) FROM cashflow_staging) AS cashflowCount,
			(SELECT COUNT(DISTINCT as_of_date) FROM balance_staging) AS historyDateCount,
			(SELECT COUNT(*) FROM debt_import_staging s LEFT JOIN debts d ON d.external_key = s.external_key WHERE d.id IS NULL) AS insertedCount,
			(SELECT COUNT(*) FROM debt_import_staging s JOIN debts d ON d.external_key = s.external_key) AS updatedCount,
			(SELECT COUNT(*) FROM debts d LEFT JOIN debt_import_staging s ON s.external_key = d.external_key WHERE s.external_key IS NULL) AS deletedCount
	`).get();
	if (Number(counts.debtCount) !== Number(state.debtCount)) throw new Error('暂存负债数量与工作簿解析结果不一致');
	if (Number(counts.cashflowCount) !== Number(state.cashflowCount)) throw new Error('暂存现金流数量与工作簿解析结果不一致');
	if (Number(counts.historyDateCount) !== Number(state.historyDateCount)) throw new Error('暂存历史日期数量与工作簿解析结果不一致');

	const statements = [
		...LIVE_DELETE_TABLES.map((table) => db.prepare(`DELETE FROM ${table}`).bind()),
		db.prepare(`
			INSERT INTO debts (
				id, external_key, debt_type, category_level_1, category_level_2,
				instrument_name, instrument_code, borrower, counterparty, principal_amount,
				outstanding_amount, currency, annual_rate, issue_date, maturity_date, status
			)
			SELECT COALESCE(d.id, s.external_key), s.external_key, s.debt_type,
				s.category_level_1, s.category_level_2, s.instrument_name, s.instrument_code,
				s.borrower, s.counterparty, s.principal_amount, s.outstanding_amount,
				s.currency, s.annual_rate, s.issue_date, s.maturity_date, s.status
			FROM debt_import_staging s LEFT JOIN debts d ON d.external_key = s.external_key
			WHERE 1
			ON CONFLICT(external_key) DO UPDATE SET
				debt_type = excluded.debt_type, category_level_1 = excluded.category_level_1,
				category_level_2 = excluded.category_level_2, instrument_name = excluded.instrument_name,
				instrument_code = excluded.instrument_code, borrower = excluded.borrower,
				counterparty = excluded.counterparty, principal_amount = excluded.principal_amount,
				outstanding_amount = excluded.outstanding_amount, currency = excluded.currency,
				annual_rate = excluded.annual_rate, issue_date = excluded.issue_date,
				maturity_date = excluded.maturity_date, status = excluded.status,
				imported_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
		`).bind(),
		...TYPED_IMPORT_TABLES.map((config) => insertTypedFromStaging(db, config)),
		db.prepare(`
			INSERT INTO debt_cashflow_events (event_key, debt_id, event_type, event_date, amount, sequence)
			SELECT s.event_key, d.id, s.event_type, s.event_date, s.amount, s.sequence
			FROM cashflow_staging s JOIN debts d ON d.external_key = s.external_key
		`).bind(),
		db.prepare(`
			INSERT INTO debt_balance_daily (as_of_date, debt_type, balance_yi)
			SELECT as_of_date, debt_type, balance_yi FROM balance_staging
		`).bind(),
		db.prepare(`
			INSERT INTO workbook_notes (sheet_name, content)
			SELECT sheet_name, content FROM workbook_notes_staging
		`).bind(),
		db.prepare(`DELETE FROM debts WHERE external_key NOT IN (SELECT external_key FROM debt_import_staging)`).bind(),
		db.prepare(`
			INSERT INTO data_import_state (
				id, workbook_name, workbook_hash, as_of_date, status, started_at, finished_at,
				inserted_count, updated_count, deleted_count, debt_count, field_value_count,
				cashflow_count, history_date_count, excluded_future_count, error_message
			) VALUES (1, ?, ?, ?, 'completed', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
			ON CONFLICT(id) DO UPDATE SET
				workbook_name = excluded.workbook_name, workbook_hash = excluded.workbook_hash,
				as_of_date = excluded.as_of_date, status = 'completed', started_at = excluded.started_at,
				finished_at = excluded.finished_at, inserted_count = excluded.inserted_count,
				updated_count = excluded.updated_count, deleted_count = excluded.deleted_count,
				debt_count = excluded.debt_count, field_value_count = excluded.field_value_count,
				cashflow_count = excluded.cashflow_count, history_date_count = excluded.history_date_count,
				excluded_future_count = excluded.excluded_future_count, error_message = NULL
		`).bind(state.workbookName, state.workbookHash, state.asOfDate,
			counts.insertedCount, counts.updatedCount, counts.deletedCount, state.debtCount,
			state.fieldValueCount, state.cashflowCount, state.historyDateCount, state.excludedFutureCount),
		...STAGING_TABLES.map((table) => db.prepare(`DELETE FROM ${table}`).bind()),
		db.prepare('DELETE FROM debt_import_upload').bind()
	];
	if (statements.length > 48) throw new Error(`最终切换需要 ${statements.length} 条 D1 查询，超过安全上限`);
	await db.batch(statements);
	const snapshot = await db.prepare(`
		SELECT as_of_date AS asOfDate, SUM(balance_yi) AS totalYi
		FROM debt_balance_daily WHERE as_of_date = ? GROUP BY as_of_date
	`).get(state.asOfDate);
	return {
		sourceFile: state.workbookName,
		inserted: Number(counts.insertedCount),
		updated: Number(counts.updatedCount),
		deleted: Number(counts.deletedCount),
		fieldValueCount: Number(state.fieldValueCount),
		cashflowEventCount: Number(state.cashflowCount),
		historyDateCount: Number(state.historyDateCount),
		snapshot: { asOfDate: snapshot.asOfDate, totalYi: Number(snapshot.totalYi) },
		queryCount: statements.length + 3
	};
}
