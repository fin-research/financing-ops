import { error as httpError, redirect } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit';
import { appCookiePath, appRoot, withBase } from '$lib/app-paths';
import { closeDatabase } from '$lib/server/db.js';
import {
	canWrite,
	getSessionUser,
	NeonAuthApiError,
	SESSION_COOKIE
} from '$lib/server/auth.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const handle: Handle = async ({ event, resolve }) => {
	try {
		event.locals.dataApiJwt = null;
		const routeId = event.route.id;
		const isStaticAsset = event.url.pathname.startsWith(withBase('/_app/'));
		const isPublic = routeId === '/login' || isStaticAsset;
		const sessionToken = isStaticAsset ? null : event.cookies.get(SESSION_COOKIE);
		try {
			event.locals.user = isStaticAsset ? null : await getSessionUser(event, sessionToken);
		} catch (authError) {
			if (authError instanceof NeonAuthApiError && authError.status === 503) {
				throw httpError(503, '认证服务暂时不可用，请稍后重试');
			}
			throw authError;
		}
		if (sessionToken && !event.locals.user) {
			event.cookies.delete(SESSION_COOKIE, { path: appCookiePath });
		}
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
