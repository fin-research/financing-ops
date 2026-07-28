import { redirect } from '@sveltejs/kit';
import type { Actions } from './$types';
import { deleteSession, SESSION_COOKIE } from '$lib/server/auth.js';
import { auditRequestMeta, recordAudit } from '$lib/server/audit.js';

export const actions: Actions = {
	default: (event) => {
		const user = event.locals.user;
		const token = event.cookies.get(SESSION_COOKIE);
		if (user) {
			recordAudit({
				...auditRequestMeta(event),
				action: 'logout',
				entityType: 'auth',
				entityId: user.id,
				summary: `${user.username} 退出系统`
			});
		}
		deleteSession(token);
		event.cookies.delete(SESSION_COOKIE, { path: '/' });
		throw redirect(303, '/login');
	}
};
