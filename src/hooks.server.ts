import { redirect } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { appRoot, withBase } from '$lib/app-paths';
import { closeDatabase } from '$lib/server/db.js';
import {
	canWrite,
	configureAuth,
	getSessionUser,
	SESSION_COOKIE
} from '$lib/server/auth.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const handle: Handle = async ({ event, resolve }) => {
	try {
		configureAuth(env);
		event.locals.user = await getSessionUser(event.cookies.get(SESSION_COOKIE));

		const routeId = event.route.id;
		const isPublic = routeId === '/login' || event.url.pathname.startsWith(withBase('/_app/'));
		if (!isPublic && !event.locals.user) {
			const redirectTo = `${event.url.pathname}${event.url.search}`;
			throw redirect(303, `${withBase('/login')}?redirectTo=${encodeURIComponent(redirectTo)}`);
		}

		const isOwnSettingsWrite = routeId === '/settings' && event.request.method === 'POST';
		if (!isPublic && !SAFE_METHODS.has(event.request.method) && !isOwnSettingsWrite && !canWrite(event.locals.user)) {
			return new Response('当前账号仅有只读权限', { status: 403 });
		}

		if (routeId === '/login' && event.locals.user && event.request.method === 'GET') {
			throw redirect(303, appRoot);
		}

		return await resolve(event);
	} finally {
		await closeDatabase(event);
	}
};
