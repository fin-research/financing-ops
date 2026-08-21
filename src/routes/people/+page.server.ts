import { randomUUID } from 'node:crypto';
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getDatabase } from '$lib/server/db.js';
import {
	banManagedUser, createManagedUser, NeonAuthApiError, removeManagedUser,
	setManagedUserPassword, setManagedUserRole, unbanManagedUser, updateManagedUser
} from '$lib/server/auth.js';
import { getPeopleAccessData } from '$lib/server/queries.js';
import { auditRequestMeta, prepareAudit } from '$lib/server/audit.js';
import { isValidEmail, normalizeEmail } from '$lib/email.js';

const validRoles = new Set(['admin', 'handler', 'reviewer']);

function identityFields(data: FormData) {
	return {
		name: String(data.get('name') ?? '').trim(),
		email: normalizeEmail(data.get('email')),
		role: String(data.get('role') ?? '').trim(),
		accountEnabled: String(data.get('accountEnabled') ?? '') === '1',
		password: String(data.get('password') ?? '')
	};
}

function validationMessage(fields: ReturnType<typeof identityFields>, existingAccount = false) {
	if (!fields.name || !isValidEmail(fields.email) || !validRoles.has(fields.role)) return '请填写姓名、有效邮箱并选择系统角色';
	if (fields.role === 'admin' && !fields.accountEnabled) return '管理员必须开通登录权限';
	if (!fields.accountEnabled) return null;
	if (!existingAccount && fields.password.length < 16) return '新账号密码不得少于 16 个字符';
	if (fields.password && fields.password.length < 16) return '重置密码不得少于 16 个字符';
	return null;
}

async function identityState(db: ReturnType<typeof getDatabase>, id: string) {
	return await db.prepare(`
		SELECT p.id, p.name, p.email, p.role, p.active,
			p.neon_auth_user_id::text AS accountId,
			u.role AS accountRole, NOT COALESCE(u.banned, FALSE) AS accountActive
		FROM people p LEFT JOIN neon_auth."user" u ON u.id = p.neon_auth_user_id
		WHERE p.id = ?
	`).get(id) as any;
}

async function activeAdminCount(db: ReturnType<typeof getDatabase>) {
	const row = await db.prepare(`
		SELECT COUNT(*) AS count
		FROM people p JOIN neon_auth."user" u ON u.id = p.neon_auth_user_id
		WHERE p.role = 'admin' AND p.active = TRUE AND NOT COALESCE(u.banned, FALSE)
	`).get();
	return Number(row?.count ?? 0);
}

function constraintMessage(error: unknown) {
	if (error instanceof NeonAuthApiError) {
		if (error.status === 409 || error.code?.includes('USER_ALREADY_EXISTS')) return '该邮箱已存在登录账号，请直接编辑现有人员或更换邮箱';
		if (error.status === 429) return '认证操作过于频繁，请稍后重试';
		if (error.status === 401 || error.status === 403) return '当前管理员会话无权执行该操作，请重新登录';
		if (error.status === 503) return 'Neon Auth 暂时不可用，请稍后重试';
		return 'Neon Auth 账号操作失败，请检查邮箱和密码后重试';
	}
	const message = error instanceof Error ? error.message : String(error);
	if (message.includes('idx_people_email_unique') || message.includes('people_email_key') || message.includes('people.email')) return '该邮箱已被其他人员使用，请直接编辑现有人员或更换邮箱';
	if (message.includes('people.name')) return '人员姓名已存在，请直接编辑现有人员';
	return '保存失败，请稍后重试';
}

async function duplicatePerson(db: ReturnType<typeof getDatabase>, name: string, email: string, exceptId = '') {
	return await db.prepare('SELECT id FROM people WHERE id <> ? AND (name = ? OR LOWER(email) = LOWER(?)) LIMIT 1').get(exceptId, name, email);
}

export const load: PageServerLoad = async () => ({ peopleAccess: await getPeopleAccessData() });

