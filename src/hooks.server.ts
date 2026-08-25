import { error as httpError, redirect } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit';
import { appCookiePath, appRoot, withBase } from '$lib/app-paths';
import { invalidateCachedSession } from '$lib/server/auth-cache.js';
import { closeDatabase } from '$lib/server/db.js';
import { actionNameFromUrl, isAuthorizedRequest, isSafeRequestMethod } from '$lib/server/request-authorization.js';
import {
	getSessionUser,
	NeonAuthApiError,
	SESSION_COOKIE
} from '$lib/server/auth.js';

export const handle: Handle = async ({ event, resolve }) => {
	try {
		event.locals.dataApiJwt = null;
		event.locals.authCacheStatus = 'bypass';
		const routeId = event.route.id;
		const isStaticAsset = event.url.pathname.startsWith(withBase('/_app/'));
		const isPublic = routeId === '/login' || isStaticAsset;
		const sessionToken = isStaticAsset ? null : event.cookies.get(SESSION_COOKIE);
		const safeRequest = isSafeRequestMethod(event.request.method);
		if (sessionToken && !safeRequest) await invalidateCachedSession(event, sessionToken);
		const authStartedAt = performance.now();
		try {
			event.locals.user = isStaticAsset
				? null
				: await getSessionUser(event, sessionToken, {
					requireDataApiJwt: routeId === '/data/token',
					useSessionCache: safeRequest && routeId !== '/data/token'
				});
		} catch (authError) {
			if (authError instanceof NeonAuthApiError && authError.status === 503) {
				throw httpError(503, '认证服务暂时不可用，请稍后重试');
			}
			throw authError;
		}
		const authDurationMs = performance.now() - authStartedAt;
		if (sessionToken && !event.locals.user) {
			event.cookies.delete(SESSION_COOKIE, { path: appCookiePath });
		}
		if (!isPublic && !event.locals.user) {
			const redirectTo = `${event.url.pathname}${event.url.search}`;
			throw redirect(303, `${withBase('/login')}?redirectTo=${encodeURIComponent(redirectTo)}`);
		}

		const actionName = actionNameFromUrl(event.url);
		if (!isPublic && !isAuthorizedRequest(event.locals.user?.role, routeId, event.request.method, actionName)) {
			return new Response('当前账号无权执行该操作', { status: 403 });
		}

		if (routeId === '/login' && event.locals.user && event.request.method === 'GET') {
			throw redirect(303, appRoot);
		}

		const response = await resolve(event);
		if (isStaticAsset) return response;
		const headers = new Headers(response.headers);
		headers.append(
			'Server-Timing',
			`auth;dur=${authDurationMs.toFixed(1)};desc="${event.locals.authCacheStatus}"`
		);
		if (event.locals.database) {
			headers.append(
				'Server-Timing',
				`db;dur=${event.locals.database.queryDurationMs.toFixed(1)};desc="${event.locals.database.queryCount} queries"`
			);
		}
		return new Response(response.body, {
			status: response.status,
			statusText: response.statusText,
			headers
		});
	} finally {
		await closeDatabase(event);
	}
};
