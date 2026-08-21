import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { appCookiePath, appRoot, isAppPath } from '$lib/app-paths';
import {
	authenticate,
	createSession,
	sessionCookieOptions,
	SESSION_COOKIE
} from '$lib/server/auth.js';
import { auditRequestMeta, recordAudit } from '$lib/server/audit.js';
import { normalizeEmail } from '$lib/email.js';

function safeRedirect(value: string | null) {
	if (!value || !isAppPath(value)) return appRoot;
	return value;
}

export const load: PageServerLoad = ({ url }) => ({
	redirectTo: safeRedirect(url.searchParams.get('redirectTo'))
});

export const actions: Actions = {
	default: async (event) => {
		const data = await event.request.formData();
		const email = normalizeEmail(data.get('email'));
		const password = String(data.get('password') ?? '');
		const redirectTo = safeRedirect(String(data.get('redirectTo') ?? appRoot));
		if (!email || !password) {
			return fail(400, { message: '请输入邮箱和密码', email });
		}

		const user = await authenticate(email, password);
		if (!user) {
			return fail(400, { message: '邮箱或密码错误', email });
		}

		const { token, expiresAt } = await createSession(user.id);
		event.cookies.set(
			SESSION_COOKIE,
			token,
			sessionCookieOptions(expiresAt, event.url.protocol === 'https:', appCookiePath)
		);
		await recordAudit({
			...auditRequestMeta({ ...event, locals: { ...event.locals, user } }),
			action: 'login',
			entityType: 'auth',
			entityId: user.id,
			summary: `${user.email ?? user.personName} 登录系统`
		});
		throw redirect(303, redirectTo);
	}
};
