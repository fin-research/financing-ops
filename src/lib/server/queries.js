// @ts-nocheck
import { getDatabase } from './db.js';

const number = (value) => Number(value ?? 0);

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

export function getSettingsData() {
	const db = getDatabase();
	return {
		people: db.prepare('SELECT id, name, email, role, active FROM people ORDER BY active DESC, name').all().map((person) => ({ ...person, active: Boolean(person.active) })),
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
		`).all().map((rule) => ({ ...rule, isActive: Boolean(rule.isActive) })),
		lastImport: db.prepare(`
			SELECT id, source_file AS sourceFile, status, started_at AS startedAt, finished_at AS finishedAt,
				inserted_count AS insertedCount, updated_count AS updatedCount, skipped_count AS skippedCount, error_message AS errorMessage
			FROM import_runs ORDER BY started_at DESC, rowid DESC LIMIT 1
		`).get() ?? null,
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

/** @param {{ fromDate?: string, toDate?: string, limit?: number }} [options] */
export function getHomeEvents({ fromDate, toDate, limit = 200 } = {}) {
	const db = getDatabase();
	const start = fromDate ?? new Date().toISOString().slice(0, 10);
	const end = toDate ?? start;
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
		LEFT JOIN people assignee ON assignee.id = pt.assignee_id
		WHERE pt.status != 'completed'
			AND pt.due_date BETWEEN @fromDate AND @toDate
		ORDER BY pt.due_date, p.name, pt.sort_order
		LIMIT @limit
	`).all({ fromDate: start, toDate: end, limit });

	const maturityEvents = db.prepare(`
		SELECT
			'maturity' AS eventType,
			MIN(id) AS id,
			maturity_date AS eventDate,
			debt_type AS debtType,
			COUNT(*) AS itemCount,
			COALESCE(SUM(COALESCE(outstanding_amount, principal_amount, 0)), 0) AS amount
		FROM debts
		WHERE maturity_date BETWEEN @fromDate AND @toDate
			AND status IN ('active', 'planned')
		GROUP BY maturity_date, debt_type
		ORDER BY maturity_date, debt_type
		LIMIT @limit
	`).all({ fromDate: start, toDate: end, limit });
	const interestEvents = db.prepare(`
		SELECT
			event_date AS eventDate,
			source_sheet AS debtType,
			COUNT(*) AS itemCount,
			COALESCE(SUM(amount), 0) AS amount
		FROM debt_cashflow_events
		WHERE event_type = 'interest'
			AND event_date BETWEEN @fromDate AND @toDate
		GROUP BY event_date, source_sheet
		ORDER BY event_date, source_sheet
		LIMIT @limit
	`).all({ fromDate: start, toDate: end, limit });

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
			href: `/settings#import`
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
			href: `/settings#import`
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
