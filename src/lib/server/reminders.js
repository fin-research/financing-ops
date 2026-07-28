// @ts-nocheck
import { randomUUID } from 'node:crypto';
import { Resend } from 'resend';
import { getDatabase } from './db.js';

const DAY_MS = 86_400_000;
const TRIGGER_COLUMNS = {
	due_date: 'pt.due_date',
	planned_issue_date: 'p.planned_issue_date',
	planned_maturity_date: 'p.planned_maturity_date'
};

function parseDate(value) {
	return new Date(`${value}T00:00:00Z`);
}

function isoDate(value = new Date()) {
	return value.toISOString().slice(0, 10);
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

export function collectDueReminders({ asOfDate = isoDate() } = {}) {
	const db = getDatabase();
	const rules = db.prepare(`
		SELECT id, name, target_type AS targetType, debt_type AS debtType,
			trigger_field AS triggerField, offset_days AS offsetDays, frequency,
			recipient_mode AS recipientMode, recipients
		FROM reminder_rules WHERE is_active = 1
	`).all();
	const reminders = [];

	for (const rule of rules) {
		if (rule.targetType !== 'project_task') continue;
		const triggerColumn = TRIGGER_COLUMNS[rule.triggerField];
		if (!triggerColumn) continue;
		const rows = db.prepare(`
			SELECT pt.id AS targetId, pt.name AS taskName, p.name AS projectName,
				p.debt_type AS debtType, ${triggerColumn} AS triggerDate,
				assignee.email AS assigneeEmail, owner.email AS ownerEmail
			FROM project_tasks pt
			JOIN projects p ON p.id = pt.project_id
			LEFT JOIN people assignee ON assignee.id = pt.assignee_id
			LEFT JOIN people owner ON owner.id = p.owner_id
			WHERE pt.status != 'completed' AND ${triggerColumn} IS NOT NULL
				${rule.debtType ? 'AND p.debt_type = @debtType' : ''}
		`).all(rule.debtType ? { debtType: rule.debtType } : {});

		for (const row of rows) {
			if (!shouldDeliver(rule, row.triggerDate, asOfDate)) continue;
			const recipients = recipientsFor({ ...row, ...rule });
			if (!recipients.length) continue;
			reminders.push({
				ruleId: rule.id,
				ruleName: rule.name,
				targetType: rule.targetType,
				targetId: row.targetId,
				projectName: row.projectName,
				taskName: row.taskName,
				debtType: row.debtType,
				triggerDate: row.triggerDate,
				deliveryDate: asOfDate,
				recipients
			});
		}
	}
	return reminders;
}

export async function sendDueReminders({ asOfDate = isoDate(), dryRun = false } = {}) {
	const db = getDatabase();
	const reminders = collectDueReminders({ asOfDate });
	const apiKey = process.env.RESEND_API_KEY;
	const from = process.env.FROM_EMAIL
		?? process.env.REMINDER_FROM_EMAIL
		?? '融资工作台 <onboarding@resend.dev>';
	const resend = apiKey ? new Resend(apiKey) : null;
	const results = [];

	for (const reminder of reminders) {
		const existing = db.prepare(`
			SELECT id, status FROM reminder_deliveries
			WHERE rule_id = ? AND target_id = ? AND delivery_date = ?
		`).get(reminder.ruleId, reminder.targetId, reminder.deliveryDate);
		if (existing?.status === 'sent') {
			results.push({ ...reminder, status: 'skipped' });
			continue;
		}

		const deliveryId = existing?.id ?? randomUUID();
		if (dryRun || !resend) {
			db.prepare(`
				INSERT INTO reminder_deliveries
					(id, rule_id, target_type, target_id, delivery_date, recipients, status)
				VALUES (?, ?, ?, ?, ?, ?, 'pending')
				ON CONFLICT(rule_id, target_id, delivery_date) DO UPDATE SET
					recipients = excluded.recipients, status = 'pending', error_message = NULL
			`).run(
				deliveryId,
				reminder.ruleId,
				reminder.targetType,
				reminder.targetId,
				reminder.deliveryDate,
				JSON.stringify(reminder.recipients)
			);
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
			db.prepare(`
				INSERT INTO reminder_deliveries
					(id, rule_id, target_type, target_id, delivery_date, recipients, status, provider_message_id, sent_at)
				VALUES (?, ?, ?, ?, ?, ?, 'sent', ?, CURRENT_TIMESTAMP)
				ON CONFLICT(rule_id, target_id, delivery_date) DO UPDATE SET
					recipients = excluded.recipients, status = 'sent',
					provider_message_id = excluded.provider_message_id,
					error_message = NULL, sent_at = CURRENT_TIMESTAMP
			`).run(
				deliveryId,
				reminder.ruleId,
				reminder.targetType,
				reminder.targetId,
				reminder.deliveryDate,
				JSON.stringify(reminder.recipients),
				response.data?.id ?? null
			);
			results.push({ ...reminder, status: 'sent', messageId: response.data?.id ?? null });
		} catch (error) {
			db.prepare(`
				INSERT INTO reminder_deliveries
					(id, rule_id, target_type, target_id, delivery_date, recipients, status, error_message)
				VALUES (?, ?, ?, ?, ?, ?, 'failed', ?)
				ON CONFLICT(rule_id, target_id, delivery_date) DO UPDATE SET
					recipients = excluded.recipients, status = 'failed', error_message = excluded.error_message
			`).run(
				deliveryId,
				reminder.ruleId,
				reminder.targetType,
				reminder.targetId,
				reminder.deliveryDate,
				JSON.stringify(reminder.recipients),
				error instanceof Error ? error.message : String(error)
			);
			results.push({ ...reminder, status: 'failed', error: error instanceof Error ? error.message : String(error) });
		}
	}
	return { asOfDate, dryRun: dryRun || !apiKey, count: reminders.length, results };
}
