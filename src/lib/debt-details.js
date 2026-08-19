// @ts-nocheck

const BOND_TYPES = new Set(['小公募', '私募债', '次级债', '短期融资券', '科创债', '公司债']);
const range = (start, end) => new Set(Array.from({ length: end - start + 1 }, (_, index) => start + index));
const SUPPORTED_FIELD_ORDERS = new Map([
	['小公募', range(1, 19)],
	['私募债', range(1, 19)],
	['次级债', range(1, 22)],
	['短期融资券', range(1, 15)],
	['科创债', range(1, 22)],
	['公司债', range(1, 22)],
	['收益凭证', range(1, 20)],
	['收益权转让', range(1, 13)],
	['同业拆借', range(1, 9)],
	['转融资', range(1, 13)],
	['集团借款', new Set([...range(1, 12), 14, 15])],
	['互换便利', range(1, 9)]
]);

function normalise(value) {
	return String(value ?? '').replace(/[\s\r\n（）()【】\[\]：:，,\-—_]/g, '').toLowerCase();
}

function value(fields, ...names) {
	for (const name of names) {
		const result = fields.get(normalise(name));
		if (result != null && String(result).trim() !== '') return result;
	}
	return null;
}

function text(valueToConvert) {
	if (valueToConvert == null) return null;
	const result = String(valueToConvert).trim();
	return !result || result === '-' || result === '—' || result === '/' ? null : result;
}

function number(valueToConvert) {
	const candidate = text(valueToConvert);
	if (!candidate) return null;
	const result = Number(candidate.replace(/[,，\s元]/g, '').replace(/[％%]/g, ''));
	return Number.isFinite(result) ? result : null;
}

function integer(valueToConvert) {
	const result = number(valueToConvert);
	return result == null ? null : Math.trunc(result);
}

function rate(valueToConvert) {
	const result = number(valueToConvert);
	if (result == null) return null;
	return /[%％]/.test(String(valueToConvert)) || result > 1 ? result / 100 : result;
}

