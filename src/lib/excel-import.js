// @ts-nocheck
import * as XLSX from 'xlsx/xlsx.mjs';
import { stableDebtKey } from './debt-key.js';
import { DEBT_FIELD_COLUMNS } from './debt-fields.js';
import { sha256Hex } from './hash.js';
import {
	buildTypedDebtData,
	clearTypedDebtTables,
	typedDebtStatements
} from './debt-details.js';

const SUMMARY_SHEET_NAMES = new Set(['借入资金汇总表']);
const SUMMARY_SHEET_NAME = '借入资金汇总表';
const SNAPSHOT_DEBT_TYPES = ['收益凭证', '收益权转让', '同业拆借', '次级债', '集团借款', '转融资', '短期融资券', '私募债', '小公募', '互换便利'];
const FIELD_ALIASES = {
	instrumentName: ['债券简称', '债券名称', '证券简称', '借入资金名称', '品种名称', '债务名称', '项目名称', '名称'],
	instrumentCode: ['债券代码', '证券代码', '合同编码', '代码', '合同编号', '编号'],
	debtType: ['债券类型', '债券种类', '负债品种', '债务品种', '融资品种', '品种', '类别', '类型'],
	borrower: ['发行人', '借款人', '融资主体', '借入单位', '主体', '公司名称'],
	counterparty: ['债权人', '资金出借方', '资金方', '对手方', '交易对手', '认购方', '借款对象', '投资者', '出借人', '拆出方'],
	principalAmount: ['发行金额', '借入金额', '融资金额', '借款金额', '发行规模', '本金', '金额', '规模'],
	outstandingAmount: ['余额', '未偿余额', '剩余本金', '待偿金额'],
	currency: ['币种', '货币'],
	annualRate: ['票面利率', '发行利率', '融资利率', '年利率', '互换利率', '收益率', '利率', '成本'],
	issueDate: ['发行日期', '起息日', '借入日期', '开始日期', '互换开始日', '拆入时间', '到账日期', '交易日期'],
	maturityDate: ['到期日', '兑付日', '截止日期', '结束日期', '互换到期日'],
	status: ['状态', '存续状态'],
	returnType: ['收益类型']
};

function normaliseHeader(value) {
	return String(value ?? '').replace(/[\s\r\n（）()【】\[\]：:，,\-—_]/g, '').toLowerCase();
}

function text(value) {
	if (value === null || value === undefined) return null;
	const result = String(value).trim();
	return result === '' || result === '-' || result === '—' ? null : result;
}

function findHeaderRow(rows) {
	let best = { index: -1, score: 0, fields: {} };
	for (let index = 0; index < Math.min(rows.length, 20); index += 1) {
		const fields = {};
		for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
			const column = rows[index].findIndex((value) => {
				const header = normaliseHeader(value);
				return header && aliases.some((alias) => header.includes(normaliseHeader(alias)));
			});
			if (column >= 0) fields[field] = column;
		}
		const score = Object.keys(fields).length;
		if (score > best.score) best = { index, score, fields };
	}
	return best.score >= 2 ? best : null;
}

function dateValue(value) {
	const candidate = text(value);
	if (!candidate) return null;
	const yearFirstMatch = candidate.match(/^(\d{4})[./年-](\d{1,2})[./月-](\d{1,2})/);
	const monthFirstMatch = candidate.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
	if (!yearFirstMatch && !monthFirstMatch) return null;
	const [, first, second, third] = yearFirstMatch ?? monthFirstMatch;
	const [year, month, day] = yearFirstMatch
		? [first, second, third]
		: [third.length === 2 ? String(2000 + Number(third)) : third, first, second];
	const result = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
	return Number.isNaN(Date.parse(`${result}T00:00:00Z`)) ? null : result;
}

function numericValue(value) {
	if (typeof value === 'number') return Number.isFinite(value) ? value : null;
	const candidate = text(value);
	if (!candidate) return null;
	const number = Number(candidate.replace(/[,，\s]/g, '').replace(/[%％]/g, ''));
	return Number.isFinite(number) ? number : null;
}

function amountValue(value, header) {
	const amount = numericValue(value);
	if (amount === null) return null;
	const normalised = normaliseHeader(header);
	if (normalised.includes('亿元') || normalised.includes('亿')) return amount * 100_000_000;
	if (normalised.includes('万元') || normalised.includes('万')) return amount * 10_000;
	return amount;
}

function rateValue(value) {
	const rate = numericValue(value);
	if (rate === null) return null;
	return /[%％]/.test(String(value)) || rate > 1 ? rate / 100 : rate;
}

function dateFromExcelCell(cell) {
	if (!cell) return null;
	if (typeof cell.v === 'number') {
		const parsed = XLSX.SSF.parse_date_code(cell.v);
		if (parsed) return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
	}
	return dateValue(cell.w ?? cell.v);
}

