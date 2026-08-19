import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	authenticate,
	createSession,
	sessionCookieOptions,
	SESSION_COOKIE
} from '$lib/server/auth.js';
import { auditRequestMeta, recordAudit } from '$lib/server/audit.js';

function safeRedirect(value: string | null) {
	if (!value || !value.startsWith('/') || value.startsWith('//')) return '/';
	return value;
}

export const load: PageServerLoad = ({ url }) => ({
	redirectTo: safeRedirect(url.searchParams.get('redirectTo'))
});

export const actions: Actions = {
	default: async (event) => {
		const data = await event.request.formData();
		const username = String(data.get('username') ?? '').trim();
		const password = String(data.get('password') ?? '');
		const redirectTo = safeRedirect(String(data.get('redirectTo') ?? '/'));
		if (!username || !password) {
			return fail(400, { message: '请输入用户名和密码', username });
		}

		const user = await authenticate(username, password);
		if (!user) {
			return fail(400, { message: '用户名或密码错误', username });
		}

		const { token, expiresAt } = await createSession(user.id);
		event.cookies.set(
			SESSION_COOKIE,
			token,
			sessionCookieOptions(expiresAt, event.url.protocol === 'https:')
		);
		await recordAudit({
			...auditRequestMeta({ ...event, locals: { ...event.locals, user } }),
			action: 'login',
			entityType: 'auth',
			entityId: user.id,
			summary: `${user.username} 登录系统`
		});
		throw redirect(303, redirectTo);
	}
};
