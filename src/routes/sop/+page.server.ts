import { randomUUID } from 'node:crypto';
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getDatabase } from '$lib/server/db.js';
import { getWorkflowSettingsData } from '$lib/server/queries.js';
import { auditRequestMeta, prepareAudit } from '$lib/server/audit.js';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const load: PageServerLoad = async () => ({
	settings: await getWorkflowSettingsData()
});

export const actions: Actions = {
	createReminder: async (event) => {
		const data = await event.request.formData();
		const name = String(data.get('name') ?? '').trim();
		const triggerField = String(data.get('triggerField') ?? 'due_date');
		const offsetDays = Number(data.get('offsetDays') ?? 3);
		const frequency = String(data.get('frequency') ?? 'once');
		const recipientMode = String(data.get('recipientMode') ?? 'assignee');
		const recipients = String(data.get('recipients') ?? '').trim();
		const customRecipients = recipients.split(/[;,，；\s]+/).filter(Boolean);
		if (!name || !Number.isInteger(offsetDays) || offsetDays < 0 || offsetDays > 365) {
			return fail(400, { message: '提醒规则参数无效' });
		}
		if (!['once', 'daily', 'weekly'].includes(frequency)) return fail(400, { message: '提醒频率无效' });
		if (!['assignee', 'owner', 'custom'].includes(recipientMode)) return fail(400, { message: '收件人类型无效' });
		if (recipientMode === 'custom') {
			if (!customRecipients.length || customRecipients.some((email) => !emailPattern.test(email))) {
				return fail(400, { message: '请填写有效的指定收件邮箱' });
			}
		}
		const db = getDatabase();
		const id = randomUUID();
		await db.batch([db.prepare(`
			INSERT INTO reminder_rules (
				id, name, target_type, debt_type, trigger_field, offset_days,
				frequency, channel, recipient_mode, recipients, is_active
			) VALUES (?, ?, 'project_task', ?, ?, ?, ?, 'email', ?, ?, TRUE)
		`).bind(
			id,
			name,
			String(data.get('debtType') ?? '').trim() || null,
			triggerField,
			offsetDays,
			frequency,
			recipientMode,
			recipientMode === 'custom' ? JSON.stringify(customRecipients) : null
		), prepareAudit({
			...auditRequestMeta(event),
			action: 'create',
			entityType: 'reminder_rule',
			entityId: id,
			summary: `创建提醒规则：${name}`,
			after: { name, triggerField, offsetDays, frequency, recipientMode }
		})]);
		return {
			success: true,
			message: '提醒规则已保存',
			settings: await getWorkflowSettingsData()
		};
	},
	createSop: async (event) => {
		const data = await event.request.formData();
		const name = String(data.get('name') ?? '').trim();
		const debtType = String(data.get('debtType') ?? '').trim();
		const description = String(data.get('description') ?? '').trim();
		if (!name || !debtType) return fail(400, { message: '请填写 SOP 名称和负债品种' });
		const db = getDatabase();
		const id = randomUUID();
		try {
			await db.batch([db.prepare(`
				INSERT INTO sop_templates (id, name, debt_type, description)
				VALUES (?, ?, ?, ?)
			`).bind(id, name, debtType, description || null), prepareAudit({
				...auditRequestMeta(event),
				action: 'create',
				entityType: 'sop',
				entityId: id,
				summary: `创建 SOP：${name}`,
				after: { name, debtType, description }
			})]);
		} catch (error) {
			return fail(409, { message: error instanceof Error ? error.message : String(error) });
		}
		return {
			success: true,
			message: 'SOP 模板已创建',
			sopId: id,
			settings: await getWorkflowSettingsData()
		};
	}
};
