import { redirect } from '@sveltejs/kit';
import type { Actions } from './$types';
import { withBase } from '$lib/app-paths';
import { deleteSession, SESSION_COOKIE } from '$lib/server/auth.js';
import { auditRequestMeta, recordAudit } from '$lib/server/audit.js';

export const actions: Actions = {
	default: async (event) => {
		const user = event.locals.user;
		const token = event.cookies.get(SESSION_COOKIE);
		if (user) {
			await recordAudit({
				...auditRequestMeta(event),
				action: 'logout',
				entityType: 'auth',
				entityId: user.id,
				summary: `${user.email ?? user.personName} 退出系统`
			});
		}
		await deleteSession(event, token);
		throw redirect(303, withBase('/login'));
	}
};
