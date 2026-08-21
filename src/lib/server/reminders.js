// @ts-nocheck
import { randomUUID } from 'node:crypto';
import { Resend } from 'resend';

const DAY_MS = 86_400_000;
function parseDate(value) {
	return new Date(`${value}T00:00:00Z`);
}

function isoDate(value = new Date()) {
	return new Intl.DateTimeFormat('en-CA', {
		timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
	}).format(value);
}

function shouldDeliver(rule, triggerDate, deliveryDate) {
	const trigger = parseDate(triggerDate);
	const delivery = parseDate(deliveryDate);
	const first = new Date(trigger.getTime() - Number(rule.offsetDays) * DAY_MS);
	const elapsedDays = Math.round((delivery.getTime() - first.getTime()) / DAY_MS);
	if (elapsedDays < 0 || delivery > trigger) return false;
	if (rule.frequency === 'daily') return true;
	if (rule.frequency === 'weekly') return elapsedDays % 7 === 0;
	return elapsedDays === 0;
}

function recipientsFor(row) {
	if (row.recipientMode === 'owner') return row.ownerEmail ? [row.ownerEmail] : [];
	if (row.recipientMode === 'custom') {
		if (Array.isArray(row.recipients)) return row.recipients.map(String).filter(Boolean);
		return String(row.recipients ?? '')
			.split(/[;,，；\s]+/)
			.map((email) => email.trim())
			.filter(Boolean);
	}
	return row.assigneeEmail ? [row.assigneeEmail] : [];
}

function escapeHtml(value) {
	return String(value)
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#039;');
}

async function resolveDatabase(db) {
	if (db) return db;
	return (await import('./db.js')).getDatabase();
}

export async function collectDueReminders({ asOfDate = isoDate(), db } = {}) {
	db = await resolveDatabase(db);
	const rows = await db.prepare(`
		SELECT r.id AS ruleId, r.name AS ruleName, r.target_type AS targetType,
			r.debt_type AS ruleDebtType, r.trigger_field AS triggerField,
			r.offset_days AS offsetDays, r.frequency, r.recipient_mode AS recipientMode,
			r.recipients, pt.id AS targetId, pt.name AS taskName, p.name AS projectName,
			p.debt_type AS debtType,
			CASE r.trigger_field
				WHEN 'due_date' THEN pt.due_date
				WHEN 'planned_issue_date' THEN p.planned_issue_date
				WHEN 'planned_maturity_date' THEN p.planned_maturity_date
			END AS triggerDate,
			assignee.email AS assigneeEmail, owner.email AS ownerEmail
		FROM reminder_rules r
		JOIN project_tasks pt ON r.target_type = 'project_task' AND pt.status <> 'completed'
		JOIN projects p ON p.id = pt.project_id
		LEFT JOIN people assignee ON assignee.id = pt.assignee_id
		LEFT JOIN people owner ON owner.id = p.owner_id
		WHERE r.is_active = TRUE
			AND (r.debt_type IS NULL OR r.debt_type = p.debt_type)
			AND CASE r.trigger_field
				WHEN 'due_date' THEN pt.due_date
				WHEN 'planned_issue_date' THEN p.planned_issue_date
				WHEN 'planned_maturity_date' THEN p.planned_maturity_date
			END IS NOT NULL
	`).all();
	const reminders = [];

	for (const row of rows) {
		if (!shouldDeliver(row, row.triggerDate, asOfDate)) continue;
		const recipients = recipientsFor(row);
		if (!recipients.length) continue;
		reminders.push({
			ruleId: row.ruleId,
			ruleName: row.ruleName,
			targetType: row.targetType,
			targetId: row.targetId,
			projectName: row.projectName,
			taskName: row.taskName,
			debtType: row.debtType,
			triggerDate: row.triggerDate,
			deliveryDate: asOfDate,
			recipients
		});
	}
	return reminders;
}

