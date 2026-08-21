import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { appRoot, isAppPath } from '$lib/app-paths';
import { authenticate, NeonAuthApiError } from '$lib/server/auth.js';
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

		let user;
		try {
			user = await authenticate(event, email, password);
		} catch (error) {
			if (error instanceof NeonAuthApiError) {
				const message = error.status === 429
					? '登录尝试过于频繁，请稍后重试'
					: error.code === 'PERSON_ACCESS_DENIED'
						? error.message
						: error.status === 503
							? '认证服务暂时不可用，请稍后重试'
							: '邮箱或密码错误';
				return fail(error.status === 503 ? 503 : 400, { message, email });
			}
			throw error;
		}
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
