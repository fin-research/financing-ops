import { randomUUID } from 'node:crypto';
import { writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getDatabase } from '$lib/server/db.js';
import { importDebtWorkbook } from '$lib/server/excel-import.js';
import { getSettingsData } from '$lib/server/queries.js';
import { auditRequestMeta, recordAudit } from '$lib/server/audit.js';

const defaultWorkbook = path.resolve('data', '东方财富证券借入资金汇总表20260727.xlsx');
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function personFields(data: FormData) {
	return {
		name: String(data.get('name') ?? '').trim(),
		email: String(data.get('email') ?? '').trim().toLowerCase(),
		role: String(data.get('role') ?? '').trim()
	};
}

export const load: PageServerLoad = () => ({
	settings: getSettingsData()
});

export const actions: Actions = {
	reimport: async () => {
		try {
			return { success: true, importResult: importDebtWorkbook(defaultWorkbook) };
		} catch (error) {
			return fail(500, { message: error instanceof Error ? error.message : String(error) });
		}
	},
	upload: async ({ request }) => {
		const data = await request.formData();
		const workbook = data.get('workbook');
		if (!(workbook instanceof File) || workbook.size === 0) return fail(400, { message: '请选择 Excel 文件' });
		if (!workbook.name.toLowerCase().endsWith('.xlsx')) return fail(400, { message: '仅支持 .xlsx 文件' });
		if (workbook.size > 25 * 1024 * 1024) return fail(413, { message: '文件不能超过 25MB' });

		const temporaryPath = path.join(os.tmpdir(), `financing-workbench-${randomUUID()}.xlsx`);
		try {
			await writeFile(temporaryPath, Buffer.from(await workbook.arrayBuffer()));
			return { success: true, importResult: importDebtWorkbook(temporaryPath) };
		} catch (error) {
			return fail(500, { message: error instanceof Error ? error.message : String(error) });
		} finally {
			await unlink(temporaryPath).catch(() => undefined);
		}
	},
	createReminder: async (event) => {
		const data = await event.request.formData();
		const name = String(data.get('name') ?? '').trim();
		const triggerField = String(data.get('triggerField') ?? 'due_date');
		const offsetDays = Number(data.get('offsetDays') ?? 3);
		const frequency = String(data.get('frequency') ?? 'once');
		const recipientMode = String(data.get('recipientMode') ?? 'assignee');
		const recipients = String(data.get('recipients') ?? '').trim();
		if (!name || !Number.isInteger(offsetDays) || offsetDays < 0 || offsetDays > 365) {
			return fail(400, { message: '提醒规则参数无效' });
		}
		if (!['once', 'daily', 'weekly'].includes(frequency)) return fail(400, { message: '提醒频率无效' });
		if (!['assignee', 'owner', 'custom'].includes(recipientMode)) return fail(400, { message: '收件人类型无效' });
		if (recipientMode === 'custom') {
			const emails = recipients.split(/[;,，；\s]+/).filter(Boolean);
			if (!emails.length || emails.some((email) => !emailPattern.test(email))) {
				return fail(400, { message: '请填写有效的指定收件邮箱' });
			}
		}
		const db = getDatabase();
		const id = randomUUID();
		db.prepare(`
			INSERT INTO reminder_rules (
				id, name, target_type, debt_type, trigger_field, offset_days,
				frequency, channel, recipient_mode, recipients, is_active
			) VALUES (?, ?, 'project_task', ?, ?, ?, ?, 'email', ?, ?, 1)
		`).run(
			id,
			name,
			String(data.get('debtType') ?? '').trim() || null,
			triggerField,
			offsetDays,
			frequency,
			recipientMode,
			recipientMode === 'custom' ? recipients : null
		);
		recordAudit({
			...auditRequestMeta(event),
			action: 'create',
			entityType: 'reminder_rule',
			entityId: id,
			summary: `创建提醒规则：${name}`,
			after: { name, triggerField, offsetDays, frequency, recipientMode }
		});
		return { success: true, message: '提醒规则已保存' };
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
			db.prepare(`
				INSERT INTO sop_templates (id, name, debt_type, description)
				VALUES (?, ?, ?, ?)
			`).run(id, name, debtType, description || null);
			recordAudit({
				...auditRequestMeta(event),
				action: 'create',
				entityType: 'sop',
				entityId: id,
				summary: `创建 SOP：${name}`,
				after: { name, debtType, description }
			});
			return { success: true, message: 'SOP 模板已创建', sopId: id };
		} catch (error) {
			return fail(409, { message: error instanceof Error ? error.message : String(error) });
		}
	},
	createPerson: async (event) => {
		const fields = personFields(await event.request.formData());
		if (!fields.name || !fields.role || !emailPattern.test(fields.email)) {
			return fail(400, { message: '请填写姓名、角色和有效邮箱' });
		}
		const db = getDatabase();
		const id = randomUUID();
		try {
			db.prepare(`
				INSERT INTO people (id, name, email, role, active)
				VALUES (?, ?, ?, ?, 1)
			`).run(id, fields.name, fields.email, fields.role);
			recordAudit({
				...auditRequestMeta(event),
				action: 'create',
				entityType: 'person',
				entityId: id,
				summary: `添加人员：${fields.name}`,
				after: fields
			});
			return { success: true, message: `已添加 ${fields.name}` };
		} catch (error) {
			return fail(409, { message: error instanceof Error ? error.message : String(error) });
		}
	},
	updatePerson: async (event) => {
		const data = await event.request.formData();
		const id = String(data.get('id') ?? '').trim();
		const fields = personFields(data);
		if (!id || !fields.name || !fields.role || !emailPattern.test(fields.email)) {
			return fail(400, { message: '请填写姓名、角色和有效邮箱' });
		}
		const db = getDatabase();
		try {
			const before = db.prepare('SELECT name, email, role, active FROM people WHERE id = ?').get(id);
			if (!before) return fail(404, { message: '未找到该人员' });
			const result = db.prepare(`
				UPDATE people
				SET name = ?, email = ?, role = ?, updated_at = CURRENT_TIMESTAMP
				WHERE id = ?
			`).run(fields.name, fields.email, fields.role, id);
			if (!result.changes) return fail(404, { message: '未找到该人员' });
			recordAudit({
				...auditRequestMeta(event),
				action: 'update',
				entityType: 'person',
				entityId: id,
				summary: `更新人员：${fields.name}`,
				before,
				after: { ...fields, active: Boolean(before.active) }
			});
			return { success: true, message: `已更新 ${fields.name}` };
		} catch (error) {
			return fail(409, { message: error instanceof Error ? error.message : String(error) });
		}
	},
	togglePerson: async (event) => {
		const data = await event.request.formData();
		const id = String(data.get('id') ?? '').trim();
		const active = String(data.get('active') ?? '') === '1' ? 1 : 0;
		if (!id) return fail(400, { message: '缺少人员编号' });
		const db = getDatabase();
		const before = db.prepare('SELECT name, email, role, active FROM people WHERE id = ?').get(id);
		if (!before) return fail(404, { message: '未找到该人员' });
		const result = db.prepare(`
			UPDATE people SET active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
		`).run(active, id);
		if (!result.changes) return fail(404, { message: '未找到该人员' });
		recordAudit({
			...auditRequestMeta(event),
			action: active ? 'activate' : 'deactivate',
			entityType: 'person',
			entityId: id,
			summary: `${active ? '启用' : '停用'}人员：${before.name}`,
			before: { ...before, active: Boolean(before.active) },
			after: { ...before, active: Boolean(active) }
		});
		return { success: true, message: active ? '人员已启用' : '人员已停用' };
	}
};
