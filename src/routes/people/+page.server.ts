import { randomUUID } from 'node:crypto';
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getDatabase } from '$lib/server/db.js';
import { getPeopleAccessData } from '$lib/server/queries.js';
import { auditRequestMeta, recordAudit } from '$lib/server/audit.js';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function personFields(data: FormData) {
	return {
		name: String(data.get('name') ?? '').trim(),
		email: String(data.get('email') ?? '').trim().toLowerCase(),
		role: String(data.get('role') ?? '').trim()
	};
}

export const load: PageServerLoad = () => ({
	peopleAccess: getPeopleAccessData()
});

export const actions: Actions = {
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
			db.prepare(`
				UPDATE people
				SET name = ?, email = ?, role = ?, updated_at = CURRENT_TIMESTAMP
				WHERE id = ?
			`).run(fields.name, fields.email, fields.role, id);
			recordAudit({
				...auditRequestMeta(event),
				action: 'update',
				entityType: 'person',
				entityId: id,
				summary: `更新人员：${fields.name}`,
				before,
				after: { ...fields, active: Boolean((before as { active: number }).active) }
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
		const before = db.prepare('SELECT name, email, role, active FROM people WHERE id = ?').get(id) as
			| { name: string; email: string; role: string; active: number }
			| undefined;
		if (!before) return fail(404, { message: '未找到该人员' });
		db.prepare('UPDATE people SET active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(active, id);
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
