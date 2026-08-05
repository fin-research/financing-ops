// @ts-nocheck
import { getDatabase } from './db.js';

const number = (value) => Number(value ?? 0);

const REPORTING_DEBT_TYPES = [
	'浮动收益凭证', '固定收益凭证', '小公募', '次级债', '私募债', '科创债',
	'短期融资券', '转融资', '集团借款', '同业拆借', '互换便利'
];

const REPORTING_TYPE_SQL = `CASE
	WHEN d.debt_type = '收益凭证' THEN COALESCE(d.category_level_2, '固定收益凭证')
	ELSE d.debt_type
END`;

const BOND_DEBT_TYPES = new Set(['小公募', '次级债', '私募债', '科创债', '短期融资券']);

function rawField(rawData, headers) {
	if (!rawData) return null;
	try {
		const fields = JSON.parse(rawData);
		const field = fields.find((item) => headers.includes(String(item.header ?? '').trim()));
		return field?.formatted || field?.value || null;
	} catch {
		return null;
	}
}

function calendarShortName(row) {
	const fallback = row.instrumentName || row.instrumentCode || row.debtType;
	if (row.debtType === '收益凭证') {
		return String(fallback).replace(/^东方财富证券(?:股份有限公司)?/u, '');
	}
	if (BOND_DEBT_TYPES.has(row.debtType)) {
		return rawField(row.rawData, ['债券简称', '证券简称']) || fallback;
	}
	return fallback;
}

function endOfPreviousMonth(date) {
	const value = new Date(`${date.slice(0, 7)}-01T00:00:00Z`);
	value.setUTCDate(0);
	return value.toISOString().slice(0, 10);
}

function endOfPreviousYear(date) {
	return `${Number(date.slice(0, 4)) - 1}-12-31`;
}

function latestCompletedMonthEnd(date) {
	const nextDay = addUtcDays(date, 1);
	return nextDay.slice(5, 7) !== date.slice(5, 7) ? date : endOfPreviousMonth(date);
}

function addUtcDays(date, days) {
	const value = new Date(`${date}T00:00:00Z`);
	value.setUTCDate(value.getUTCDate() + days);
	return value.toISOString().slice(0, 10);
}

function dateInShanghai() {
	return new Intl.DateTimeFormat('en-CA', {
		timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
	}).format(new Date());
}

function typeFilter(selectedTypes = [], alias = 'd') {
	if (!selectedTypes.length) return { clause: '', params: [] };
	const expression = REPORTING_TYPE_SQL.replaceAll('d.', `${alias}.`);
	return {
		clause: `AND ${expression} IN (${selectedTypes.map(() => '?').join(', ')})`,
		params: selectedTypes
	};
}

function pointInTimeDetail(db, asOfDate, selectedTypes = []) {
	const filter = typeFilter(selectedTypes);
	const row = db.prepare(`
		SELECT
			COALESCE(SUM(COALESCE(d.outstanding_amount, d.principal_amount, 0)), 0) / 100000000.0 AS balanceYi,
			COALESCE(SUM(CASE WHEN d.annual_rate IS NOT NULL THEN COALESCE(d.outstanding_amount, d.principal_amount, 0) * d.annual_rate END)
				/ NULLIF(SUM(CASE WHEN d.annual_rate IS NOT NULL THEN COALESCE(d.outstanding_amount, d.principal_amount, 0) END), 0), 0) AS weightedRate,
			COALESCE(SUM(CASE WHEN d.maturity_date IS NOT NULL THEN COALESCE(d.outstanding_amount, d.principal_amount, 0)
				* MAX(julianday(d.maturity_date) - julianday(?), 0) END)
				/ NULLIF(SUM(CASE WHEN d.maturity_date IS NOT NULL THEN COALESCE(d.outstanding_amount, d.principal_amount, 0) END), 0), 0) AS weightedRemainingDays
		FROM debts d
		WHERE d.status != 'closed'
			AND (d.issue_date IS NULL OR d.issue_date <= ?)
			AND (d.maturity_date IS NULL OR d.maturity_date > ?)
			${filter.clause}
	`).get(asOfDate, asOfDate, asOfDate, ...filter.params);
	return {
		balanceYi: number(row.balanceYi),
		weightedRate: number(row.weightedRate),
		weightedRemainingDays: number(row.weightedRemainingDays)
	};
}

function snapshotBalance(db, requestedDate, selectedTypes = []) {
	const snapshot = db.prepare(`
		SELECT MAX(as_of_date) AS asOfDate FROM debt_balance_daily WHERE as_of_date <= ?
	`).get(requestedDate);
	if (!snapshot?.asOfDate) return { asOfDate: null, balanceYi: 0 };
	const selected = new Set(selectedTypes);
	const includeAll = selected.size === 0;
	const rawTypes = includeAll
		? null
		: [...new Set([...selected].map((item) =>
			['浮动收益凭证', '固定收益凭证'].includes(item) ? '收益凭证' : item
		))];
	let balanceYi = 0;
	if (rawTypes === null) {
		balanceYi = number(db.prepare(`SELECT SUM(balance_yi) AS value FROM debt_balance_daily WHERE as_of_date = ?`).get(snapshot.asOfDate).value);
	} else if (rawTypes.length) {
		balanceYi = number(db.prepare(`
			SELECT SUM(balance_yi) AS value FROM debt_balance_daily
			WHERE as_of_date = ? AND debt_type IN (${rawTypes.map(() => '?').join(', ')})
		`).get(snapshot.asOfDate, ...rawTypes).value);
	}
	const includesFloating = includeAll || selected.has('浮动收益凭证');
	const includesFixed = includeAll || selected.has('固定收益凭证');
	if (!includeAll && includesFloating !== includesFixed) {
		const voucherTotal = number(db.prepare(`
			SELECT balance_yi AS value FROM debt_balance_daily WHERE as_of_date = ? AND debt_type = '收益凭证'
		`).get(snapshot.asOfDate)?.value);
		const subtype = includesFloating ? '浮动收益凭证' : '固定收益凭证';
		const subtypeBalance = pointInTimeDetail(db, snapshot.asOfDate, [subtype]).balanceYi;
		balanceYi += subtypeBalance - voucherTotal;
	}
	return { asOfDate: snapshot.asOfDate, balanceYi };
}

