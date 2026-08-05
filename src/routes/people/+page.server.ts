import { randomUUID } from 'node:crypto';
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getDatabase } from '$lib/server/db.js';
import { hashPassword } from '$lib/server/auth.js';
import { getPeopleAccessData } from '$lib/server/queries.js';
import { auditRequestMeta, recordAudit } from '$lib/server/audit.js';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const usernamePattern = /^[A-Za-z0-9._-]{3,64}$/;
const validRoles = new Set(['admin', 'handler', 'reviewer']);

function identityFields(data: FormData) {
	return {
		name: String(data.get('name') ?? '').trim(),
		email: String(data.get('email') ?? '').trim().toLowerCase(),
		role: String(data.get('role') ?? '').trim(),
		accountEnabled: String(data.get('accountEnabled') ?? '') === '1',
		username: String(data.get('username') ?? '').trim(),
		password: String(data.get('password') ?? '')
	};
}

function validationMessage(fields: ReturnType<typeof identityFields>, existingAccount = false) {
	if (!fields.name || !emailPattern.test(fields.email) || !validRoles.has(fields.role)) {
		return '请填写姓名、有效邮箱并选择系统角色';
	}
	if (fields.role === 'admin' && !fields.accountEnabled) return '管理员必须开通登录账号';
	if (!fields.accountEnabled) return null;
	if (!usernamePattern.test(fields.username)) return '登录账号需为 3–64 位字母、数字、点、下划线或连字符';
	if (!existingAccount && fields.password.length < 16) return '新账号密码不得少于 16 个字符';
	if (fields.password && fields.password.length < 16) return '重置密码不得少于 16 个字符';
	return null;
}

function identityState(db: ReturnType<typeof getDatabase>, id: string) {
	return db.prepare(`
		SELECT p.id, p.name, p.email, p.role, p.active,
			u.id AS accountId, u.username, u.role AS accountRole, u.active AS accountActive
		FROM people p LEFT JOIN auth_users u ON u.person_id = p.id
		WHERE p.id = ?
	`).get(id) as
		| {
				id: string;
				name: string;
				email: string | null;
				role: string;
				active: number;
				accountId: string | null;
				username: string | null;
				accountRole: string | null;
				accountActive: number | null;
		  }
		| undefined;
}

function activeAdminCount(db: ReturnType<typeof getDatabase>) {
	return Number(db.prepare("SELECT COUNT(*) AS count FROM auth_users WHERE role = 'admin' AND active = 1").get().count);
}

function constraintMessage(error: unknown) {
	const message = error instanceof Error ? error.message : String(error);
	if (message.includes('auth_users.username')) return '登录账号已存在，请更换账号名';
	if (message.includes('people.name')) return '人员姓名已存在，请直接编辑现有人员';
	return message;
}

export const load: PageServerLoad = () => ({
	peopleAccess: getPeopleAccessData()
});