export async function sendDueReminders({ asOfDate = isoDate(), dryRun = false, db, config = process.env } = {}) {
	db = await resolveDatabase(db);
	const reminders = await collectDueReminders({ asOfDate, db });
	const apiKey = config.RESEND_API_KEY;
	const from = config.FROM_EMAIL
		?? config.REMINDER_FROM_EMAIL
		?? '融资工作台 <onboarding@resend.dev>';
	const resend = apiKey ? new Resend(apiKey) : null;
	const results = [];
	const existingRows = reminders.length ? await db.prepare(`
		SELECT id, rule_id AS ruleId, target_id AS targetId, status
		FROM reminder_deliveries
		WHERE delivery_date = ?
	`).all(asOfDate) : [];
	const existingByTarget = new Map(existingRows.map((row) => [`${row.ruleId}:${row.targetId}`, row]));
	const deliveries = [];

	for (const reminder of reminders) {
		const existing = existingByTarget.get(`${reminder.ruleId}:${reminder.targetId}`);
		if (existing?.status === 'sent') {
			results.push({ ...reminder, status: 'skipped' });
			continue;
		}

		const deliveryId = existing?.id ?? randomUUID();
		if (dryRun || !resend) {
			deliveries.push({ ...reminder, id: deliveryId, status: 'pending', providerMessageId: null, errorMessage: null, sentAt: null });
			results.push({ ...reminder, status: 'pending' });
			continue;
		}

		try {
			const response = await resend.emails.send({
				from,
				to: reminder.recipients,
				subject: `【融资工作台】${reminder.projectName} · ${reminder.taskName}`,
				html: `<h2>${escapeHtml(reminder.ruleName)}</h2>
					<p>项目：${escapeHtml(reminder.projectName)}</p>
					<p>任务：${escapeHtml(reminder.taskName)}</p>
					<p>节点日期：${escapeHtml(reminder.triggerDate)}</p>
					<p>负债品种：${escapeHtml(reminder.debtType)}</p>`
			});
			if (response.error) throw new Error(response.error.message);
			deliveries.push({
				...reminder, id: deliveryId, status: 'sent', providerMessageId: response.data?.id ?? null,
				errorMessage: null, sentAt: new Date().toISOString()
			});
			results.push({ ...reminder, status: 'sent', messageId: response.data?.id ?? null });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			deliveries.push({
				...reminder, id: deliveryId, status: 'failed', providerMessageId: null,
				errorMessage: message, sentAt: null
			});
			results.push({ ...reminder, status: 'failed', error: message });
		}
	}
	if (deliveries.length) {
		await db.prepare(`
			INSERT INTO reminder_deliveries (
				id, rule_id, target_type, target_id, delivery_date, recipients, status,
				provider_message_id, error_message, sent_at
			)
			SELECT id, rule_id, target_type, target_id, delivery_date, recipients, status,
				provider_message_id, error_message, sent_at
			FROM jsonb_to_recordset(?::jsonb) AS source(
				id text, rule_id text, target_type text, target_id text, delivery_date date,
				recipients jsonb, status text, provider_message_id text, error_message text, sent_at timestamptz
			)
			ON CONFLICT(rule_id, target_id, delivery_date) DO UPDATE SET
				recipients = EXCLUDED.recipients, status = EXCLUDED.status,
				provider_message_id = EXCLUDED.provider_message_id,
				error_message = EXCLUDED.error_message, sent_at = EXCLUDED.sent_at
		`).run(JSON.stringify(deliveries.map((delivery) => ({
			id: delivery.id,
			rule_id: delivery.ruleId,
			target_type: delivery.targetType,
			target_id: delivery.targetId,
			delivery_date: delivery.deliveryDate,
			recipients: delivery.recipients,
			status: delivery.status,
			provider_message_id: delivery.providerMessageId,
			error_message: delivery.errorMessage,
			sent_at: delivery.sentAt
		}))));
	}
	return { asOfDate, dryRun: dryRun || !apiKey, count: reminders.length, results };
}
