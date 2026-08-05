import { redirect } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import {
	canWrite,
	configureAuth,
	ensureAdminUser,
	getSessionUser,
	SESSION_COOKIE
} from '$lib/server/auth.js';

const PUBLIC_PATHS = new Set(['/login']);
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const handle: Handle = async ({ event, resolve }) => {
	configureAuth(env);
	await ensureAdminUser();
	event.locals.user = getSessionUser(event.cookies.get(SESSION_COOKIE));

	const pathname = event.url.pathname;
	const isPublic = PUBLIC_PATHS.has(pathname) || pathname.startsWith('/_app/');
	if (!isPublic && !event.locals.user) {
		const redirectTo = `${pathname}${event.url.search}`;
		throw redirect(303, `/login?redirectTo=${encodeURIComponent(redirectTo)}`);
	}

	const isOwnSettingsWrite = pathname === '/settings' && event.request.method === 'POST';
	if (!isPublic && !SAFE_METHODS.has(event.request.method) && !isOwnSettingsWrite && !canWrite(event.locals.user)) {
		return new Response('当前账号仅有只读权限', { status: 403 });
	}

	if (pathname === '/login' && event.locals.user && event.request.method === 'GET') {
		throw redirect(303, '/');
	}

	return resolve(event);
};