function dateFromFilename(sourceFile) {
	const match = sourceFile.match(/(20\d{2})(\d{2})(\d{2})/);
	return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

function cellValue(sheet, row, column) {
	return sheet[XLSX.utils.encode_cell({ r: row, c: column })];
}

function parseSummaryHistory(workbook, sourceFile) {
	const sheet = workbook.Sheets[SUMMARY_SHEET_NAME];
	if (!sheet) return { snapshots: [], latest: null, excludedFutureDates: [] };
	const sourceDate = dateFromFilename(sourceFile);
	const usedRange = XLSX.utils.decode_range(sheet['!ref'] ?? 'A1');
	const dateColumns = [];
	for (let column = 0; column <= usedRange.e.c; column += 1) {
		const asOfDate = dateFromExcelCell(cellValue(sheet, 2, column));
		if (asOfDate) dateColumns.push({ column, asOfDate });
	}
	const includedColumns = sourceDate
		? dateColumns.filter((candidate) => candidate.asOfDate <= sourceDate)
		: dateColumns;
	const excludedFutureDates = sourceDate
		? dateColumns.filter((candidate) => candidate.asOfDate > sourceDate).map((candidate) => candidate.asOfDate)
		: [];
	const snapshots = includedColumns.map((target) => {
		const balances = SNAPSHOT_DEBT_TYPES.map((debtType, index) => {
			const row = index + 3;
			const sourceCell = XLSX.utils.encode_cell({ r: row, c: target.column });
			const cell = cellValue(sheet, row, target.column);
			const balanceYi = numericValue(cell?.v);
			if (balanceYi === null) throw new Error(`汇总表 ${sourceCell} 缺少 ${debtType} 余额`);
			return { debtType, balanceYi, sourceCell };
		});
		const totalCell = XLSX.utils.encode_cell({ r: 13, c: target.column });
		const totalYi = numericValue(cellValue(sheet, 13, target.column)?.v);
		if (totalYi === null) throw new Error(`汇总表 ${totalCell} 缺少合计余额`);
		const calculatedTotalYi = balances.reduce((sum, item) => sum + item.balanceYi, 0);
		if (Math.abs(calculatedTotalYi - totalYi) > 1e-8) {
			throw new Error(`汇总表 ${totalCell} 合计不一致：明细 ${calculatedTotalYi}，单元格 ${totalYi}`);
		}
		return {
			asOfDate: target.asOfDate,
			balances,
			totalYi,
			sourceSheet: SUMMARY_SHEET_NAME,
			totalCell,
			sourceSequence: target.column
		};
	});
	const latest = sourceDate
		? snapshots.find((snapshot) => snapshot.asOfDate === sourceDate)
		: snapshots.at(-1);
	if (!latest) {
		throw new Error(sourceDate
			? `汇总表缺少来源文件基准日 ${sourceDate}`
			: '汇总表未找到可导入日期');
	}
	return { snapshots, latest, excludedFutureDates };
}

function replaceSummarySnapshots(db, snapshots) {
	const upsert = db.prepare(`
		INSERT INTO debt_balance_daily (as_of_date, debt_type, balance_yi)
		VALUES (@asOfDate, @debtType, @balanceYi)
		ON CONFLICT(as_of_date, debt_type) DO UPDATE SET
			balance_yi = excluded.balance_yi,
			updated_at = CURRENT_TIMESTAMP
	`);
	db.prepare('DELETE FROM debt_balance_daily').run();
	for (const snapshot of snapshots) {
		for (const balance of snapshot.balances) {
			upsert.run({
				asOfDate: snapshot.asOfDate,
				...balance
			});
		}
	}
}

export function assertDebtBalanceSnapshot(snapshot) {
	if (!snapshot) throw new Error('未找到可核对的负债余额快照');
	const expected20260727 = {
		'收益凭证': 244.2206, '收益权转让': 0, '同业拆借': 32, '次级债': 54, '集团借款': 12,
		'转融资': 58.5, '短期融资券': 313, '私募债': 0, '小公募': 447, '互换便利': 20
	};
	if (snapshot.asOfDate === '2026-07-27') {
		if (Math.abs(snapshot.totalYi - 1180.7206) > 1e-8) throw new Error(`2026-07-27 总余额核对失败：${snapshot.totalYi}`);
		for (const balance of snapshot.balances) {
			if (Math.abs(balance.balanceYi - expected20260727[balance.debtType]) > 1e-8) {
				throw new Error(`2026-07-27 ${balance.debtType} 核对失败：${balance.balanceYi}`);
			}
		}
	}
	return { asOfDate: snapshot.asOfDate, totalYi: snapshot.totalYi, balances: snapshot.balances };
}

function assertPersistedDebtBalanceSnapshot(db, snapshot) {
	const balances = db.prepare(`
		SELECT debt_type AS debtType, balance_yi AS balanceYi
		FROM debt_balance_daily WHERE as_of_date = ? ORDER BY debt_type
	`).all(snapshot.asOfDate);
	if (balances.length !== SNAPSHOT_DEBT_TYPES.length) {
		throw new Error(`${snapshot.asOfDate} 快照持久化记录数错误：${balances.length}`);
	}
	return assertDebtBalanceSnapshot({
		asOfDate: snapshot.asOfDate,
		totalYi: balances.reduce((sum, item) => sum + Number(item.balanceYi), 0),
		balances
	});
}

function mapStatus(value, maturityDate) {
	const candidate = text(value)?.toLowerCase() ?? '';
	if (/未到期|存续/.test(candidate)) return 'active';
	if (/发行失败|作废|取消/.test(candidate)) return 'closed';
	if (/已到期|已兑付|兑付完毕/.test(candidate)) return 'matured';
	if (/计划|拟/.test(candidate)) return 'planned';
	if (/结束|注销|终止|偿还/.test(candidate)) return 'closed';
	if (maturityDate && maturityDate < new Date().toISOString().slice(0, 10)) return 'matured';
	return 'active';
}

function debtCategories(sheetName, row, fields) {
	if (sheetName === '收益凭证') {
		const returnType = String(valueAt(row, fields, 'returnType') ?? '');
		return {
			categoryLevel1: '收益凭证',
			categoryLevel2: returnType.includes('浮动') ? '浮动收益凭证' : '固定收益凭证'
		};
	}
	if (['小公募', '次级债', '私募债', '科创债', '短期融资券', '公司债'].includes(sheetName)) {
		return { categoryLevel1: '债券', categoryLevel2: sheetName };
	}
	return { categoryLevel1: sheetName, categoryLevel2: null };
}

function valueAt(row, fields, field) {
	const index = fields[field];
	return index === undefined ? null : row[index];
}

function isUsableRow(row, fields) {
	const values = Object.values(fields).map((index) => text(row[index])).filter(Boolean);
	if (values.length === 0) return false;
	return !values.every((value) => /^(合计|总计|小计|备注|说明)$/u.test(value));
}

function isMeaningfulRow(row) {
	return row.some((value) => text(value) !== null);
}

function meaningfulSheetBounds(sheet) {
	let maxRow = -1;
	let maxColumn = -1;
	for (const [address, cell] of Object.entries(sheet)) {
		if (address.startsWith('!') || text(cell?.v) === null) continue;
		const position = XLSX.utils.decode_cell(address);
		maxRow = Math.max(maxRow, position.r);
		maxColumn = Math.max(maxColumn, position.c);
	}
	return { maxRow, maxColumn };
}

const DATE_FIELD_HEADERS = [
	'日期', '认购日', '簿记日', '发行日', '起息日', '到期日', '兑付日',
	'还息日', '偿还日', '付息时间', '计息期间', '拆入时间', '开始日', '结束日'
];

function fieldValuesForRow(sheet, sourceRow, headers, maxColumn) {
	const cells = [];
	for (let column = 0; column <= maxColumn; column += 1) {
		const address = XLSX.utils.encode_cell({ r: sourceRow - 1, c: column });
		const cell = sheet[address];
		if (!cell || text(cell.v) === null) continue;
		const fieldName = text(headers[column]) ?? `未命名字段 ${column + 1}`;
		const isDateField = DATE_FIELD_HEADERS.some((candidate) =>
			normaliseHeader(fieldName).includes(normaliseHeader(candidate))
		);
		cells.push({
			fieldOrder: column,
			fieldName,
			displayValue: String(cell.w ?? cell.v),
			numericValue: typeof cell.v === 'number' && Number.isFinite(cell.v) ? cell.v : null,
			dateValue: isDateField ? dateFromExcelCell(cell) : null
		});
	}
	return cells;
}

function stableId(value) {
	return sha256Hex(value);
}

const CASHFLOW_DATE_HEADERS = ['还息日', '偿还日', '付息时间', '还息计划', '计息期间', '到期日'];
const INTEREST_AMOUNT_HEADERS = ['应付利息', '偿还利息'];
const PRINCIPAL_AMOUNT_HEADERS = ['偿还本金'];

function cashflowEventsForRow({
	row,
	headers,
	sheetName,
	debtId,
	externalKey,
	sequenceForEvent
}) {
	const dateColumns = headers
		.map((header, column) => ({ column, header: normaliseHeader(header), date: dateValue(row[column]) }))
		.filter((item) =>
			item.date
			&& CASHFLOW_DATE_HEADERS.some((candidate) => item.header.includes(normaliseHeader(candidate)))
		);
	const amountColumns = headers
		.map((header, column) => ({ column, header: normaliseHeader(header) }))
		.filter((item) => {
			if (
				sheetName === '收益权转让'
				&& INTEREST_AMOUNT_HEADERS.some((candidate) => item.header.includes(normaliseHeader(candidate)))
			) return false;
			return [...INTEREST_AMOUNT_HEADERS, ...PRINCIPAL_AMOUNT_HEADERS]
				.some((candidate) => item.header.includes(normaliseHeader(candidate)));
		});

	if (sheetName === '收益权转让') {
		for (const dateColumn of dateColumns.filter((item) => item.header.includes('还息计划'))) {
			amountColumns.push({ column: dateColumn.column + 1, header: normaliseHeader('应付利息') });
		}
	}

	const events = [];
	for (const amountColumn of amountColumns) {
		const amount = amountValue(row[amountColumn.column], headers[amountColumn.column]);
		if (amount === null || amount === 0 || !dateColumns.length) continue;
		const dateColumn = [...dateColumns].sort(
			(left, right) =>
				Math.abs(left.column - amountColumn.column) - Math.abs(right.column - amountColumn.column)
		)[0];
		const eventType = PRINCIPAL_AMOUNT_HEADERS.some((candidate) =>
			amountColumn.header.includes(normaliseHeader(candidate))
		) ? 'principal' : 'interest';
		const sequence = sequenceForEvent(eventType, dateColumn.date, amount);
		const eventKey = stableId([externalKey, eventType, dateColumn.date, amount, sequence].join(':'));
		events.push({
			eventKey,
			debtId,
			eventType,
			eventDate: dateColumn.date,
			amount,
			sequence
		});
	}
	return events;
}

function rowToDebt(row, fields, sheetName, headers) {
	const instrumentName = text(valueAt(row, fields, 'instrumentName'));
	const instrumentCode = text(valueAt(row, fields, 'instrumentCode'));
	const principalAmount = amountValue(valueAt(row, fields, 'principalAmount'), headers[fields.principalAmount]);
	const outstandingAmount = amountValue(valueAt(row, fields, 'outstandingAmount'), headers[fields.outstandingAmount]);
	const maturityDate = dateValue(valueAt(row, fields, 'maturityDate'));
	return {
		id: globalThis.crypto.randomUUID(),
		debtType: sheetName,
		...debtCategories(sheetName, row, fields),
		instrumentName,
		instrumentCode,
		borrower: text(valueAt(row, fields, 'borrower')),
		counterparty: text(valueAt(row, fields, 'counterparty')),
		principalAmount,
		outstandingAmount: outstandingAmount ?? principalAmount,
		currency: text(valueAt(row, fields, 'currency')) ?? 'CNY',
		annualRate: rateValue(valueAt(row, fields, 'annualRate')),
		issueDate: dateValue(valueAt(row, fields, 'issueDate')),
		maturityDate,
		status: mapStatus(valueAt(row, fields, 'status'), maturityDate)
	};
}

/**
 * Treats each workbook as the complete current dataset. Debt master rows are
 * updated by stable business keys, while fields, cashflows and balance history
 * are replaced transactionally so only the latest workbook remains.
 */
export function importDebtWorkbook(workbookData, sourceFile, options = {}) {
	const db = options.db;
	if (!db) throw new Error('importDebtWorkbook requires options.db');
	const fileHash = stableId(workbookData);
	const parsed = parseDebtWorkbookData(workbookData, sourceFile);
	const typedData = buildTypedDebtData(parsed);
	const startedAt = new Date().toISOString();
	const existingRows = db.prepare('SELECT id, external_key AS externalKey FROM debts').all();
	const existingIds = new Map(existingRows.map((row) => [row.externalKey, row.id]));
	const incomingKeys = new Set(parsed.debts.map((debt) => debt[1]));
	const inserted = parsed.debts.filter((debt) => !existingIds.has(debt[1])).length;
	const updated = parsed.debts.length - inserted;
	const deleted = existingRows.filter((row) => !incomingKeys.has(row.externalKey)).length;

	db.prepare(`
		INSERT INTO data_import_state (
			id, workbook_name, workbook_hash, as_of_date, status, started_at,
			inserted_count, updated_count, deleted_count, debt_count,
			field_value_count, cashflow_count, history_date_count, excluded_future_count
		) VALUES (1, ?, ?, ?, 'running', ?, 0, 0, 0, 0, 0, 0, 0, ?)
		ON CONFLICT(id) DO UPDATE SET
			workbook_name = excluded.workbook_name,
			workbook_hash = excluded.workbook_hash,
			as_of_date = excluded.as_of_date,
			status = 'running',
			started_at = excluded.started_at,
			finished_at = NULL,
			inserted_count = 0,
			updated_count = 0,
			deleted_count = 0,
			error_message = NULL,
			excluded_future_count = excluded.excluded_future_count
	`).run(sourceFile, fileHash, parsed.snapshot.asOfDate, startedAt, parsed.excludedFutureDates.length);

	const upsertDebt = db.prepare(`
		INSERT INTO debts (
			id, external_key, debt_type, category_level_1, category_level_2,
			instrument_name, instrument_code, borrower, counterparty,
			principal_amount, outstanding_amount, currency, annual_rate,
			issue_date, maturity_date, status
		) VALUES (
			@id, @externalKey, @debtType, @categoryLevel1, @categoryLevel2,
			@instrumentName, @instrumentCode, @borrower, @counterparty,
			@principalAmount, @outstandingAmount, @currency, @annualRate,
			@issueDate, @maturityDate, @status
		)
		ON CONFLICT(external_key) DO UPDATE SET
			debt_type = excluded.debt_type,
			category_level_1 = excluded.category_level_1,
			category_level_2 = excluded.category_level_2,
			instrument_name = excluded.instrument_name,
			instrument_code = excluded.instrument_code,
			borrower = excluded.borrower,
			counterparty = excluded.counterparty,
			principal_amount = excluded.principal_amount,
			outstanding_amount = excluded.outstanding_amount,
			currency = excluded.currency,
			annual_rate = excluded.annual_rate,
			issue_date = excluded.issue_date,
			maturity_date = excluded.maturity_date,
			status = excluded.status,
			imported_at = CURRENT_TIMESTAMP,
			updated_at = CURRENT_TIMESTAMP
	`);
	const insertCashflow = db.prepare(`
		INSERT INTO debt_cashflow_events (
			event_key, debt_id, event_type, event_date, amount, sequence
		) VALUES (?, ?, ?, ?, ?, ?)
	`);
	const upsertBalance = db.prepare(`
		INSERT INTO debt_balance_daily (as_of_date, debt_type, balance_yi)
		VALUES (?, ?, ?)
		ON CONFLICT(as_of_date, debt_type) DO UPDATE SET
			balance_yi = excluded.balance_yi,
			updated_at = CURRENT_TIMESTAMP
	`);
	const insertWorkbookNote = db.prepare(
		'INSERT INTO workbook_notes (sheet_name, content) VALUES (?, ?)'
	);

	try {
		db.transaction(() => {
			clearTypedDebtTables(db);
			db.exec(`
				DELETE FROM debt_cashflow_events;
				DELETE FROM debt_balance_daily;
				CREATE TEMP TABLE IF NOT EXISTS current_import_debt_keys (
					external_key TEXT PRIMARY KEY
				);
				DELETE FROM current_import_debt_keys;
			`);
			const rememberDebtKey = db.prepare(
				'INSERT OR IGNORE INTO current_import_debt_keys (external_key) VALUES (?)'
			);
			const idByKey = new Map();
			for (const debt of parsed.debts) {
				const [generatedId, externalKey, debtType, categoryLevel1, categoryLevel2,
					instrumentName, instrumentCode, borrower, counterparty, principalAmount,
					outstandingAmount, currency, annualRate, issueDate, maturityDate, status] = debt;
				const id = existingIds.get(externalKey) ?? generatedId;
				upsertDebt.run({
					id, externalKey, debtType, categoryLevel1, categoryLevel2, instrumentName,
					instrumentCode, borrower, counterparty, principalAmount, outstandingAmount,
					currency, annualRate, issueDate, maturityDate, status
				});
				idByKey.set(externalKey, id);
				rememberDebtKey.run(externalKey);
			}
			const typedStatements = typedDebtStatements(db);
			for (const [name, rows] of Object.entries(typedData)) {
				for (const [externalKey, ...values] of rows) {
					const debtId = idByKey.get(externalKey);
					if (!debtId) throw new Error(`扩展字段找不到负债主表：${externalKey}`);
					typedStatements[name].run(debtId, ...values);
				}
			}
			for (const [eventKey, externalKey, eventType, eventDate, amount, sequence] of parsed.cashflows) {
				const debtId = idByKey.get(externalKey);
				if (!debtId) throw new Error(`现金流找不到负债主表：${externalKey}`);
				insertCashflow.run(eventKey, debtId, eventType, eventDate, amount, sequence);
			}
			for (const balance of parsed.balances) upsertBalance.run(...balance);
			for (const note of parsed.workbookNotes) insertWorkbookNote.run(...note);
			db.prepare(`
				DELETE FROM debts
				WHERE external_key NOT IN (SELECT external_key FROM current_import_debt_keys)
			`).run();
		})();

		const snapshot = assertPersistedDebtBalanceSnapshot(db, parsed.snapshot);
		const persistedDailyCount = Number(db.prepare('SELECT COUNT(*) AS count FROM debt_balance_daily').get().count);
		const expectedDailyCount = parsed.historyDateCount * SNAPSHOT_DEBT_TYPES.length;
		if (persistedDailyCount !== expectedDailyCount) {
			throw new Error(`日余额持久化记录数错误：${persistedDailyCount}，预期 ${expectedDailyCount}`);
		}
		const debtCount = Number(db.prepare('SELECT COUNT(*) AS count FROM debts').get().count);
		const historyDateCount = Number(db.prepare('SELECT COUNT(DISTINCT as_of_date) AS count FROM debt_balance_daily').get().count);
		db.prepare(`
			UPDATE data_import_state SET
				status = 'completed',
				finished_at = CURRENT_TIMESTAMP,
				inserted_count = ?,
				updated_count = ?,
				deleted_count = ?,
				debt_count = ?,
				field_value_count = ?,
				cashflow_count = ?,
				history_date_count = ?,
				error_message = NULL
			WHERE id = 1
		`).run(inserted, updated, deleted, debtCount, parsed.fieldValueCount, parsed.cashflows.length, historyDateCount);

		return {
			sourceFile,
			inserted,
			updated,
			deleted,
			skipped: parsed.skipped,
			sheetCount: parsed.sheetCount,
			fieldValueCount: parsed.fieldValueCount,
			cashflowEventCount: parsed.cashflows.length,
			historyDateCount,
			historyStartDate: parsed.historyStartDate,
			historyEndDate: parsed.historyEndDate,
			excludedFutureDates: parsed.excludedFutureDates,
			snapshot
		};
	} catch (error) {
		db.prepare(`
			UPDATE data_import_state SET status = 'failed', finished_at = CURRENT_TIMESTAMP, error_message = ? WHERE id = 1
		`).run(error instanceof Error ? error.message : String(error));
		throw error;
	}
}

export function parseDebtWorkbookData(workbookData, sourceFile) {
	const workbook = XLSX.read(workbookData, { type: 'array', cellDates: false });
	const history = parseSummaryHistory(workbook, sourceFile);
	const debts = [];
	const definitions = new Map();
	const recordGroups = [];
	const cashflows = [];
	const workbookNotes = new Map();
	const keyOccurrences = new Map();
	let sheetCount = 0;
	let skipped = 0;
	let fieldValueCount = 0;

	for (const sheetName of workbook.SheetNames) {
		if (SUMMARY_SHEET_NAMES.has(sheetName)) continue;
		const sheet = workbook.Sheets[sheetName];
		const bounds = meaningfulSheetBounds(sheet);
		if (bounds.maxRow < 0 || bounds.maxColumn < 0) continue;
		if (bounds.maxColumn >= DEBT_FIELD_COLUMNS.length) {
			throw new Error(`工作表 ${sheetName} 字段超过 ${DEBT_FIELD_COLUMNS.length} 列上限`);
		}
		const rows = XLSX.utils.sheet_to_json(sheet, {
			header: 1,
			range: {
				s: { r: 0, c: 0 },
				e: { r: bounds.maxRow, c: bounds.maxColumn }
			},
			raw: false,
			defval: null,
			blankrows: true
		});
		const header = findHeaderRow(rows);
		if (!header) continue;
		sheetCount += 1;
		const headers = rows[header.index];
		let parent = null;

		for (let index = header.index + 1; index < rows.length; index += 1) {
			const row = rows[index];
			if (!isMeaningfulRow(row)) continue;
			const sourceRow = index + 1;
			if (isUsableRow(row, header.fields)) {
				const candidate = rowToDebt(row, header.fields, sheetName, headers);
				if (
					candidate.instrumentName
					|| candidate.instrumentCode
					|| candidate.counterparty
					|| candidate.principalAmount !== null
				) {
					const occurrenceBase = stableDebtKey(candidate, 0);
					const occurrence = keyOccurrences.get(occurrenceBase) ?? 0;
					keyOccurrences.set(occurrenceBase, occurrence + 1);
					candidate.externalKey = stableDebtKey(candidate, occurrence);
					debts.push([
						candidate.id,
						candidate.externalKey,
						candidate.debtType,
						candidate.categoryLevel1,
						candidate.categoryLevel2,
						candidate.instrumentName,
						candidate.instrumentCode,
						candidate.borrower,
						candidate.counterparty,
						candidate.principalAmount,
						candidate.outstandingAmount,
						candidate.currency,
						candidate.annualRate,
						candidate.issueDate,
						candidate.maturityDate,
						candidate.status
					]);
					const group = [candidate.externalKey, []];
					recordGroups.push(group);
					parent = {
						debtId: candidate.id,
						externalKey: candidate.externalKey,
						rowSequence: 0,
						eventSequences: new Map(),
						group
					};
				}
			}

			if (!parent) {
				skipped += 1;
				continue;
			}
			const values = Array(DEBT_FIELD_COLUMNS.length).fill(null);
			for (const field of fieldValuesForRow(sheet, sourceRow, headers, bounds.maxColumn)) {
				if (field.fieldName.startsWith('未命名字段') && /^(注|说明)[：:.、\s]/u.test(field.displayValue)) {
					workbookNotes.set(sheetName, [sheetName, field.displayValue]);
					fieldValueCount += 1;
					continue;
				}
				definitions.set(`${sheetName}:${field.fieldOrder}`, [sheetName, field.fieldOrder, field.fieldName]);
				values[field.fieldOrder] = field.displayValue;
				fieldValueCount += 1;
			}
			parent.group[1].push([parent.rowSequence, values]);

			const events = cashflowEventsForRow({
				row,
				headers,
				sheetName,
				debtId: parent.debtId,
				externalKey: parent.externalKey,
				sequenceForEvent: (eventType, eventDate, amount) => {
					const key = `${eventType}:${eventDate}:${amount}`;
					const sequence = parent.eventSequences.get(key) ?? 0;
					parent.eventSequences.set(key, sequence + 1);
					return sequence;
				}
			});
			for (const event of events) {
				cashflows.push([
					event.eventKey,
					parent.externalKey,
					event.eventType,
					event.eventDate,
					event.amount,
					event.sequence
				]);
			}
			parent.rowSequence += 1;
		}
	}

	const balances = history.snapshots.flatMap((snapshot) => snapshot.balances.map((balance) => [
		snapshot.asOfDate,
		balance.debtType,
		balance.balanceYi
	]));
	return {
		debts,
		definitions: [...definitions.values()],
		recordGroups,
		cashflows,
		workbookNotes: [...workbookNotes.values()],
		balances,
		fieldValueCount,
		sheetCount,
		skipped,
		historyDateCount: new Set(history.snapshots.map((snapshot) => snapshot.asOfDate)).size,
		historyStartDate: history.snapshots[0]?.asOfDate ?? null,
		historyEndDate: history.snapshots.at(-1)?.asOfDate ?? null,
		excludedFutureDates: history.excludedFutureDates,
		snapshot: assertDebtBalanceSnapshot(history.latest)
	};
}

function jsonChunks(items, maximumBytes = 1_500_000) {
	const encoder = new TextEncoder();
	const chunks = [];
	let current = [];
	let currentBytes = 2;
	for (const item of items) {
		const itemJson = JSON.stringify(item);
		const itemBytes = encoder.encode(itemJson).byteLength + (current.length ? 1 : 0);
		if (current.length && currentBytes + itemBytes > maximumBytes) {
			chunks.push(JSON.stringify(current));
			current = [];
			currentBytes = 2;
		}
		if (itemBytes + 2 > maximumBytes) throw new Error('单条结构化记录超过 D1 绑定参数大小限制');
		current.push(item);
		currentBytes += itemBytes;
	}
	if (current.length) chunks.push(JSON.stringify(current));
	return chunks;
}

export const TYPED_IMPORT_TABLES = [
	{
		key: 'bond',
		table: 'bond_debt_details',
		stagingTable: 'bond_details_staging',
		columns: ['debt_id', 'short_name', 'issuance_method', 'bookbuilding_date', 'issuance_start_date',
			'term_days', 'interest_basis', 'issuance_target', 'market', 'receiving_account', 'trustee',
			'bookrunner', 'stated_interest_amount', 'stated_redemption_amount', 'remaining_principal_amount']
	},
	{
		key: 'bondSchedule',
		table: 'bond_payment_schedules',
		stagingTable: 'bond_schedules_staging',
		columns: ['debt_id', 'sequence', 'payment_date', 'principal_amount', 'interest_amount',
			'redemption_amount', 'remaining_principal_amount']
	},
	{
		key: 'certificate',
		table: 'income_certificate_details',
		stagingTable: 'income_certificate_staging',
		columns: ['debt_id', 'issuance_status', 'liquidation_submission_status',
			'liquidation_registration_status', 'series_name', 'term_label', 'return_type', 'investor_type',
			'term_days', 'interest_amount', 'liquidation_amount', 'subscription_date', 'redemption_date',
			'receiving_account', 'is_early_maturity']
	},
	{
		key: 'incomeRight',
		table: 'income_right_details',
		stagingTable: 'income_right_staging',
		columns: ['debt_id', 'period_label', 'term_days', 'interest_basis_days', 'stated_interest_amount']
	},
	{
		key: 'incomeRightSchedule',
		table: 'income_right_payment_schedules',
		stagingTable: 'income_right_schedules_staging',
		columns: ['debt_id', 'sequence', 'payment_date', 'interest_amount']
	},
	{
		key: 'interbank',
		table: 'interbank_borrowing_details',
		stagingTable: 'interbank_staging',
		columns: ['debt_id', 'term_days', 'interest_amount', 'repayment_amount']
	},
	{
		key: 'refinancing',
		table: 'refinancing_details',
		stagingTable: 'refinancing_staging',
		columns: ['debt_id', 'term_days', 'interest_basis_days', 'interest_amount', 'repayment_amount',
			'market', 'is_extended', 'receiving_account', 'repayment_account']
	},
	{ key: 'groupLoan', table: 'group_loan_details', stagingTable: 'group_loan_staging', columns: ['debt_id', 'lender_name'] },
	{
		key: 'groupSchedule',
		table: 'group_loan_schedules',
		stagingTable: 'group_loan_schedules_staging',
		columns: ['debt_id', 'sequence', 'accrual_end_date', 'accrued_interest_amount', 'payment_date',
			'paid_interest_amount', 'principal_repayment_amount', 'remaining_principal_amount',
			'supplemental_date', 'supplemental_note', 'supplemental_amount']
	},
	{
		key: 'swap',
		table: 'swap_facility_details',
		stagingTable: 'swap_staging',
		columns: ['debt_id', 'sequence_number', 'first_repo_date', 'average_repo_balance_description',
			'repo_weighted_average_rate', 'comprehensive_financing_rate']
	}
];

function typedD1InsertSql(table, columns) {
	return `
		INSERT INTO ${table} (${columns.join(', ')})
		SELECT d.id, ${columns.slice(1).map((_, index) => `json_extract(row.value, '$[${index + 1}]')`).join(', ')}
		FROM json_each(?) AS row
		JOIN debts d ON d.external_key = json_extract(row.value, '$[0]')
	`;
}

export async function importDebtWorkbookToD1(db, workbookData, sourceFile) {
	const parsed = parseDebtWorkbookData(workbookData, sourceFile);
	const typedData = buildTypedDebtData(parsed);
	const existingRows = await db.prepare('SELECT external_key AS externalKey FROM debts').all();
	const existingKeys = new Set(existingRows.map((row) => row.externalKey));
	const incomingKeys = new Set(parsed.debts.map((debt) => debt[1]));
	const inserted = parsed.debts.filter((debt) => !existingKeys.has(debt[1])).length;
	const updated = parsed.debts.length - inserted;
	const deleted = existingRows.filter((row) => !incomingKeys.has(row.externalKey)).length;
	const marker = globalThis.crypto.randomUUID();
	const statements = [
		db.prepare('DELETE FROM bond_payment_schedules').bind(),
		db.prepare('DELETE FROM income_right_payment_schedules').bind(),
		db.prepare('DELETE FROM group_loan_schedules').bind(),
		db.prepare('DELETE FROM bond_debt_details').bind(),
		db.prepare('DELETE FROM income_certificate_details').bind(),
		db.prepare('DELETE FROM income_right_details').bind(),
		db.prepare('DELETE FROM interbank_borrowing_details').bind(),
		db.prepare('DELETE FROM refinancing_details').bind(),
		db.prepare('DELETE FROM group_loan_details').bind(),
		db.prepare('DELETE FROM swap_facility_details').bind(),
		db.prepare('DELETE FROM workbook_notes').bind(),
		db.prepare('DELETE FROM debt_cashflow_events').bind(),
		db.prepare('DELETE FROM debt_balance_daily').bind()
	];

	const debtSql = `
		INSERT INTO debts (
			id, external_key, debt_type, category_level_1, category_level_2,
			instrument_name, instrument_code, borrower, counterparty,
			principal_amount, outstanding_amount, currency, annual_rate,
			issue_date, maturity_date, status, import_marker
		)
		SELECT
			json_extract(value, '$[0]'), json_extract(value, '$[1]'),
			json_extract(value, '$[2]'), json_extract(value, '$[3]'),
			json_extract(value, '$[4]'), json_extract(value, '$[5]'),
			json_extract(value, '$[6]'), json_extract(value, '$[7]'),
			json_extract(value, '$[8]'), json_extract(value, '$[9]'),
			json_extract(value, '$[10]'), json_extract(value, '$[11]'),
			json_extract(value, '$[12]'), json_extract(value, '$[13]'),
			json_extract(value, '$[14]'), json_extract(value, '$[15]'), ?
		FROM json_each(?)
		ON CONFLICT(external_key) DO UPDATE SET
			debt_type = excluded.debt_type,
			category_level_1 = excluded.category_level_1,
			category_level_2 = excluded.category_level_2,
			instrument_name = excluded.instrument_name,
			instrument_code = excluded.instrument_code,
			borrower = excluded.borrower,
			counterparty = excluded.counterparty,
			principal_amount = excluded.principal_amount,
			outstanding_amount = excluded.outstanding_amount,
			currency = excluded.currency,
			annual_rate = excluded.annual_rate,
			issue_date = excluded.issue_date,
			maturity_date = excluded.maturity_date,
			status = excluded.status,
			import_marker = excluded.import_marker,
			imported_at = CURRENT_TIMESTAMP,
			updated_at = CURRENT_TIMESTAMP
	`;
	for (const chunk of jsonChunks(parsed.debts)) statements.push(db.prepare(debtSql).bind(marker, chunk));

	for (const config of TYPED_IMPORT_TABLES) {
		const sql = typedD1InsertSql(config.table, config.columns);
		for (const chunk of jsonChunks(typedData[config.key])) {
			statements.push(db.prepare(sql).bind(chunk));
		}
	}
	for (const chunk of jsonChunks(parsed.workbookNotes)) {
		statements.push(db.prepare(`
			INSERT INTO workbook_notes (sheet_name, content)
			SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]') FROM json_each(?)
		`).bind(chunk));
	}

	const cashflowSql = `
		INSERT INTO debt_cashflow_events (event_key, debt_id, event_type, event_date, amount, sequence)
		SELECT json_extract(flow.value, '$[0]'), d.id,
			json_extract(flow.value, '$[2]'), json_extract(flow.value, '$[3]'),
			json_extract(flow.value, '$[4]'), json_extract(flow.value, '$[5]')
		FROM json_each(?) AS flow
		JOIN debts d ON d.external_key = json_extract(flow.value, '$[1]')
	`;
	for (const chunk of jsonChunks(parsed.cashflows)) statements.push(db.prepare(cashflowSql).bind(chunk));

	const balanceSql = `
		INSERT INTO debt_balance_daily (as_of_date, debt_type, balance_yi)
		SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]'), json_extract(value, '$[2]')
		FROM json_each(?)
		ON CONFLICT(as_of_date, debt_type) DO UPDATE SET
			balance_yi = excluded.balance_yi,
			updated_at = CURRENT_TIMESTAMP
	`;
	for (const chunk of jsonChunks(parsed.balances)) statements.push(db.prepare(balanceSql).bind(chunk));

	statements.push(
		db.prepare('DELETE FROM debts WHERE import_marker IS NULL OR import_marker != ?').bind(marker),
		db.prepare('UPDATE debts SET import_marker = NULL WHERE import_marker = ?').bind(marker),
		db.prepare(`
			INSERT INTO data_import_state (
				id, workbook_name, workbook_hash, as_of_date, status, started_at, finished_at,
				inserted_count, updated_count, deleted_count, debt_count, field_value_count,
				cashflow_count, history_date_count, excluded_future_count, error_message
			) VALUES (
				1, ?, ?, ?, 'completed', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP,
				?, ?, ?, ?, ?, ?, ?, ?, NULL
			)
			ON CONFLICT(id) DO UPDATE SET
				workbook_name = excluded.workbook_name,
				workbook_hash = excluded.workbook_hash,
				as_of_date = excluded.as_of_date,
				status = 'completed',
				started_at = excluded.started_at,
				finished_at = excluded.finished_at,
				inserted_count = excluded.inserted_count,
				updated_count = excluded.updated_count,
				deleted_count = excluded.deleted_count,
				debt_count = excluded.debt_count,
				field_value_count = excluded.field_value_count,
				cashflow_count = excluded.cashflow_count,
				history_date_count = excluded.history_date_count,
				excluded_future_count = excluded.excluded_future_count,
				error_message = NULL
		`).bind(
			sourceFile,
			stableId(new Uint8Array(workbookData)),
			parsed.snapshot.asOfDate,
			inserted,
			updated,
			deleted,
			parsed.debts.length,
			parsed.fieldValueCount,
			parsed.cashflows.length,
			parsed.historyDateCount,
			parsed.excludedFutureDates.length
		)
	);

	if (statements.length > 44) {
		throw new Error(`导入需要 ${statements.length} 条 D1 查询，超过单次安全上限 44`);
	}
	await db.batch(statements);
	return {
		sourceFile,
		inserted,
		updated,
		deleted,
		skipped: parsed.skipped,
		sheetCount: parsed.sheetCount,
		fieldValueCount: parsed.fieldValueCount,
		cashflowEventCount: parsed.cashflows.length,
		historyDateCount: parsed.historyDateCount,
		historyStartDate: parsed.historyStartDate,
		historyEndDate: parsed.historyEndDate,
		excludedFutureDates: parsed.excludedFutureDates,
		snapshot: parsed.snapshot,
		queryCount: statements.length + 1
	};
}