function financeParameterMap(db) {
	return Object.fromEntries(db.prepare(`
		SELECT code, label, value_yi AS valueYi, period_end AS periodEnd, notes
		FROM finance_parameters ORDER BY code
	`).all().map((item) => [item.code, { ...item, valueYi: item.valueYi == null ? null : number(item.valueYi) }]));
}

export function getDebtTypeOptions() {
	return [...REPORTING_DEBT_TYPES];
}

function filtersForDebt(filters = {}, tableAlias = 'd') {
	const where = [];
	const params = {};
	if (filters.debtType) {
		where.push(`${tableAlias}.debt_type = @debtType`);
		params.debtType = filters.debtType;
	}
	return { clause: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

function filtersForProject(filters = {}) {
	const where = [];
	const params = {};
	if (filters.debtType) {
		where.push('p.debt_type = @debtType');
		params.debtType = filters.debtType;
	}
	if (filters.personId) {
		where.push('(p.owner_id = @personId OR EXISTS (SELECT 1 FROM project_tasks pt WHERE pt.project_id = p.id AND pt.assignee_id = @personId))');
		params.personId = filters.personId;
	}
	if (filters.status) {
		where.push('p.status = @status');
		params.status = filters.status;
	}
	return { clause: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

function latestBalanceSnapshot(filters = {}) {
	const db = getDatabase();
	const asOfDate = filters.asOfDate ?? new Date().toISOString().slice(0, 10);
	const snapshot = db.prepare(`
		SELECT MAX(as_of_date) AS asOfDate
		FROM debt_balance_daily
		WHERE as_of_date <= @asOfDate
	`).get({ asOfDate });
	if (!snapshot?.asOfDate) return null;
	const params = { asOfDate: snapshot.asOfDate };
	const where = ['as_of_date = @asOfDate'];
	if (filters.debtType) {
		where.push('debt_type = @debtType');
		params.debtType = filters.debtType;
	}
	const balances = db.prepare(`
		SELECT debt_type AS debtType, balance_yi AS balanceYi, source_sheet AS sourceSheet, source_cell AS sourceCell
		FROM debt_balance_daily WHERE ${where.join(' AND ')} ORDER BY balance_yi DESC, debt_type
	`).all(params).map((item) => ({ ...item, balanceYi: number(item.balanceYi), outstandingAmount: number(item.balanceYi) * 100_000_000 }));
	return {
		asOfDate: snapshot.asOfDate,
		balances,
		totalYi: balances.reduce((sum, item) => sum + item.balanceYi, 0)
	};
}

export function getDashboardData(filters = {}) {
	const db = getDatabase();
	const debtFilters = filtersForDebt(filters);
	const projectFilters = filtersForProject(filters);
	const balanceSnapshot = latestBalanceSnapshot(filters);
	const debtSummary = db.prepare(`
		SELECT
			COALESCE(SUM(CASE WHEN status = 'active' THEN COALESCE(outstanding_amount, principal_amount, 0) ELSE 0 END), 0) AS outstandingAmount,
			COUNT(*) AS debtCount,
			COALESCE(AVG(CASE WHEN status = 'active' THEN annual_rate END), 0) AS averageAnnualRate,
			COALESCE(SUM(CASE WHEN maturity_date >= date('now') AND maturity_date < date('now', '+90 day') THEN COALESCE(outstanding_amount, principal_amount, 0) ELSE 0 END), 0) AS dueWithin90Days
		FROM debts d ${debtFilters.clause}
	`).get(debtFilters.params);

	const byDebtType = balanceSnapshot?.balances ?? db.prepare(`
		SELECT debt_type AS debtType, COUNT(*) AS count, COALESCE(SUM(COALESCE(outstanding_amount, principal_amount, 0)), 0) AS outstandingAmount
		FROM debts d ${debtFilters.clause ? `${debtFilters.clause} AND d.status = 'active'` : "WHERE d.status = 'active'"}
		GROUP BY debt_type ORDER BY outstandingAmount DESC, debtType
	`).all(debtFilters.params).map((row) => ({ ...row, count: number(row.count), outstandingAmount: number(row.outstandingAmount), balanceYi: number(row.outstandingAmount) / 100_000_000 }));

	const byMaturity = db.prepare(`
		SELECT
			CASE
				WHEN maturity_date IS NULL THEN '未登记到期日'
				WHEN maturity_date < date('now') THEN '已到期'
				WHEN maturity_date < date('now', '+90 day') THEN '90天内'
				WHEN maturity_date < date('now', '+365 day') THEN '90天至1年'
				ELSE '1年以上'
			END AS bucket,
			COUNT(*) AS count,
			COALESCE(SUM(COALESCE(outstanding_amount, principal_amount, 0)), 0) AS outstandingAmount
		FROM debts d ${debtFilters.clause}
		GROUP BY bucket
	`).all(debtFilters.params).map((row) => ({ ...row, count: number(row.count), outstandingAmount: number(row.outstandingAmount) }));

	const projectSummary = db.prepare(`
		SELECT
			COUNT(*) AS total,
			SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) AS inProgress,
			SUM(CASE WHEN status = 'at_risk' THEN 1 ELSE 0 END) AS atRisk
		FROM projects p ${projectFilters.clause}
	`).get(projectFilters.params);

	const upcomingTasks = db.prepare(`
		SELECT pt.id, pt.name, pt.status, pt.due_date AS dueDate, p.id AS projectId, p.name AS projectName, p.debt_type AS debtType, people.name AS assigneeName
		FROM project_tasks pt
		JOIN projects p ON p.id = pt.project_id
		LEFT JOIN people ON people.id = pt.assignee_id
		${projectFilters.clause.replaceAll('p.', 'p.')}
		${projectFilters.clause ? 'AND' : 'WHERE'} pt.status != 'completed' AND pt.due_date IS NOT NULL
		ORDER BY pt.due_date ASC LIMIT 12
	`).all(projectFilters.params);

	return {
		asOf: balanceSnapshot?.asOfDate ?? new Date().toISOString(),
		asOfDate: balanceSnapshot?.asOfDate ?? null,
		filters,
		metrics: {
			outstandingAmount: balanceSnapshot ? Number((balanceSnapshot.totalYi * 100_000_000).toFixed(0)) : number(debtSummary.outstandingAmount),
			outstandingBalanceYi: balanceSnapshot?.totalYi ?? number(debtSummary.outstandingAmount) / 100_000_000,
			debtCount: number(debtSummary.debtCount),
			averageAnnualRate: number(debtSummary.averageAnnualRate),
			dueWithin90Days: number(debtSummary.dueWithin90Days),
			projectTotal: number(projectSummary.total),
			projectInProgress: number(projectSummary.inProgress),
			projectAtRisk: number(projectSummary.atRisk)
		},
		balanceSnapshot: balanceSnapshot ? { asOfDate: balanceSnapshot.asOfDate, totalYi: balanceSnapshot.totalYi } : null,
		byDebtType,
		byMaturity,
		upcomingTasks
	};
}

/** @param {{ selectedTypes?: string[] }} [options] */
export function getFinancingDashboardData({ selectedTypes = [] } = {}) {
	const db = getDatabase();
	const currentSnapshot = snapshotBalance(db, '9999-12-31', selectedTypes);
	const asOfDate = currentSnapshot.asOfDate ?? dateInShanghai();
	const previousMonthDate = endOfPreviousMonth(asOfDate);
	const previousYearDate = endOfPreviousYear(asOfDate);
	const currentDetail = pointInTimeDetail(db, asOfDate, selectedTypes);
	const previousMonthDetail = pointInTimeDetail(db, previousMonthDate, selectedTypes);
	const previousYearDetail = pointInTimeDetail(db, previousYearDate, selectedTypes);
	const previousMonthBalance = snapshotBalance(db, previousMonthDate, selectedTypes).balanceYi;
	const previousYearBalance = snapshotBalance(db, previousYearDate, selectedTypes).balanceYi;
	const filter = typeFilter(selectedTypes);
	const today = dateInShanghai();
	const in30Days = addUtcDays(today, 30);

	const balances = db.prepare(`
		SELECT debt_type AS debtType, balance_yi AS balanceYi
		FROM debt_balance_daily WHERE as_of_date = ? AND balance_yi > 0
		ORDER BY balance_yi DESC, debt_type
	`).all(asOfDate).map((row) => ({ ...row, balanceYi: number(row.balanceYi) }));
	const voucherSubtypes = db.prepare(`
		SELECT COALESCE(category_level_2, '固定收益凭证') AS debtType,
			SUM(COALESCE(outstanding_amount, principal_amount, 0)) / 100000000.0 AS balanceYi
		FROM debts
		WHERE debt_type = '收益凭证' AND status != 'closed'
			AND (issue_date IS NULL OR issue_date <= ?) AND (maturity_date IS NULL OR maturity_date > ?)
		GROUP BY COALESCE(category_level_2, '固定收益凭证')
	`).all(asOfDate, asOfDate).map((row) => ({ ...row, balanceYi: number(row.balanceYi) }));
	const included = new Set(selectedTypes);
	const isIncluded = (type) => !included.size || included.has(type);
	const composition = [];
	for (const balance of balances) {
		if (balance.debtType === '收益凭证') {
			const amount = voucherSubtypes.filter((item) => isIncluded(item.debtType)).reduce((sum, item) => sum + item.balanceYi, 0);
			if (amount > 0) composition.push({ type: '收益凭证', amountYi: amount });
		} else if (isIncluded(balance.debtType)) {
			composition.push({ type: balance.debtType, amountYi: balance.balanceYi });
		}
	}

	const maturityMonths = Array.from({ length: 6 }, (_, index) => {
		const month = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
		month.setUTCMonth(month.getUTCMonth() + index);
		return month.toISOString().slice(0, 7);
	});
	const maturityRows = db.prepare(`
		SELECT substr(d.maturity_date, 1, 7) AS month,
			SUM(COALESCE(d.outstanding_amount, d.principal_amount, 0)) / 100000000.0 AS amountYi
		FROM debts d
		WHERE d.status != 'closed' AND substr(d.maturity_date, 1, 7) IN (${maturityMonths.map(() => '?').join(', ')})
			${filter.clause}
		GROUP BY substr(d.maturity_date, 1, 7)
	`).all(...maturityMonths, ...filter.params);
	const maturityMap = new Map(maturityRows.map((row) => [row.month, number(row.amountYi)]));

	const maturityDetails = db.prepare(`
		WITH interest AS (
			SELECT debt_external_key, event_date, SUM(amount) AS amount FROM (
				SELECT DISTINCT debt_external_key, event_date, amount, source_sheet,
					source_row, source_date_cell, source_amount_cell
				FROM debt_cashflow_events WHERE event_type = 'interest'
			) GROUP BY debt_external_key, event_date
		)
		SELECT d.id, d.external_key AS externalKey,
			COALESCE(d.instrument_name, d.instrument_code, d.debt_type) AS instrumentName,
			d.debt_type AS debtType, ${REPORTING_TYPE_SQL} AS reportingType,
			COALESCE(d.counterparty, '/') AS counterparty,
			COALESCE(d.outstanding_amount, d.principal_amount, 0) / 100000000.0 AS principalYi,
			COALESCE(i.amount, 0) / 100000000.0 AS interestYi,
			d.annual_rate AS annualRate, d.maturity_date AS dueDate
		FROM debts d LEFT JOIN interest i ON i.debt_external_key = d.external_key AND i.event_date = d.maturity_date
		WHERE d.status != 'closed' AND d.maturity_date > ? AND d.maturity_date <= ?
			AND (COALESCE(d.outstanding_amount, d.principal_amount, 0) > 0 OR COALESCE(i.amount, 0) > 0)
			${filter.clause}
		ORDER BY d.maturity_date, d.debt_type, d.instrument_name
	`).all(today, in30Days, ...filter.params).map((row) => ({
		...row, principalYi: number(row.principalYi), interestYi: number(row.interestYi),
		annualRate: row.annualRate == null ? null : number(row.annualRate)
	}));
	const standaloneInterest = db.prepare(`
		WITH unique_interest AS (
			SELECT MIN(id) AS id, debt_external_key, event_date, amount, source_sheet
			FROM debt_cashflow_events WHERE event_type = 'interest'
			GROUP BY debt_external_key, event_date, amount, source_sheet,
				source_row, source_date_cell, source_amount_cell
		)
		SELECT e.id, d.id AS debtId, COALESCE(d.instrument_name, d.instrument_code, e.source_sheet) || '-利息' AS instrumentName,
			e.source_sheet AS debtType, ${REPORTING_TYPE_SQL} AS reportingType,
			'/' AS counterparty, NULL AS principalYi, e.amount / 100000000.0 AS interestYi,
			d.annual_rate AS annualRate, e.event_date AS dueDate
		FROM unique_interest e LEFT JOIN debts d ON d.external_key = e.debt_external_key
		WHERE e.event_date > ? AND e.event_date <= ?
			AND (d.maturity_date IS NULL OR d.maturity_date != e.event_date) ${filter.clause}
		ORDER BY e.event_date, e.source_sheet
	`).all(today, in30Days, ...filter.params).map((row) => ({
		...row, principalYi: null, interestYi: number(row.interestYi),
		annualRate: row.annualRate == null ? null : number(row.annualRate)
	}));
	const dueRows = [...maturityDetails, ...standaloneInterest]
		.sort((left, right) => left.dueDate.localeCompare(right.dueDate) || left.instrumentName.localeCompare(right.instrumentName));

	const projects = db.prepare(`
		SELECT id, name, debt_type AS debtType, COALESCE(borrower, '/') AS counterparty,
			amount / 100000000.0 AS amountYi,
			COALESCE(notes, CASE WHEN planned_maturity_date IS NOT NULL AND planned_issue_date IS NOT NULL
				THEN CAST(ROUND((julianday(planned_maturity_date) - julianday(planned_issue_date)) / 365.0, 1) AS TEXT) || 'Y'
				ELSE '待定' END) AS tenor,
			'待定' AS cost, planned_issue_date AS landingDate, status
		FROM projects
		WHERE status IN ('planning', 'in_progress', 'at_risk')
		ORDER BY planned_issue_date, name
	`).all().filter((project) => !selectedTypes.length || selectedTypes.includes(project.debtType)).map((project) => ({
		...project, amountYi: number(project.amountYi)
	}));

	const currentMonth = endOfPreviousMonth(asOfDate).slice(0, 7);
	const comparisonMonth = `${Number(currentMonth.slice(0, 4)) - 1}-${currentMonth.slice(5, 7)}`;
	const issuanceTypes = [
		{ label: '公募次级', types: ['次级债'] },
		{ label: '小公募', types: ['小公募'] },
		{ label: '私募债', types: ['私募债'] },
		{ label: '短融', types: ['短期融资券'] }
	];
	const issuanceValue = (month, types) => number(db.prepare(`
		SELECT SUM(principal_amount) / 100000000.0 AS value FROM debts
		WHERE status != 'closed' AND substr(issue_date, 1, 7) = ?
			AND debt_type IN (${types.map(() => '?').join(', ')})
	`).get(month, ...types).value);
	const monthlyIssuance = {
		currentMonth,
		comparisonMonth,
		rows: issuanceTypes.map((item) => ({
			label: item.label,
			currentYi: issuanceValue(currentMonth, item.types),
			comparisonYi: issuanceValue(comparisonMonth, item.types)
		}))
	};

	const parameters = financeParameterMap(db);
	const yearStart = `${asOfDate.slice(0, 4)}-01-01`;
	const issuanceFilter = typeFilter(selectedTypes);
	const borrowing = db.prepare(`
		SELECT MAX(COALESCE(d.principal_amount, 0)) / 100000000.0 AS largestYi
		FROM debts d WHERE d.status != 'closed' AND d.issue_date >= ? AND d.issue_date <= ? ${issuanceFilter.clause}
	`).get(yearStart, asOfDate, ...issuanceFilter.params);
	const cumulativeBorrowingDate = latestCompletedMonthEnd(asOfDate);
	const monthEndBalance = snapshotBalance(db, cumulativeBorrowingDate, selectedTypes);
	const cumulativeBorrowingYi = monthEndBalance.balanceYi - previousYearBalance;
	const shortDebt = db.prepare(`
		SELECT SUM(COALESCE(d.outstanding_amount, d.principal_amount, 0)) / 100000000.0 AS value
		FROM debts d WHERE d.status != 'closed'
			AND (d.issue_date IS NULL OR d.issue_date <= ?) AND d.maturity_date > ?
			AND julianday(d.maturity_date) - julianday(?) <= 365
			AND d.debt_type IN ('收益凭证', '短期融资券', '同业拆借', '小公募', '次级债', '私募债', '科创债')
	`).get(asOfDate, asOfDate, asOfDate);
	const securitiesNetAssets = parameters.securities_prior_year_net_assets?.valueYi;
	const groupNetAssets = parameters.group_prior_year_net_assets?.valueYi;
	const netCapital = parameters.prior_month_net_capital?.valueYi;
	const ratio = (numerator, denominator) => denominator ? number(numerator) / denominator * 100 : null;
	const projectAmountYi = projects.reduce((sum, item) => sum + item.amountYi, 0);

	return {
		asOfDate, today, selectedTypes, typeOptions: getDebtTypeOptions(),
		metrics: {
			balanceYi: currentSnapshot.balanceYi,
			balanceMonthChangeYi: currentSnapshot.balanceYi - previousMonthBalance,
			balanceYearChangeYi: currentSnapshot.balanceYi - previousYearBalance,
			weightedRatePct: currentDetail.weightedRate * 100,
			weightedRateMonthBp: (currentDetail.weightedRate - previousMonthDetail.weightedRate) * 10000,
			weightedRateYearBp: (currentDetail.weightedRate - previousYearDetail.weightedRate) * 10000,
			weightedRemainingDays: currentDetail.weightedRemainingDays,
			remainingMonthChangeDays: currentDetail.weightedRemainingDays - previousMonthDetail.weightedRemainingDays,
			remainingYearChangeDays: currentDetail.weightedRemainingDays - previousYearDetail.weightedRemainingDays,
			due30Yi: dueRows.reduce((sum, item) => sum + number(item.principalYi) + item.interestYi, 0),
			projectAmountYi,
			shortDebtRatio: ratio(number(shortDebt.value), netCapital),
			largestBorrowingRatio: ratio(number(borrowing.largestYi), securitiesNetAssets),
			cumulativeSecuritiesRatio: ratio(cumulativeBorrowingYi, securitiesNetAssets),
			cumulativeGroupRatio: ratio(cumulativeBorrowingYi, groupNetAssets),
			shortDebtYi: number(shortDebt.value),
			largestBorrowingYi: number(borrowing.largestYi),
			cumulativeBorrowingYi,
			cumulativeBorrowingDate: monthEndBalance.asOfDate ?? cumulativeBorrowingDate
		},
		parameters,
		composition,
		maturityDistribution: maturityMonths.map((month) => ({ month, amountYi: maturityMap.get(month) ?? 0 })),
		dueRows,
		projects,
		monthlyIssuance
	};
}

export function getProjectGanttData(filters = {}) {
	const db = getDatabase();
	const { clause, params } = filtersForProject(filters);
	const projects = db.prepare(`
		SELECT p.id, p.code, p.name, p.debt_type AS debtType, p.status, p.planned_start_date AS plannedStartDate,
			p.planned_issue_date AS plannedIssueDate, p.planned_maturity_date AS plannedMaturityDate, p.amount,
			owner.name AS ownerName
		FROM projects p LEFT JOIN people owner ON owner.id = p.owner_id
		${clause} ORDER BY COALESCE(p.planned_start_date, p.planned_issue_date), p.name
	`).all(params);
	const taskRows = db.prepare(`
		SELECT pt.id, pt.project_id AS projectId, pt.name, pt.status, pt.planned_start_date AS plannedStartDate,
			pt.due_date AS dueDate, pt.completed_at AS completedAt, pt.sort_order AS sortOrder, assignee.name AS assigneeName
		FROM project_tasks pt LEFT JOIN people assignee ON assignee.id = pt.assignee_id
		ORDER BY pt.sort_order, pt.due_date
	`).all();
	const tasksByProject = new Map();
	for (const task of taskRows) {
		const tasks = tasksByProject.get(task.projectId) ?? [];
		tasks.push(task);
		tasksByProject.set(task.projectId, tasks);
	}
	return {
		filters,
		projects: projects.map((project) => ({ ...project, amount: project.amount == null ? null : number(project.amount), tasks: tasksByProject.get(project.id) ?? [] }))
	};
}

function debtLimitUsage(db, config, asOfDate) {
	const mappedType = config.debtType === '公募次级' ? '次级债' : config.debtType;
	if (config.usageBasis === 'since_approval') {
		return number(db.prepare(`
			SELECT SUM(COALESCE(principal_amount, 0)) / 100000000.0 AS value
			FROM debts WHERE status != 'closed' AND debt_type = ?
				AND issue_date >= ? AND issue_date <= ?
		`).get(mappedType, config.approvedDate ?? '0000-01-01', asOfDate).value);
	}
	return number(db.prepare(`
		SELECT balance_yi AS value FROM debt_balance_daily
		WHERE as_of_date = ? AND debt_type = ?
	`).get(asOfDate, mappedType === '公募次级' ? '次级债' : mappedType)?.value);
}

export function getWorkbenchData() {
	const db = getDatabase();
	const snapshot = snapshotBalance(db, '9999-12-31');
	const asOfDate = snapshot.asOfDate ?? dateInShanghai();
	const today = dateInShanghai();
	const monthStart = `${today.slice(0, 7)}-01`;
	const nextMonth = new Date(`${monthStart}T00:00:00Z`);
	nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
	const monthEnd = addUtcDays(nextMonth.toISOString().slice(0, 10), -1);
	const debtEvents = db.prepare(`
		WITH interest AS (
			SELECT debt_external_key, event_date, SUM(amount) AS amount FROM (
				SELECT DISTINCT debt_external_key, event_date, amount, source_sheet,
					source_row, source_date_cell, source_amount_cell
				FROM debt_cashflow_events WHERE event_type = 'interest'
			) GROUP BY debt_external_key, event_date
		)
		SELECT d.id, d.maturity_date AS date, d.debt_type AS debtType,
			${REPORTING_TYPE_SQL} AS filterType,
			d.instrument_name AS instrumentName, d.instrument_code AS instrumentCode, d.raw_data AS rawData,
			COALESCE(d.outstanding_amount, d.principal_amount, 0) / 100000000.0 AS principalYi,
			COALESCE(i.amount, 0) / 100000000.0 AS interestYi
		FROM debts d LEFT JOIN interest i ON i.debt_external_key = d.external_key AND i.event_date = d.maturity_date
		WHERE d.status != 'closed' AND d.maturity_date BETWEEN ? AND ?
			AND (COALESCE(d.outstanding_amount, d.principal_amount, 0) > 0 OR COALESCE(i.amount, 0) > 0)
		ORDER BY d.maturity_date, d.debt_type, d.instrument_name
	`).all(monthStart, monthEnd).map((row) => {
		const shortName = calendarShortName(row);
		return {
		id: `maturity:${row.id}`,
		debtId: row.id,
		date: row.date,
		debtType: row.debtType,
		filterType: row.filterType,
		shortName,
		tone: row.debtType === '收益凭证' ? 'violet' : row.debtType === '短期融资券' ? 'teal' : row.debtType === '同业拆借' ? 'orange' : 'blue',
		title: `${shortName}•到期本息 ${(number(row.principalYi) + number(row.interestYi)).toFixed(2)}亿元`,
		href: `/debts/${row.id}`,
		amountYi: number(row.principalYi) + number(row.interestYi)
	};
	});
	const interestEvents = db.prepare(`
		WITH unique_interest AS (
			SELECT MIN(id) AS id, debt_external_key, event_date, amount, source_sheet
			FROM debt_cashflow_events WHERE event_type = 'interest'
			GROUP BY debt_external_key, event_date, amount, source_sheet,
				source_row, source_date_cell, source_amount_cell
		)
		SELECT e.id, d.id AS debtId, e.event_date AS date, e.source_sheet AS debtType,
			${REPORTING_TYPE_SQL} AS filterType,
			d.instrument_name AS instrumentName, d.instrument_code AS instrumentCode, d.raw_data AS rawData,
			e.amount / 100000000.0 AS amountYi
		FROM unique_interest e LEFT JOIN debts d ON d.external_key = e.debt_external_key
		WHERE e.event_date BETWEEN ? AND ?
			AND (d.maturity_date IS NULL OR d.maturity_date != e.event_date)
		ORDER BY e.event_date, e.source_sheet
	`).all(monthStart, monthEnd).map((row) => {
		const shortName = calendarShortName(row);
		return {
		id: `interest:${row.id}`,
		debtId: row.debtId,
		date: row.date,
		debtType: row.debtType,
		filterType: row.filterType ?? row.debtType,
		shortName,
		tone: 'orange',
		title: `${shortName}•年度付息 ${number(row.amountYi).toFixed(2)}亿元`,
		href: row.debtId ? `/debts/${row.debtId}` : '/data',
		amountYi: number(row.amountYi)
	};
	});
	const projectEvents = db.prepare(`
		SELECT id, planned_issue_date AS date, debt_type AS debtType, name, amount / 100000000.0 AS amountYi
		FROM projects WHERE status IN ('planning', 'in_progress', 'at_risk') AND planned_issue_date BETWEEN ? AND ?
		ORDER BY planned_issue_date, name
	`).all(monthStart, monthEnd).map((row) => ({
		id: `project:${row.id}`,
		date: row.date,
		debtType: row.debtType,
		filterType: row.debtType,
		shortName: row.name,
		tone: 'blue',
		title: `${row.name}•簿记发行${number(row.amountYi) ? ` ${number(row.amountYi).toFixed(2)}亿元` : ''}`,
		href: `/projects/${row.id}`,
		amountYi: number(row.amountYi)
	}));
	const events = [...debtEvents, ...interestEvents, ...projectEvents]
		.sort((left, right) => left.date.localeCompare(right.date) || left.title.localeCompare(right.title));

	const limits = db.prepare(`
		SELECT debt_type AS debtType, limit_yi AS limitYi, usage_basis AS usageBasis,
			approved_date AS approvedDate, expiry_date AS expiryDate,
			calculation_mode AS calculationMode, sort_order AS sortOrder
		FROM debt_limit_configs ORDER BY sort_order, debt_type
	`).all();
	const parameters = financeParameterMap(db);
	const effectiveLimits = limits.map((item) => {
		const configured = number(item.limitYi);
		const calculated = item.calculationMode === 'net_capital_60' && parameters.prior_month_net_capital?.valueYi != null
			? parameters.prior_month_net_capital.valueYi * 0.6
			: configured;
		const issuedYi = debtLimitUsage(db, item, asOfDate);
		return {
			...item,
			limitYi: calculated,
			configuredLimitYi: configured,
			issuedYi,
			remainingYi: calculated - issuedYi,
			needsNetCapitalUpdate: item.calculationMode === 'net_capital_60'
				&& (!parameters.prior_month_net_capital?.periodEnd || parameters.prior_month_net_capital.periodEnd < endOfPreviousMonth(today))
		};
	});
	const limitTotals = effectiveLimits.reduce((total, item) => ({
		limitYi: total.limitYi + item.limitYi,
		issuedYi: total.issuedYi + item.issuedYi,
		remainingYi: total.remainingYi + item.remainingYi
	}), { limitYi: 0, issuedYi: 0, remainingYi: 0 });
	const summaryGroups = [
		{ label: '公司债券', types: ['小公募', '私募债', '科创债'] },
		{ label: '次级债', types: ['次级债'] },
		{ label: '短融', types: ['短期融资券'] },
		{ label: '固定收益凭证', types: ['固定收益凭证'] },
		{ label: '转融资', types: ['转融资'] },
		{ label: '集团借款', types: ['集团借款'] }
	];
	const monthMaturitySummary = summaryGroups.map((group) => ({
		label: group.label,
		amountYi: debtEvents.filter((event) => group.types.includes(event.filterType)).reduce((sum, event) => sum + event.amountYi, 0)
	}));

	return {
		asOfDate, today, calendarMonth: today.slice(0, 7), typeOptions: getDebtTypeOptions(),
		events, monthMaturitySummary, limits: effectiveLimits, limitTotals,
		financeParameterReminder: effectiveLimits.some((item) => item.needsNetCapitalUpdate)
	};
}

export function getDebtDetail(id) {
	const db = getDatabase();
	const debt = db.prepare(`
		SELECT id, external_key AS externalKey, debt_type AS debtType,
			category_level_1 AS categoryLevel1, category_level_2 AS categoryLevel2,
			instrument_name AS instrumentName, instrument_code AS instrumentCode,
			borrower, counterparty, principal_amount AS principalAmount,
			outstanding_amount AS outstandingAmount, currency, annual_rate AS annualRate,
			issue_date AS issueDate, maturity_date AS maturityDate, status,
			source_sheet AS sourceSheet, source_row AS sourceRow, source_file AS sourceFile, raw_data AS rawData
		FROM debts WHERE id = ?
	`).get(id);
	if (!debt) return null;
	let sourceFields = [];
	try { sourceFields = JSON.parse(debt.rawData ?? '[]'); } catch { sourceFields = []; }
	const cashflows = db.prepare(`
		SELECT id, event_type AS eventType, event_date AS eventDate, amount,
			source_date_cell AS sourceDateCell, source_amount_cell AS sourceAmountCell
		FROM debt_cashflow_events WHERE debt_external_key = ? ORDER BY event_date, event_type
	`).all(debt.externalKey).map((item) => ({ ...item, amount: item.amount == null ? null : number(item.amount) }));
	return {
		...debt,
		principalAmount: debt.principalAmount == null ? null : number(debt.principalAmount),
		outstandingAmount: debt.outstandingAmount == null ? null : number(debt.outstandingAmount),
		annualRate: debt.annualRate == null ? null : number(debt.annualRate),
		sourceFields,
		cashflows
	};
}

export function getWorkflowSettingsData() {
	const db = getDatabase();
	return {
		sopTemplates: db.prepare(`
			SELECT st.id, st.name, st.debt_type AS debtType, st.description, st.is_active AS isActive,
				COUNT(sn.id) AS nodeCount
			FROM sop_templates st LEFT JOIN sop_nodes sn ON sn.template_id = st.id
			GROUP BY st.id ORDER BY st.debt_type, st.name
		`).all().map((template) => ({ ...template, isActive: Boolean(template.isActive), nodeCount: number(template.nodeCount) })),
		reminderRules: db.prepare(`
			SELECT id, name, target_type AS targetType, debt_type AS debtType, trigger_field AS triggerField,
				offset_days AS offsetDays, frequency, channel, recipient_mode AS recipientMode, recipients, is_active AS isActive
			FROM reminder_rules ORDER BY is_active DESC, name
		`).all().map((rule) => ({ ...rule, isActive: Boolean(rule.isActive) }))
	};
}

export function getDataImportData() {
	const db = getDatabase();
	const currentSnapshot = db.prepare(`
		SELECT as_of_date AS asOfDate, SUM(balance_yi) AS totalYi, MAX(source_file) AS sourceFile
		FROM debt_balance_daily
		WHERE as_of_date = (SELECT MAX(as_of_date) FROM debt_balance_daily)
		GROUP BY as_of_date
	`).get() ?? null;
	return {
		financeParameters: db.prepare(`
			SELECT code, label, value_yi AS valueYi, period_end AS periodEnd, notes
			FROM finance_parameters ORDER BY
				CASE code WHEN 'securities_prior_year_net_assets' THEN 1
					WHEN 'group_prior_year_net_assets' THEN 2 ELSE 3 END
		`).all().map((item) => ({ ...item, valueYi: item.valueYi == null ? null : number(item.valueYi) })),
		lastImport: db.prepare(`
			SELECT id, source_file AS sourceFile, status, started_at AS startedAt, finished_at AS finishedAt,
				inserted_count AS insertedCount, updated_count AS updatedCount, skipped_count AS skippedCount, error_message AS errorMessage
			FROM import_runs ORDER BY started_at DESC, rowid DESC LIMIT 1
		`).get() ?? null,
		currentSnapshot: currentSnapshot ? { ...currentSnapshot, totalYi: number(currentSnapshot.totalYi) } : null,
		importStats: {
			debtCount: number(db.prepare('SELECT COUNT(*) AS count FROM debts').get().count),
			sourceRowCount: number(db.prepare('SELECT COUNT(*) AS count FROM debt_source_rows').get().count),
			cashflowEventCount: number(db.prepare('SELECT COUNT(*) AS count FROM debt_cashflow_events').get().count),
			historyBalanceRowCount: number(db.prepare('SELECT COUNT(*) AS count FROM debt_balance_history').get().count),
			historyDateCount: number(db.prepare('SELECT COUNT(DISTINCT as_of_date) AS count FROM debt_balance_daily').get().count),
			historySpan: db.prepare(`
				SELECT MIN(as_of_date) AS startDate, MAX(as_of_date) AS endDate
				FROM debt_balance_history
			`).get()
		}
	};
}

export function getPeopleAccessData() {
	const db = getDatabase();
	return {
		people: db.prepare(`
			SELECT id, name, email, role, active
			FROM people
			ORDER BY active DESC, name
		`).all().map((person) => ({ ...person, active: Boolean(person.active) })),
		accounts: db.prepare(`
			SELECT id, username, role, active, last_login_at AS lastLoginAt
			FROM auth_users
			ORDER BY active DESC, username
		`).all().map((account) => ({ ...account, active: Boolean(account.active) }))
	};
}

export function getSettingsData() {
	return {
		...getWorkflowSettingsData(),
		...getDataImportData(),
		...getPeopleAccessData()
	};
}

const SOP_EVENT_DEBT_TYPE_SCOPE = {
	公司债: ['公司债', '小公募', '私募债', '次级债']
};

function getActiveSopEventDebtTypes(db) {
	const activeTypes = db.prepare(`
		SELECT DISTINCT debt_type AS debtType
		FROM sop_templates
		WHERE is_active = 1
	`).all();
	return [
		...new Set(
			activeTypes.flatMap(({ debtType }) => SOP_EVENT_DEBT_TYPE_SCOPE[debtType] ?? [debtType])
		)
	];
}

export function getActiveSopDebtTypeOptions() {
	return getActiveSopEventDebtTypes(getDatabase());
}

/** @param {{ fromDate?: string, toDate?: string, limit?: number }} [options] */
export function getHomeEvents({ fromDate, toDate, limit = 200 } = {}) {
	const db = getDatabase();
	const start = fromDate ?? new Date().toISOString().slice(0, 10);
	const end = toDate ?? start;
	const activeDebtTypes = getActiveSopEventDebtTypes(db);
	const debtTypePlaceholders = activeDebtTypes.map(() => '?').join(', ');
	const taskEvents = db.prepare(`
		SELECT
			'task' AS eventType,
			pt.id,
			pt.due_date AS eventDate,
			pt.name AS title,
			pt.status,
			p.id AS projectId,
			p.name AS projectName,
			p.debt_type AS debtType,
			assignee.name AS ownerName
		FROM project_tasks pt
		JOIN projects p ON p.id = pt.project_id
		JOIN sop_templates st ON st.id = p.sop_template_id AND st.is_active = 1
		LEFT JOIN people assignee ON assignee.id = pt.assignee_id
		WHERE pt.status != 'completed'
			AND pt.due_date BETWEEN @fromDate AND @toDate
		ORDER BY pt.due_date, p.name, pt.sort_order
		LIMIT @limit
	`).all({ fromDate: start, toDate: end, limit });

	const maturityEvents = activeDebtTypes.length ? db.prepare(`
		SELECT
			'maturity' AS eventType,
			MIN(id) AS id,
			maturity_date AS eventDate,
			debt_type AS debtType,
			COUNT(*) AS itemCount,
			COALESCE(SUM(COALESCE(outstanding_amount, principal_amount, 0)), 0) AS amount
		FROM debts
		WHERE maturity_date BETWEEN ? AND ?
			AND status IN ('active', 'planned')
			AND debt_type IN (${debtTypePlaceholders})
		GROUP BY maturity_date, debt_type
		ORDER BY maturity_date, debt_type
		LIMIT ?
	`).all(start, end, ...activeDebtTypes, limit) : [];
	const interestEvents = activeDebtTypes.length ? db.prepare(`
		SELECT
			event_date AS eventDate,
			source_sheet AS debtType,
			COUNT(*) AS itemCount,
			COALESCE(SUM(amount), 0) AS amount
		FROM debt_cashflow_events
		WHERE event_type = 'interest'
			AND event_date BETWEEN ? AND ?
			AND source_sheet IN (${debtTypePlaceholders})
		GROUP BY event_date, source_sheet
		ORDER BY event_date, source_sheet
		LIMIT ?
	`).all(start, end, ...activeDebtTypes, limit) : [];

	return [
		...taskEvents.map((event) => ({
			id: `task:${event.id}`,
			type: 'task',
			date: event.eventDate,
			title: `${event.projectName} · ${event.title}`,
			shortTitle: event.title,
			meta: `${event.debtType} · ${event.ownerName ? `负责人：${event.ownerName}` : '待分配'}`,
			debtType: event.debtType,
			owner: event.ownerName,
			tone: event.status === 'blocked' ? 'red' : 'blue',
			level: event.status === 'blocked' ? 'danger' : 'info',
			href: `/projects/${event.projectId}`
		})),
		...maturityEvents.map((event) => ({
			id: `maturity:${event.eventDate}:${event.debtType}`,
			type: 'maturity',
			date: event.eventDate,
			title: `${event.debtType}到期 ${number(event.itemCount)} 笔`,
			shortTitle: `${event.debtType}到期 ${number(event.itemCount)} 笔`,
			meta: number(event.amount) > 0
				? `合计 ${(number(event.amount) / 100_000_000).toFixed(2)} 亿元`
				: '金额口径未登记',
			debtType: event.debtType,
			owner: null,
			tone: 'red',
			level: 'danger',
			href: `/data`
		})),
		...interestEvents.map((event) => ({
			id: `interest:${event.eventDate}:${event.debtType}`,
			type: 'interest',
			date: event.eventDate,
			title: `${event.debtType}付息 ${number(event.itemCount)} 笔`,
			shortTitle: `${event.debtType}付息 ${number(event.itemCount)} 笔`,
			meta: `合计 ${(number(event.amount) / 100_000_000).toFixed(4)} 亿元`,
			debtType: event.debtType,
			owner: null,
			tone: 'orange',
			level: 'warning',
			href: `/data`
		}))
	].sort((left, right) => left.date.localeCompare(right.date) || left.title.localeCompare(right.title));
}

/** @param {{ status?: string, query?: string, limit?: number }} [options] */
export function getReminderHistory({ status, query, limit = 100 } = {}) {
	const db = getDatabase();
	const where = [];
	const params = { limit };
	if (status && ['pending', 'sent', 'failed'].includes(status)) {
		where.push('rd.status = @status');
		params.status = status;
	}
	if (query) {
		where.push(`(
			rr.name LIKE @query OR rd.target_id LIKE @query OR rd.recipients LIKE @query
			OR COALESCE(rd.error_message, '') LIKE @query
		)`);
		params.query = `%${query}%`;
	}
	const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
	const rows = db.prepare(`
		SELECT
			rd.id,
			rd.delivery_date AS deliveryDate,
			rd.target_type AS targetType,
			rd.target_id AS targetId,
			rd.recipients,
			rd.status,
			rd.provider_message_id AS providerMessageId,
			rd.error_message AS errorMessage,
			rd.created_at AS createdAt,
			rd.sent_at AS sentAt,
			rr.name AS ruleName
		FROM reminder_deliveries rd
		JOIN reminder_rules rr ON rr.id = rd.rule_id
		${clause}
		ORDER BY rd.delivery_date DESC, rd.created_at DESC
		LIMIT @limit
	`).all(params).map((row) => {
		let recipients = [];
		try {
			recipients = JSON.parse(row.recipients ?? '[]');
		} catch {
			recipients = String(row.recipients ?? '').split(',').filter(Boolean);
		}
		return { ...row, recipients };
	});
	const summary = db.prepare(`
		SELECT
			COUNT(*) AS total,
			SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS sent,
			SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
			SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
		FROM reminder_deliveries
	`).get();
	return {
		rows,
		summary: {
			total: number(summary.total),
			sent: number(summary.sent),
			pending: number(summary.pending),
			failed: number(summary.failed)
		}
	};
}
