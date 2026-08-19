import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getDatabase } from '$lib/server/db.js';
import {
	deleteOtherSessions,
	hashPassword,
	SESSION_COOKIE,
	verifyPassword
} from '$lib/server/auth.js';
import { auditRequestMeta, prepareAudit } from '$lib/server/audit.js';

const usernamePattern = /^[A-Za-z0-9._-]{3,64}$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const avatarTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const maxAvatarBytes = 512 * 1024;

async function currentProfile(userId: string) {
	return await getDatabase().prepare(`
		SELECT u.id, u.username, u.password_hash AS passwordHash,
			u.avatar_data_url AS avatarDataUrl,
			p.id AS personId, p.name, p.email, p.role
		FROM auth_users u
		JOIN people p ON p.id = u.person_id
		WHERE u.id = ?
	`).get(userId) as
		| {
				id: string;
				username: string;
				passwordHash: string;
				avatarDataUrl: string | null;
				personId: string;
				name: string;
				email: string | null;
				role: string;
		  }
		| undefined;
}

function publicProfile(profile: NonNullable<Awaited<ReturnType<typeof currentProfile>>>) {
	return {
		username: profile.username,
		avatarDataUrl: profile.avatarDataUrl,
		name: profile.name,
		email: profile.email,
		role: profile.role
	};
}

function constraintMessage(error: unknown) {
	const message = error instanceof Error ? error.message : String(error);
	if (message.includes('auth_users.username')) return '该登录用户名已被使用，请更换后重试';
	if (message.includes('people.name')) return '该显示姓名已被使用，请更换后重试';
	return '保存失败，请稍后重试';
}

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) throw error(401, '登录已失效，请重新登录');
	const profile = await currentProfile(locals.user.id);
	if (!profile) throw error(404, '未找到当前账号');
	return { profile: publicProfile(profile) };
};

export const actions: Actions = {
	updateProfile: async (event) => {
		if (!event.locals.user) return fail(401, { section: 'profile', message: '登录已失效，请重新登录' });
		const before = await currentProfile(event.locals.user.id);
		if (!before) return fail(404, { section: 'profile', message: '未找到当前账号' });

		const data = await event.request.formData();
		const name = String(data.get('name') ?? '').trim();
		const email = String(data.get('email') ?? '').trim().toLowerCase();
		const username = String(data.get('username') ?? '').trim();
		const currentPassword = String(data.get('currentPassword') ?? '');
		const removeAvatar = data.get('removeAvatar') === '1';
		const avatar = data.get('avatar');

		if (!name || name.length > 50) {
			return fail(400, { section: 'profile', message: '显示姓名不能为空且不得超过 50 个字符' });
		}
		if (email && !emailPattern.test(email)) {
			return fail(400, { section: 'profile', message: '请输入有效的邮箱地址' });
		}
		if (!usernamePattern.test(username)) {
			return fail(400, { section: 'profile', message: '登录用户名需为 3–64 位字母、数字、点、下划线或连字符' });
		}
		if (username.toLowerCase() !== before.username.toLowerCase()) {
			if (!currentPassword || !(await verifyPassword(currentPassword, before.passwordHash))) {
				return fail(400, { section: 'profile', message: '修改登录用户名需要验证当前密码' });
			}
		}

		let avatarDataUrl = removeAvatar ? null : before.avatarDataUrl;
		if (avatar instanceof File && avatar.size > 0) {
			if (!avatarTypes.has(avatar.type)) {
				return fail(400, { section: 'profile', message: '头像仅支持 JPG、PNG 或 WebP 图片' });
			}
			if (avatar.size > maxAvatarBytes) {
				return fail(400, { section: 'profile', message: '头像文件不得超过 512KB' });
			}
			avatarDataUrl = `data:${avatar.type};base64,${Buffer.from(await avatar.arrayBuffer()).toString('base64')}`;
		}

		const db = getDatabase();
		try {
			await db.batch([
				db.prepare(`
					UPDATE people SET name = ?, email = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
				`).bind(name, email || null, before.personId),
				db.prepare(`
					UPDATE auth_users
					SET username = ?, avatar_data_url = ?, updated_at = CURRENT_TIMESTAMP
					WHERE id = ?
				`).bind(username, avatarDataUrl, before.id),
				prepareAudit({
					...auditRequestMeta(event),
					db,
					action: 'profile.update',
					entityType: 'auth',
					entityId: before.id,
					summary: `${before.username} 更新个人资料`,
					before: {
						name: before.name,
						email: before.email,
						username: before.username,
						hasAvatar: Boolean(before.avatarDataUrl)
					},
					after: { name, email: email || null, username, hasAvatar: Boolean(avatarDataUrl) }
				})
			]);
			return { section: 'profile', success: true, message: '个人资料已更新' };
		} catch (error) {
			return fail(409, { section: 'profile', message: constraintMessage(error) });
		}
	},

	updatePassword: async (event) => {
		if (!event.locals.user) return fail(401, { section: 'password', message: '登录已失效，请重新登录' });
		const profile = await currentProfile(event.locals.user.id);
		if (!profile) return fail(404, { section: 'password', message: '未找到当前账号' });

		const data = await event.request.formData();
		const currentPassword = String(data.get('currentPassword') ?? '');
		const newPassword = String(data.get('newPassword') ?? '');
		const confirmPassword = String(data.get('confirmPassword') ?? '');
		if (!(await verifyPassword(currentPassword, profile.passwordHash))) {
			return fail(400, { section: 'password', message: '当前密码不正确' });
		}
		if (newPassword.length < 16) {
			return fail(400, { section: 'password', message: '新密码不得少于 16 个字符' });
		}
		if (newPassword !== confirmPassword) {
			return fail(400, { section: 'password', message: '两次输入的新密码不一致' });
		}
		if (await verifyPassword(newPassword, profile.passwordHash)) {
			return fail(400, { section: 'password', message: '新密码不能与当前密码相同' });
		}

		const passwordHash = await hashPassword(newPassword);
		const db = getDatabase();
		await db.batch([
			db.prepare(`
				UPDATE auth_users
				SET password_hash = ?, failed_login_count = 0, locked_until = NULL,
					updated_at = CURRENT_TIMESTAMP
				WHERE id = ?
			`).bind(passwordHash, profile.id),
			prepareAudit({
				...auditRequestMeta(event),
				db,
				action: 'password.update',
				entityType: 'auth',
				entityId: profile.id,
				summary: `${profile.username} 修改登录密码`
			})
		]);
		await deleteOtherSessions(profile.id, event.cookies.get(SESSION_COOKIE));
		return { section: 'password', success: true, message: '密码已更新，其他设备上的登录已退出' };
	}
};