export const actions: Actions = {
	createPerson: async (event) => {
		const fields = identityFields(await event.request.formData());
		const message = validationMessage(fields);
		if (message) return fail(400, { message });
		const db = getDatabase();
		if (await duplicatePerson(db, fields.name, fields.email)) return fail(409, { message: '姓名或邮箱已存在，请直接编辑现有人员' });
		const personId = randomUUID();
		let accountId: string | null = null;
		try {
			if (fields.accountEnabled) {
				const account = await createManagedUser(event, { email: fields.email, password: fields.password, name: fields.name, role: fields.role });
				accountId = account?.id ? String(account.id) : null;
				if (!accountId) throw new Error('Neon Auth did not return a user id');
			}
			await db.batch([
				db.prepare('INSERT INTO people (id, name, email, role, active, neon_auth_user_id) VALUES (?, ?, ?, ?, TRUE, ?::uuid)').bind(personId, fields.name, fields.email, fields.role, accountId),
				prepareAudit({ ...auditRequestMeta(event), db, action: 'person.create', entityType: 'person', entityId: personId, summary: `添加人员：${fields.name}`, after: { name: fields.name, email: fields.email, role: fields.role, accountEnabled: fields.accountEnabled, active: true } })
			]);
			return { success: true, message: `已添加 ${fields.name}${fields.accountEnabled ? ' 并开通 Neon Auth 登录' : ''}` };
		} catch (error) {
			if (accountId) await removeManagedUser(event, accountId).catch(() => null);
			return fail(409, { message: constraintMessage(error) });
		}
	},

	updatePerson: async (event) => {
		const data = await event.request.formData();
		const id = String(data.get('id') ?? '').trim();
		const db = getDatabase();
		const before = id ? await identityState(db, id) : undefined;
		if (!before) return fail(404, { message: '未找到该人员' });
		const fields = identityFields(data);
		const message = validationMessage(fields, Boolean(before.accountId));
		if (message) return fail(400, { message });
		if (await duplicatePerson(db, fields.name, fields.email, id)) return fail(409, { message: '姓名或邮箱已存在，请直接编辑现有人员' });
		if (before.accountId && !fields.accountEnabled && event.locals.user?.personId === id) return fail(400, { message: '不能移除当前登录权限' });
		if (before.accountRole === 'admin' && (!fields.accountEnabled || fields.role !== 'admin') && await activeAdminCount(db) <= 1) return fail(400, { message: '至少保留一个启用中的管理员账号' });
		let accountId: string | null = before.accountId;
		let created = false;
		try {
			if (!fields.accountEnabled && accountId) {
				await removeManagedUser(event, accountId);
				accountId = null;
			} else if (fields.accountEnabled && accountId) {
				if (fields.name !== before.name || fields.email !== normalizeEmail(before.email)) await updateManagedUser(event, accountId, { name: fields.name, email: fields.email });
				if (fields.role !== before.accountRole) await setManagedUserRole(event, accountId, fields.role);
				if (fields.password) await setManagedUserPassword(event, accountId, fields.password);
			} else if (fields.accountEnabled) {
				const account = await createManagedUser(event, { email: fields.email, password: fields.password, name: fields.name, role: fields.role });
				accountId = account?.id ? String(account.id) : null;
				if (!accountId) throw new Error('Neon Auth did not return a user id');
				created = true;
				if (!before.active) await banManagedUser(event, accountId);
			}
			await db.batch([
				db.prepare('UPDATE people SET name = ?, email = ?, role = ?, neon_auth_user_id = ?::uuid, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(fields.name, fields.email, fields.role, accountId, id),
				prepareAudit({ ...auditRequestMeta(event), db, action: 'person.update', entityType: 'person', entityId: id, summary: `更新人员与账号：${fields.name}`, before, after: { ...before, name: fields.name, email: fields.email, role: fields.role, accountEnabled: fields.accountEnabled } })
			]);
			return { success: true, message: `已更新 ${fields.name} 的人员、角色与 Neon Auth 账号关联` };
		} catch (error) {
			if (created && accountId) await removeManagedUser(event, accountId).catch(() => null);
			return fail(409, { message: constraintMessage(error) });
		}
	},

	togglePerson: async (event) => {
		const data = await event.request.formData();
		const id = String(data.get('id') ?? '').trim();
		const active = String(data.get('active') ?? '') === '1';
		const db = getDatabase();
		const before = await identityState(db, id);
		if (!before) return fail(404, { message: '未找到该人员' });
		if (!active && event.locals.user?.personId === id) return fail(400, { message: '不能停用当前登录人员' });
		if (!active && before.accountRole === 'admin' && await activeAdminCount(db) <= 1) return fail(400, { message: '至少保留一个启用中的管理员账号' });
		try {
			if (before.accountId) await (active ? unbanManagedUser(event, before.accountId) : banManagedUser(event, before.accountId));
			await db.batch([
				db.prepare('UPDATE people SET active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(active, id),
				prepareAudit({ ...auditRequestMeta(event), db, action: active ? 'person.activate' : 'person.deactivate', entityType: 'person', entityId: id, summary: `${active ? '启用' : '停用'}人员与账号：${before.name}`, before, after: { ...before, active, accountActive: before.accountId ? active : null } })
			]);
			return { success: true, message: active ? '人员与 Neon Auth 登录已启用' : '人员与 Neon Auth 登录已停用' };
		} catch (error) {
			return fail(409, { message: constraintMessage(error) });
		}
	},

	deletePerson: async (event) => {
		const data = await event.request.formData();
		const id = String(data.get('id') ?? '').trim();
		const db = getDatabase();
		const before = await identityState(db, id);
		if (!before) return fail(404, { message: '未找到该人员' });
		if (event.locals.user?.personId === id) return fail(400, { message: '不能删除当前登录人员' });
		if (before.accountRole === 'admin' && await activeAdminCount(db) <= 1) return fail(400, { message: '至少保留一个启用中的管理员账号' });
		try {
			if (before.accountId) await removeManagedUser(event, before.accountId);
			await db.batch([
				prepareAudit({ ...auditRequestMeta(event), db, action: 'person.delete', entityType: 'person', entityId: id, summary: `删除人员及关联账号：${before.name}`, before }),
				db.prepare('DELETE FROM people WHERE id = ?').bind(id)
			]);
			return { success: true, message: `已删除 ${before.name} 及其 Neon Auth 登录权限` };
		} catch (error) {
			return fail(409, { message: constraintMessage(error) });
		}
	}
};