function date(valueToConvert) {
	const candidate = text(valueToConvert);
	if (!candidate) return null;
	const yearFirst = candidate.match(/^(\d{4})[./年-](\d{1,2})[./月-](\d{1,2})/);
	const monthFirst = candidate.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
	if (!yearFirst && !monthFirst) return null;
	const [, first, second, third] = yearFirst ?? monthFirst;
	const [year, month, day] = yearFirst
		? [first, second, third]
		: [third.length === 2 ? String(2000 + Number(third)) : third, first, second];
	return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

export function createTypedDebtTables(db) {
	db.exec(`
		CREATE TABLE IF NOT EXISTS bond_debt_details (
			debt_id TEXT PRIMARY KEY REFERENCES debts(id) ON DELETE CASCADE,
			short_name TEXT,
			issuance_method TEXT,
			bookbuilding_date TEXT,
			issuance_start_date TEXT,
			term_days INTEGER,
			interest_basis TEXT,
			issuance_target TEXT,
			market TEXT,
			receiving_account TEXT,
			trustee TEXT,
			bookrunner TEXT,
			stated_interest_amount REAL,
			stated_redemption_amount REAL,
			remaining_principal_amount REAL
		) STRICT;

		CREATE TABLE IF NOT EXISTS bond_payment_schedules (
			debt_id TEXT NOT NULL REFERENCES bond_debt_details(debt_id) ON DELETE CASCADE,
			sequence INTEGER NOT NULL,
			payment_date TEXT,
			principal_amount REAL,
			interest_amount REAL,
			redemption_amount REAL,
			remaining_principal_amount REAL,
			PRIMARY KEY (debt_id, sequence)
		) STRICT;

		CREATE TABLE IF NOT EXISTS income_certificate_details (
			debt_id TEXT PRIMARY KEY REFERENCES debts(id) ON DELETE CASCADE,
			issuance_status TEXT,
			liquidation_submission_status TEXT,
			liquidation_registration_status TEXT,
			series_name TEXT,
			term_label TEXT,
			return_type TEXT,
			investor_type TEXT,
			term_days INTEGER,
			interest_amount REAL,
			liquidation_amount REAL,
			subscription_date TEXT,
			redemption_date TEXT,
			receiving_account TEXT,
			is_early_maturity TEXT
		) STRICT;

		CREATE TABLE IF NOT EXISTS income_right_details (
			debt_id TEXT PRIMARY KEY REFERENCES debts(id) ON DELETE CASCADE,
			period_label TEXT,
			term_days INTEGER,
			interest_basis_days INTEGER,
			stated_interest_amount REAL
		) STRICT;

		CREATE TABLE IF NOT EXISTS income_right_payment_schedules (
			debt_id TEXT NOT NULL REFERENCES income_right_details(debt_id) ON DELETE CASCADE,
			sequence INTEGER NOT NULL,
			payment_date TEXT,
			interest_amount REAL,
			PRIMARY KEY (debt_id, sequence)
		) STRICT;

		CREATE TABLE IF NOT EXISTS interbank_borrowing_details (
			debt_id TEXT PRIMARY KEY REFERENCES debts(id) ON DELETE CASCADE,
			term_days INTEGER,
			interest_amount REAL,
			repayment_amount REAL
		) STRICT;

		CREATE TABLE IF NOT EXISTS refinancing_details (
			debt_id TEXT PRIMARY KEY REFERENCES debts(id) ON DELETE CASCADE,
			term_days INTEGER,
			interest_basis_days INTEGER,
			interest_amount REAL,
			repayment_amount REAL,
			market TEXT,
			is_extended TEXT,
			receiving_account TEXT,
			repayment_account TEXT
		) STRICT;

		CREATE TABLE IF NOT EXISTS group_loan_details (
			debt_id TEXT PRIMARY KEY REFERENCES debts(id) ON DELETE CASCADE,
			lender_name TEXT
		) STRICT;

		CREATE TABLE IF NOT EXISTS group_loan_schedules (
			debt_id TEXT NOT NULL REFERENCES group_loan_details(debt_id) ON DELETE CASCADE,
			sequence INTEGER NOT NULL,
			accrual_end_date TEXT,
			accrued_interest_amount REAL,
			payment_date TEXT,
			paid_interest_amount REAL,
			principal_repayment_amount REAL,
			remaining_principal_amount REAL,
			supplemental_date TEXT,
			supplemental_note TEXT,
			supplemental_amount REAL,
			PRIMARY KEY (debt_id, sequence)
		) STRICT;

		CREATE TABLE IF NOT EXISTS swap_facility_details (
			debt_id TEXT PRIMARY KEY REFERENCES debts(id) ON DELETE CASCADE,
			sequence_number INTEGER,
			first_repo_date TEXT,
			average_repo_balance_description TEXT,
			repo_weighted_average_rate REAL,
			comprehensive_financing_rate REAL
		) STRICT;

		CREATE TABLE IF NOT EXISTS workbook_notes (
			sheet_name TEXT PRIMARY KEY,
			content TEXT NOT NULL
		) STRICT;

		CREATE TRIGGER IF NOT EXISTS validate_bond_debt_type
		BEFORE INSERT ON bond_debt_details
		WHEN (SELECT debt_type FROM debts WHERE id = NEW.debt_id)
			NOT IN ('小公募', '私募债', '次级债', '短期融资券', '科创债', '公司债')
		BEGIN SELECT RAISE(ABORT, 'bond_debt_details debt_type mismatch'); END;

		CREATE TRIGGER IF NOT EXISTS validate_income_certificate_debt_type
		BEFORE INSERT ON income_certificate_details
		WHEN (SELECT debt_type FROM debts WHERE id = NEW.debt_id) <> '收益凭证'
		BEGIN SELECT RAISE(ABORT, 'income_certificate_details debt_type mismatch'); END;

		CREATE TRIGGER IF NOT EXISTS validate_income_right_debt_type
		BEFORE INSERT ON income_right_details
		WHEN (SELECT debt_type FROM debts WHERE id = NEW.debt_id) <> '收益权转让'
		BEGIN SELECT RAISE(ABORT, 'income_right_details debt_type mismatch'); END;

		CREATE TRIGGER IF NOT EXISTS validate_interbank_debt_type
		BEFORE INSERT ON interbank_borrowing_details
		WHEN (SELECT debt_type FROM debts WHERE id = NEW.debt_id) <> '同业拆借'
		BEGIN SELECT RAISE(ABORT, 'interbank_borrowing_details debt_type mismatch'); END;

		CREATE TRIGGER IF NOT EXISTS validate_refinancing_debt_type
		BEFORE INSERT ON refinancing_details
		WHEN (SELECT debt_type FROM debts WHERE id = NEW.debt_id) <> '转融资'
		BEGIN SELECT RAISE(ABORT, 'refinancing_details debt_type mismatch'); END;

		CREATE TRIGGER IF NOT EXISTS validate_group_loan_debt_type
		BEFORE INSERT ON group_loan_details
		WHEN (SELECT debt_type FROM debts WHERE id = NEW.debt_id) <> '集团借款'
		BEGIN SELECT RAISE(ABORT, 'group_loan_details debt_type mismatch'); END;

		CREATE TRIGGER IF NOT EXISTS validate_swap_facility_debt_type
		BEFORE INSERT ON swap_facility_details
		WHEN (SELECT debt_type FROM debts WHERE id = NEW.debt_id) <> '互换便利'
		BEGIN SELECT RAISE(ABORT, 'swap_facility_details debt_type mismatch'); END;
	`);
}

function definitionsByType(db) {
	const result = new Map();
	for (const row of db.prepare(`
		SELECT debt_type AS debtType, field_order AS fieldOrder, field_name AS fieldName
		FROM debt_field_definitions ORDER BY debt_type, field_order
	`).all()) {
		if (!result.has(row.debtType)) result.set(row.debtType, new Map());
		result.get(row.debtType).set(row.fieldOrder, row.fieldName);
	}
	return result;
}

function recordsByDebt(db, definitions) {
	const columns = Array.from({ length: 64 }, (_, index) => `value_${index}`);
	const result = new Map();
	for (const row of db.prepare(`
		SELECT r.debt_id AS debtId, r.row_sequence AS rowSequence,
			d.debt_type AS debtType, ${columns.map((column) => `r.${column}`).join(', ')}
		FROM debt_records r
		JOIN debts d ON d.id = r.debt_id
		ORDER BY r.debt_id, r.row_sequence
	`).all()) {
		const fieldDefinitions = definitions.get(row.debtType) ?? new Map();
		const fields = new Map();
		const orders = new Map();
		for (const [fieldOrder, fieldName] of fieldDefinitions) {
			const fieldValue = row[`value_${fieldOrder}`];
			if (fieldValue != null) {
				fields.set(normalise(fieldName), fieldValue);
				orders.set(fieldOrder, fieldValue);
			}
		}
		if (!result.has(row.debtId)) result.set(row.debtId, []);
		result.get(row.debtId).push({ sequence: row.rowSequence, fields, orders });
	}
	return result;
}

function insertTypedDebt(db, debt, records, statements) {
	const main = records[0]?.fields ?? new Map();
	if (BOND_TYPES.has(debt.debtType)) {
		statements.bond.run(
			debt.id,
			text(value(main, '债券简称')),
			text(value(main, '发行方式')),
			text(value(main, '簿记日', '簿记/发行日')),
			date(value(main, '发行(起始)日')),
			integer(value(main, '期限(天)', '期限（天）')),
			text(value(main, '年化计息天数(天)', '年化计息天数(月/天)')),
			text(value(main, '发行对象')),
			text(value(main, '市场')),
			text(value(main, '收款账户')),
			text(value(main, '受托管理人')),
			text(value(main, '簿记管理人')),
			number(value(main, '应付利息（元）')),
			number(value(main, '本息合计（元）')),
			number(value(main, '剩余本金（元）'))
		);
		for (const record of records) {
			const fields = record.fields;
			const paymentDate = date(value(fields, '还息日', '偿还日'));
			const principalAmount = number(value(fields, '偿还本金（元）'));
			const interestAmount = number(value(fields, '应付利息（元）', '偿还利息（元）'));
			const redemptionAmount = number(value(fields, '兑付金额（元）'));
			const remainingPrincipal = number(value(fields, '剩余本金（元）'));
			if (paymentDate || principalAmount != null || interestAmount != null || redemptionAmount != null || remainingPrincipal != null) {
				statements.bondSchedule.run(debt.id, record.sequence, paymentDate, principalAmount, interestAmount, redemptionAmount, remainingPrincipal);
			}
		}
		return;
	}

	if (debt.debtType === '收益凭证') {
		statements.certificate.run(
			debt.id,
			text(value(main, '发行状态')),
			text(value(main, '清盘提交')),
			text(value(main, '清盘注册')),
			text(value(main, '系列')),
			text(value(main, '期限')),
			text(value(main, '收益类型')),
			text(value(main, '投资者类型')),
			integer(value(main, '期限（天）')),
			number(value(main, '应付利息（元）')),
			number(value(main, '清盘金额（元）')),
			date(value(main, '认购日')),
			date(value(main, '兑付日')),
			text(value(main, '收款账户')),
			text(value(main, '是否提前到期'))
		);
		return;
	}

	if (debt.debtType === '收益权转让') {
		statements.incomeRight.run(
			debt.id,
			text(value(main, '期数')),
			integer(value(main, '期限（天）')),
			integer(value(main, '年化计息天数')),
			number(value(main, '应付利息（元）'))
		);
		for (const record of records) {
			const paymentDate = date(record.orders?.get(12) ?? value(record.fields, '还息计划'));
			const interestAmount = number(record.orders?.get(13) ?? value(record.fields, '未命名字段 14'));
			if (paymentDate || interestAmount != null) statements.incomeRightSchedule.run(debt.id, record.sequence, paymentDate, interestAmount);
		}
		return;
	}

	if (debt.debtType === '同业拆借') {
		statements.interbank.run(
			debt.id,
			integer(value(main, '期限（天）')),
			number(value(main, '应付利息（元）')),
			number(value(main, '本息合计（元）'))
		);
		return;
	}

	if (debt.debtType === '转融资') {
		statements.refinancing.run(
			debt.id,
			integer(value(main, '期限（天）')),
			integer(value(main, '年化计息天数（天）')),
			number(value(main, '应付利息（元）')),
			number(value(main, '本息合计（元）')),
			text(value(main, '市场')),
			text(value(main, '是否展期')),
			text(value(main, '收款账户')),
			text(value(main, '还款账户'))
		);
		return;
	}

	if (debt.debtType === '集团借款') {
		statements.groupLoan.run(debt.id, text(value(main, '借款对象')));
		for (const record of records) {
			const values = [
				date(record.orders?.get(6)),
				number(record.orders?.get(7)),
				date(record.orders?.get(8)),
				number(record.orders?.get(9)),
				number(record.orders?.get(10)),
				number(record.orders?.get(11)),
				date(record.orders?.get(12)),
				text(record.orders?.get(14)),
				number(record.orders?.get(15))
			];
			if (values.some((item) => item != null)) statements.groupSchedule.run(debt.id, record.sequence, ...values);
		}
		return;
	}

	if (debt.debtType === '互换便利') {
		statements.swap.run(
			debt.id,
			integer(value(main, '序号')),
			date(value(main, '首次正回购日期')),
			text(value(main, '正回购日均余额（元）')),
			rate(value(main, '正回购加权平均利率')),
			rate(value(main, '综合融资利率'))
		);
	}
}

export function typedDebtStatements(db) {
	return {
		bond: db.prepare(`INSERT INTO bond_debt_details VALUES (${Array(15).fill('?').join(', ')})`),
		bondSchedule: db.prepare(`INSERT INTO bond_payment_schedules VALUES (${Array(7).fill('?').join(', ')})`),
		certificate: db.prepare(`INSERT INTO income_certificate_details VALUES (${Array(15).fill('?').join(', ')})`),
		incomeRight: db.prepare(`INSERT INTO income_right_details VALUES (${Array(5).fill('?').join(', ')})`),
		incomeRightSchedule: db.prepare(`INSERT INTO income_right_payment_schedules VALUES (${Array(4).fill('?').join(', ')})`),
		interbank: db.prepare(`INSERT INTO interbank_borrowing_details VALUES (${Array(4).fill('?').join(', ')})`),
		refinancing: db.prepare(`INSERT INTO refinancing_details VALUES (${Array(9).fill('?').join(', ')})`),
		groupLoan: db.prepare('INSERT INTO group_loan_details VALUES (?, ?)'),
		groupSchedule: db.prepare(`INSERT INTO group_loan_schedules VALUES (${Array(11).fill('?').join(', ')})`),
		swap: db.prepare(`INSERT INTO swap_facility_details VALUES (${Array(6).fill('?').join(', ')})`)
	};
}

export function buildTypedDebtData(parsed) {
	const definitions = new Map();
	for (const [debtType, fieldOrder, fieldName] of parsed.definitions) {
		if (!SUPPORTED_FIELD_ORDERS.get(debtType)?.has(fieldOrder)) {
			throw new Error(`工作表 ${debtType} 的字段“${fieldName}”（第 ${fieldOrder + 1} 列）尚未映射到结构化表`);
		}
		if (!definitions.has(debtType)) definitions.set(debtType, new Map());
		definitions.get(debtType).set(fieldOrder, fieldName);
	}
	const debtTypes = new Map(parsed.debts.map((debt) => [debt[1], debt[2]]));
	const output = {
		bond: [],
		bondSchedule: [],
		certificate: [],
		incomeRight: [],
		incomeRightSchedule: [],
		interbank: [],
		refinancing: [],
		groupLoan: [],
		groupSchedule: [],
		swap: []
	};
	const statements = Object.fromEntries(
		Object.entries(output).map(([name, rows]) => [name, { run: (...values) => rows.push(values) }])
	);

	for (const [externalKey, rawRecords] of parsed.recordGroups) {
		const debtType = debtTypes.get(externalKey);
		const fieldDefinitions = definitions.get(debtType) ?? new Map();
		const records = rawRecords.map(([sequence, values]) => {
			const fields = new Map();
			const orders = new Map();
			for (const [fieldOrder, fieldName] of fieldDefinitions) {
				const fieldValue = values[fieldOrder];
				if (fieldValue != null) {
					fields.set(normalise(fieldName), fieldValue);
					orders.set(fieldOrder, fieldValue);
				}
			}
			return { sequence, fields, orders };
		});
		insertTypedDebt(null, { id: externalKey, debtType }, records, statements);
	}
	return output;
}

export function clearTypedDebtTables(db) {
	db.exec(`
		DELETE FROM bond_payment_schedules;
		DELETE FROM income_right_payment_schedules;
		DELETE FROM group_loan_schedules;
		DELETE FROM bond_debt_details;
		DELETE FROM income_certificate_details;
		DELETE FROM income_right_details;
		DELETE FROM interbank_borrowing_details;
		DELETE FROM refinancing_details;
		DELETE FROM group_loan_details;
		DELETE FROM swap_facility_details;
		DELETE FROM workbook_notes;
	`);
}

export function dropLegacyImportStagingTables(db) {
	db.exec(`
		DROP TABLE IF EXISTS workbook_notes_staging;
		DROP TABLE IF EXISTS balance_staging;
		DROP TABLE IF EXISTS cashflow_staging;
		DROP TABLE IF EXISTS swap_staging;
		DROP TABLE IF EXISTS group_loan_schedules_staging;
		DROP TABLE IF EXISTS group_loan_staging;
		DROP TABLE IF EXISTS refinancing_staging;
		DROP TABLE IF EXISTS interbank_staging;
		DROP TABLE IF EXISTS income_right_schedules_staging;
		DROP TABLE IF EXISTS income_right_staging;
		DROP TABLE IF EXISTS income_certificate_staging;
		DROP TABLE IF EXISTS bond_schedules_staging;
		DROP TABLE IF EXISTS bond_details_staging;
		DROP TABLE IF EXISTS debt_import_staging;
		DROP TABLE IF EXISTS debt_import_upload;
	`);
}

export function migrateTypedDebtDetails(db) {
	createTypedDebtTables(db);
	if (db.prepare('SELECT 1 FROM schema_migrations WHERE version = 10').get()) return;
	const hasRecords = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'debt_records'").get();
	if (!hasRecords) {
		db.prepare('INSERT INTO schema_migrations (version) VALUES (10)').run();
		return;
	}
	const definitions = definitionsByType(db);
	const debtRecords = recordsByDebt(db, definitions);
	const debts = db.prepare('SELECT id, debt_type AS debtType FROM debts ORDER BY debt_type, id').all();
	const statements = typedDebtStatements(db);
	db.transaction(() => {
		clearTypedDebtTables(db);
		for (const debt of debts) insertTypedDebt(db, debt, debtRecords.get(debt.id) ?? [], statements);
		for (const row of db.prepare(`
			SELECT d.debt_type AS sheetName, r.value_0 AS content
			FROM debt_records r JOIN debts d ON d.id = r.debt_id
			WHERE r.value_0 IS NOT NULL AND (r.value_0 LIKE '注：%' OR r.value_0 LIKE '说明：%')
		`).all()) {
			db.prepare('INSERT OR REPLACE INTO workbook_notes (sheet_name, content) VALUES (?, ?)')
				.run(row.sheetName, row.content);
		}
		db.exec(`
			DROP TABLE debt_records;
			DROP TABLE debt_field_definitions;
		`);
		db.prepare('INSERT INTO schema_migrations (version) VALUES (10)').run();
	})();
}
