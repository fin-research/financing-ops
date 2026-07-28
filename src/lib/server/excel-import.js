// @ts-nocheck
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import XLSX from 'xlsx';
import { getDatabase } from './db.js';

const SUMMARY_SHEET_NAMES = new Set(['借入资金汇总表']);
const SUMMARY_SHEET_NAME = '借入资金汇总表';
const SNAPSHOT_DEBT_TYPES = ['收益凭证', '收益权转让', '同业拆借', '次级债', '集团借款', '转融资', '短期融资券', '私募债', '小公募', '互换便利'];
const FIELD_ALIASES = {
	instrumentName: ['债券简称', '债券名称', '证券简称', '借入资金名称', '品种名称', '债务名称', '项目名称', '名称'],
	instrumentCode: ['债券代码', '证券代码', '代码', '合同编号', '编号'],
	debtType: ['债券类型', '债券种类', '负债品种', '债务品种', '融资品种', '品种', '类别', '类型'],
	borrower: ['发行人', '借款人', '融资主体', '借入单位', '主体', '公司名称'],
	counterparty: ['债权人', '资金出借方', '资金方', '对手方', '交易对手', '认购方', '借款对象', '投资者', '出借人', '拆出方'],
	principalAmount: ['发行金额', '借入金额', '融资金额', '借款金额', '发行规模', '本金', '金额', '规模'],
	outstandingAmount: ['余额', '未偿余额', '剩余本金', '待偿金额'],
	currency: ['币种', '货币'],
	annualRate: ['票面利率', '发行利率', '融资利率', '年利率', '互换利率', '收益率', '利率', '成本'],
	issueDate: ['发行日期', '起息日', '借入日期', '开始日期', '互换开始日', '拆入时间', '到账日期', '交易日期'],
	maturityDate: ['到期日', '兑付日', '截止日期', '结束日期', '互换到期日'],
	status: ['状态', '存续状态']
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

function upsertSummarySnapshots(db, snapshots, sourceFile) {
	const upsert = db.prepare(`
		INSERT INTO debt_balance_daily (
			as_of_date, debt_type, balance_yi, source_sheet, source_cell, source_file
		)
		VALUES (@asOfDate, @debtType, @balanceYi, @sourceSheet, @sourceCell, @sourceFile)
		ON CONFLICT(as_of_date, debt_type) DO UPDATE SET
			balance_yi = excluded.balance_yi,
			source_sheet = excluded.source_sheet,
			source_cell = excluded.source_cell,
			source_file = excluded.source_file,
			updated_at = CURRENT_TIMESTAMP
	`);
	const upsertHistory = db.prepare(`
		INSERT INTO debt_balance_history (
			id, source_file, as_of_date, debt_type, balance_yi,
			source_sheet, source_cell, source_sequence
		) VALUES (
			@id, @sourceFile, @asOfDate, @debtType, @balanceYi,
			@sourceSheet, @sourceCell, @sourceSequence
		)
		ON CONFLICT(source_file, source_sheet, source_cell) DO UPDATE SET
			as_of_date = excluded.as_of_date,
			debt_type = excluded.debt_type,
			balance_yi = excluded.balance_yi,
			source_sequence = excluded.source_sequence,
			updated_at = CURRENT_TIMESTAMP
	`);
	for (const snapshot of snapshots) {
		for (const balance of snapshot.balances) {
			upsertHistory.run({
				id: stableId(`${sourceFile}:${snapshot.sourceSheet}:${balance.sourceCell}`),
				asOfDate: snapshot.asOfDate,
				sourceSheet: snapshot.sourceSheet,
				sourceFile,
				sourceSequence: snapshot.sourceSequence,
				...balance
			});
			upsert.run({
				asOfDate: snapshot.asOfDate,
				sourceSheet: snapshot.sourceSheet,
				sourceFile,
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
		SELECT debt_type AS debtType, balance_yi AS balanceYi, source_cell AS sourceCell
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
	if (/已到期|到期|兑付/.test(candidate)) return 'matured';
	if (/计划|拟/.test(candidate)) return 'planned';
	if (/结束|注销|终止|偿还/.test(candidate)) return 'closed';
	if (maturityDate && maturityDate < new Date().toISOString().slice(0, 10)) return 'matured';
	return 'active';
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

function sourceRowData(sheet, sourceRow, headers, maxColumn) {
	const cells = [];
	for (let column = 0; column <= maxColumn; column += 1) {
		const address = XLSX.utils.encode_cell({ r: sourceRow - 1, c: column });
		const cell = sheet[address];
		if (!cell || text(cell.v) === null) continue;
		cells.push({
			cell: address,
			header: text(headers[column]),
			value: cell.v,
			formatted: cell.w ?? null,
			formula: cell.f ?? null
		});
	}
	return JSON.stringify(cells);
}

function stableId(value) {
	return crypto.createHash('sha256').update(value).digest('hex');
}

const CASHFLOW_DATE_HEADERS = ['还息日', '偿还日', '付息时间', '还息计划', '计息期间', '到期日'];
const INTEREST_AMOUNT_HEADERS = ['应付利息', '偿还利息'];
const PRINCIPAL_AMOUNT_HEADERS = ['偿还本金'];

function cashflowEventsForRow({
	row,
	headers,
	sheetName,
	sourceRow,
	sourceFile,
	parentExternalKey,
	rawData
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
		const sourceDateCell = XLSX.utils.encode_cell({ r: sourceRow - 1, c: dateColumn.column });
		const sourceAmountCell = XLSX.utils.encode_cell({ r: sourceRow - 1, c: amountColumn.column });
		const eventKey = stableId([
			sourceFile,
			sheetName,
			sourceRow,
			eventType,
			sourceDateCell,
			sourceAmountCell
		].join(':'));
		events.push({
			id: eventKey,
			eventKey,
			debtExternalKey: parentExternalKey,
			eventType,
			eventDate: dateColumn.date,
			amount,
			sourceFile,
			sourceSheet: sheetName,
			sourceRow,
			sourceDateCell,
			sourceAmountCell,
			rawData
		});
	}
	return events;
}

function rowToDebt(row, fields, sheetName, sourceRow, headers, rawData) {
	const instrumentName = text(valueAt(row, fields, 'instrumentName'));
	const instrumentCode = text(valueAt(row, fields, 'instrumentCode'));
	const principalAmount = amountValue(valueAt(row, fields, 'principalAmount'), headers[fields.principalAmount]);
	const outstandingAmount = amountValue(valueAt(row, fields, 'outstandingAmount'), headers[fields.outstandingAmount]);
	const maturityDate = dateValue(valueAt(row, fields, 'maturityDate'));
	return {
		id: crypto.randomUUID(),
		externalKey: crypto.createHash('sha256').update(`${sheetName}:${sourceRow}`).digest('hex'),
		debtType: sheetName,
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
		status: mapStatus(valueAt(row, fields, 'status'), maturityDate),
		sourceSheet: sheetName,
		sourceRow,
		rawData
	};
}

/**
 * Imports all detail worksheets into the normalized debts table. Existing rows
 * are matched by source worksheet + Excel row so importing an updated workbook
 * refreshes records instead of appending duplicates.
 */
export function importDebtWorkbook(workbookPath) {
	const db = getDatabase();
	const resolvedPath = path.resolve(workbookPath);
	const sourceFile = path.basename(resolvedPath);
	const fileHash = crypto.createHash('sha256').update(fs.readFileSync(resolvedPath)).digest('hex');
	const runId = crypto.randomUUID();
	db.prepare('INSERT INTO import_runs (id, source_file, file_hash, status) VALUES (?, ?, ?, ?)').run(runId, sourceFile, fileHash, 'running');
	let inserted = 0;
	let updated = 0;
	let skipped = 0;
	let sheetCount = 0;
	let sourceRowCount = 0;
	let cashflowEventCount = 0;
	let history = null;

	const upsert = db.prepare(`
		INSERT INTO debts (
			id, external_key, debt_type, instrument_name, instrument_code, borrower, counterparty,
			principal_amount, outstanding_amount, currency, annual_rate, issue_date, maturity_date, status,
			source_sheet, source_row, source_file, raw_data
		) VALUES (
			@id, @externalKey, @debtType, @instrumentName, @instrumentCode, @borrower, @counterparty,
			@principalAmount, @outstandingAmount, @currency, @annualRate, @issueDate, @maturityDate, @status,
			@sourceSheet, @sourceRow, @sourceFile, @rawData
		)
		ON CONFLICT(external_key) DO UPDATE SET
			debt_type = excluded.debt_type, instrument_name = excluded.instrument_name, instrument_code = excluded.instrument_code,
			borrower = excluded.borrower, counterparty = excluded.counterparty, principal_amount = excluded.principal_amount,
			outstanding_amount = excluded.outstanding_amount, currency = excluded.currency, annual_rate = excluded.annual_rate,
			issue_date = excluded.issue_date, maturity_date = excluded.maturity_date, status = excluded.status,
			source_file = excluded.source_file, raw_data = excluded.raw_data, imported_at = CURRENT_TIMESTAMP,
			updated_at = CURRENT_TIMESTAMP
	`);
	const exists = db.prepare('SELECT 1 FROM debts WHERE external_key = ?');
	const upsertSourceRow = db.prepare(`
		INSERT INTO debt_source_rows (
			id, source_file, source_sheet, source_row, record_kind,
			parent_external_key, row_data
		) VALUES (
			@id, @sourceFile, @sourceSheet, @sourceRow, @recordKind,
			@parentExternalKey, @rowData
		)
		ON CONFLICT(source_file, source_sheet, source_row) DO UPDATE SET
			record_kind = excluded.record_kind,
			parent_external_key = excluded.parent_external_key,
			row_data = excluded.row_data,
			updated_at = CURRENT_TIMESTAMP
	`);
	const upsertCashflow = db.prepare(`
		INSERT INTO debt_cashflow_events (
			id, event_key, debt_external_key, event_type, event_date, amount,
			source_file, source_sheet, source_row, source_date_cell, source_amount_cell, raw_data
		) VALUES (
			@id, @eventKey, @debtExternalKey, @eventType, @eventDate, @amount,
			@sourceFile, @sourceSheet, @sourceRow, @sourceDateCell, @sourceAmountCell, @rawData
		)
		ON CONFLICT(event_key) DO UPDATE SET
			debt_external_key = excluded.debt_external_key,
			event_type = excluded.event_type,
			event_date = excluded.event_date,
			amount = excluded.amount,
			source_date_cell = excluded.source_date_cell,
			source_amount_cell = excluded.source_amount_cell,
			raw_data = excluded.raw_data,
			updated_at = CURRENT_TIMESTAMP
	`);

	try {
		const workbook = XLSX.readFile(resolvedPath, { cellDates: false });
		history = parseSummaryHistory(workbook, sourceFile);
		db.transaction(() => {
			db.prepare('DELETE FROM debt_balance_history WHERE source_file = ?').run(sourceFile);
			upsertSummarySnapshots(db, history.snapshots, sourceFile);
			db.prepare('DELETE FROM debt_source_rows WHERE source_file = ?').run(sourceFile);
			db.prepare('DELETE FROM debt_cashflow_events WHERE source_file = ?').run(sourceFile);
			db.exec(`
				CREATE TEMP TABLE IF NOT EXISTS current_import_debt_keys (
					external_key TEXT PRIMARY KEY
				);
				DELETE FROM current_import_debt_keys;
			`);
			const rememberDebtKey = db.prepare(
				'INSERT OR IGNORE INTO current_import_debt_keys (external_key) VALUES (?)'
			);

			for (const sheetName of workbook.SheetNames) {
				if (SUMMARY_SHEET_NAMES.has(sheetName)) continue;
				const sheet = workbook.Sheets[sheetName];
				const bounds = meaningfulSheetBounds(sheet);
				if (bounds.maxRow < 0 || bounds.maxColumn < 0) continue;
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
				let parentExternalKey = null;
				for (let index = header.index + 1; index < rows.length; index += 1) {
					const row = rows[index];
					if (!isMeaningfulRow(row)) continue;
					const sourceRow = index + 1;
					const rawData = sourceRowData(sheet, sourceRow, headers, bounds.maxColumn);
					let debt = null;
					if (isUsableRow(row, header.fields)) {
						const candidate = rowToDebt(
							row,
							header.fields,
							sheetName,
							sourceRow,
							headers,
							rawData
						);
						if (
							candidate.instrumentName
							|| candidate.instrumentCode
							|| candidate.counterparty
							|| candidate.principalAmount !== null
						) {
							debt = candidate;
							parentExternalKey = debt.externalKey;
							debt.sourceFile = sourceFile;
							if (exists.get(debt.externalKey)) updated += 1;
							else inserted += 1;
							upsert.run(debt);
							rememberDebtKey.run(debt.externalKey);
						}
					}

					const firstValue = text(row.find((value) => text(value) !== null)) ?? '';
					const recordKind = debt
						? 'detail'
						: /合计|总计|小计|备注|说明/u.test(firstValue)
							? 'summary'
							: 'continuation';
					upsertSourceRow.run({
						id: stableId(`${sourceFile}:${sheetName}:${sourceRow}`),
						sourceFile,
						sourceSheet: sheetName,
						sourceRow,
						recordKind,
						parentExternalKey,
						rowData: rawData
					});
					sourceRowCount += 1;

					const cashflowEvents = cashflowEventsForRow({
						row,
						headers,
						sheetName,
						sourceRow,
						sourceFile,
						parentExternalKey,
						rawData
					});
					for (const event of cashflowEvents) {
						upsertCashflow.run(event);
						cashflowEventCount += 1;
					}
				}
			}
			db.prepare(`
				DELETE FROM debts
				WHERE source_file = ?
					AND external_key NOT IN (SELECT external_key FROM current_import_debt_keys)
			`).run(sourceFile);
		})();
		assertPersistedDebtBalanceSnapshot(db, history.latest);
		const persistedDailyCount = db.prepare(`
			SELECT COUNT(*) AS count
			FROM debt_balance_daily
			WHERE source_file = ?
		`).get(sourceFile).count;
		const expectedDailyCount = new Set(
			history.snapshots.map((snapshot) => snapshot.asOfDate)
		).size * SNAPSHOT_DEBT_TYPES.length;
		if (Number(persistedDailyCount) !== expectedDailyCount) {
			throw new Error(
				`日余额持久化记录数错误：${persistedDailyCount}，预期 ${expectedDailyCount}`
			);
		}
		const persistedHistoryCount = db.prepare(`
			SELECT COUNT(*) AS count
			FROM debt_balance_history
			WHERE source_file = ?
		`).get(sourceFile).count;
		const expectedHistoryCount = history.snapshots.length * SNAPSHOT_DEBT_TYPES.length;
		if (Number(persistedHistoryCount) !== expectedHistoryCount) {
			throw new Error(
				`全量历史快照持久化记录数错误：${persistedHistoryCount}，预期 ${expectedHistoryCount}`
			);
		}
		db.prepare(`UPDATE import_runs SET status = 'completed', finished_at = CURRENT_TIMESTAMP, inserted_count = ?, updated_count = ?, skipped_count = ? WHERE id = ?`).run(inserted, updated, skipped, runId);
	} catch (error) {
		db.prepare(`UPDATE import_runs SET status = 'failed', finished_at = CURRENT_TIMESTAMP, error_message = ? WHERE id = ?`).run(error instanceof Error ? error.message : String(error), runId);
		throw error;
	}

	return {
		runId,
		sourceFile,
		inserted,
		updated,
		skipped,
		sheetCount,
		sourceRowCount,
		cashflowEventCount,
		historySnapshotCount: history.snapshots.length,
		historyBalanceRowCount: history.snapshots.length * SNAPSHOT_DEBT_TYPES.length,
		historyStartDate: history.snapshots[0]?.asOfDate ?? null,
		historyEndDate: history.snapshots.at(-1)?.asOfDate ?? null,
		excludedFutureDates: history.excludedFutureDates,
		snapshot: assertPersistedDebtBalanceSnapshot(db, history.latest)
	};
}