export const actions: Actions = {
	createPerson: async (event) => {
		const fields = identityFields(await event.request.formData());
		const message = validationMessage(fields);
		if (message) return fail(400, { message });
		const passwordHash = fields.accountEnabled ? await hashPassword(fields.password) : null;
		const db = getDatabase();
		const personId = randomUUID();
		try {
			db.transaction(() => {
				db.prepare(`
					INSERT INTO people (id, name, email, role, active)
					VALUES (?, ?, ?, ?, 1)
				`).run(personId, fields.name, fields.email, fields.role);
				if (fields.accountEnabled) {
					db.prepare(`
						INSERT INTO auth_users (id, person_id, username, password_hash, role, active)
						VALUES (?, ?, ?, ?, ?, 1)
					`).run(randomUUID(), personId, fields.username, passwordHash, fields.role);
				}
				recordAudit({
					...auditRequestMeta(event),
					db,
					action: 'person.create',
					entityType: 'person',
					entityId: personId,
					summary: `添加人员：${fields.name}`,
					after: {
						name: fields.name,
						email: fields.email,
						role: fields.role,
						username: fields.accountEnabled ? fields.username : null,
						active: true
					}
				});
			})();
			return { success: true, message: `已添加 ${fields.name}${fields.accountEnabled ? ' 并开通登录账号' : ''}` };
		} catch (error) {
			return fail(409, { message: constraintMessage(error) });
		}
	},

	updatePerson: async (event) => {
		const data = await event.request.formData();
		const id = String(data.get('id') ?? '').trim();
		const db = getDatabase();
		const before = id ? identityState(db, id) : undefined;
		if (!before) return fail(404, { message: '未找到该人员' });
		const fields = identityFields(data);
		const message = validationMessage(fields, Boolean(before.accountId));
		if (message) return fail(400, { message });
		if (before.accountId && !fields.accountEnabled && event.locals.user?.personId === id) {
			return fail(400, { message: '不能移除当前登录账号' });
		}
		if (before.accountRole === 'admin' && (!fields.accountEnabled || fields.role !== 'admin') && activeAdminCount(db) <= 1) {
			return fail(400, { message: '至少保留一个启用中的管理员账号' });
		}
		const passwordHash = fields.password ? await hashPassword(fields.password) : null;
		try {
			db.transaction(() => {
				db.prepare(`
					UPDATE people
					SET name = ?, email = ?, role = ?, updated_at = CURRENT_TIMESTAMP
					WHERE id = ?
				`).run(fields.name, fields.email, fields.role, id);
				if (!fields.accountEnabled && before.accountId) {
					db.prepare('DELETE FROM auth_users WHERE id = ?').run(before.accountId);
				} else if (fields.accountEnabled && before.accountId) {
					db.prepare(`
						UPDATE auth_users
						SET username = ?, role = ?,
							password_hash = COALESCE(?, password_hash), updated_at = CURRENT_TIMESTAMP
						WHERE id = ?
					`).run(fields.username, fields.role, passwordHash, before.accountId);
				} else if (fields.accountEnabled) {
					db.prepare(`
						INSERT INTO auth_users (id, person_id, username, password_hash, role, active)
						VALUES (?, ?, ?, ?, ?, ?)
					`).run(randomUUID(), id, fields.username, passwordHash, fields.role, before.active);
				}
				recordAudit({
					...auditRequestMeta(event),
					db,
					action: 'person.update',
					entityType: 'person',
					entityId: id,
					summary: `更新人员与账号：${fields.name}`,
					before,
					after: identityState(db, id)
				});
			})();
			return { success: true, message: `已更新 ${fields.name} 的人员、角色与账号关联` };
		} catch (error) {
			return fail(409, { message: constraintMessage(error) });
		}
	},

	togglePerson: async (event) => {
		const data = await event.request.formData();
		const id = String(data.get('id') ?? '').trim();
		const active = String(data.get('active') ?? '') === '1' ? 1 : 0;
		const db = getDatabase();
		const before = identityState(db, id);
		if (!before) return fail(404, { message: '未找到该人员' });
		if (!active && event.locals.user?.personId === id) return fail(400, { message: '不能停用当前登录人员' });
		if (!active && before.accountRole === 'admin' && activeAdminCount(db) <= 1) {
			return fail(400, { message: '至少保留一个启用中的管理员账号' });
		}
		db.transaction(() => {
			db.prepare('UPDATE people SET active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(active, id);
			db.prepare('UPDATE auth_users SET active = ?, updated_at = CURRENT_TIMESTAMP WHERE person_id = ?').run(active, id);
			recordAudit({
				...auditRequestMeta(event),
				db,
				action: active ? 'person.activate' : 'person.deactivate',
				entityType: 'person',
				entityId: id,
				summary: `${active ? '启用' : '停用'}人员与账号：${before.name}`,
				before,
				after: identityState(db, id)
			});
		})();
		return { success: true, message: active ? '人员与登录账号已启用' : '人员与登录账号已停用' };
	},

	deletePerson: async (event) => {
		const data = await event.request.formData();
		const id = String(data.get('id') ?? '').trim();
		const db = getDatabase();
		const before = identityState(db, id);
		if (!before) return fail(404, { message: '未找到该人员' });
		if (event.locals.user?.personId === id) return fail(400, { message: '不能删除当前登录人员' });
		if (before.accountRole === 'admin' && activeAdminCount(db) <= 1) {
			return fail(400, { message: '至少保留一个启用中的管理员账号' });
		}
		db.transaction(() => {
			recordAudit({
				...auditRequestMeta(event),
				db,
				action: 'person.delete',
				entityType: 'person',
				entityId: id,
				summary: `删除人员及关联账号：${before.name}`,
				before
			});
			db.prepare('DELETE FROM people WHERE id = ?').run(id);
		})();
		return { success: true, message: `已删除 ${before.name} 及其关联登录账号` };
	}
};
