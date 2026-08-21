// @ts-nocheck
import { env } from '$env/dynamic/private';
import { appCookiePath } from '../app-paths.js';
import { normalizeEmail } from '../email.js';
import { getDatabase } from './db.js';
import { createNeonAuthClient, NeonAuthApiError } from './neon-auth-client.js';

export const SESSION_COOKIE = 'financing_session';
export const AUTH_ROLES = Object.freeze({
	admin: 'admin',
	handler: 'handler',
	reviewer: 'reviewer'
});

function client(event, token = null) {
	return createNeonAuthClient({
		baseUrl: env.NEON_AUTH_URL,
		origin: event.url.origin,
		token,
		fetchImpl: event.fetch
	});
}

function currentToken(event) {
	return event.cookies.get(SESSION_COOKIE) ?? null;
}

async function localIdentity(authUser) {
	if (!authUser?.id) return null;
	const person = await getDatabase().prepare(`
		SELECT id AS personId, name AS personName, email, role, avatar_data_url AS avatarDataUrl
		FROM people
		WHERE neon_auth_user_id = ?::uuid AND active = TRUE
		LIMIT 1
	`).get(authUser.id);
	if (!person) return null;
	return {
		id: String(authUser.id),
		email: authUser.email ?? person.email ?? null,
		role: person.role,
		personId: person.personId,
		personName: person.personName,
		avatarDataUrl: person.avatarDataUrl ?? null
	};
}

function setSessionCookie(event, token, maxAge = 7 * 24 * 60 * 60) {
	event.cookies.set(SESSION_COOKIE, token, {
		path: appCookiePath,
		httpOnly: true,
		sameSite: 'lax',
		secure: event.url.protocol === 'https:',
		maxAge
	});
}

function clearSessionCookie(event) {
	event.cookies.delete(SESSION_COOKIE, { path: appCookiePath });
}

export async function authenticate(event, email, password) {
	const result = await client(event).signIn(normalizeEmail(email), password);
	const user = await localIdentity(result.data?.user);
	if (!user || !result.token) {
		if (result.token) await client(event, result.token).signOut().catch(() => null);
		throw new NeonAuthApiError(403, '该账号未关联融资工作台人员或已停用', 'PERSON_ACCESS_DENIED');
	}
	setSessionCookie(event, result.token, result.maxAge);
	return user;
}

export async function getSessionUser(event, token = currentToken(event)) {
	if (!token) return null;
	try {
		const result = await client(event, token).getSession();
		if (!result.data?.user) return null;
		if (result.token && result.token !== token) setSessionCookie(event, result.token, result.maxAge);
		return await localIdentity(result.data.user);
	} catch (error) {
		if (error instanceof NeonAuthApiError && (error.status === 401 || error.status === 403)) return null;
		throw error;
	}
}

export async function deleteSession(event, token = currentToken(event)) {
	try {
		if (token) await client(event, token).signOut();
	} catch (error) {
		if (!(error instanceof NeonAuthApiError) || (error.status !== 401 && error.status !== 403)) throw error;
	} finally {
		clearSessionCookie(event);
	}
}

async function authenticatedRequest(event, route, body) {
	const token = currentToken(event);
	if (!token) throw new NeonAuthApiError(401, '登录已失效', 'SESSION_EXPIRED');
	const result = await client(event, token).request(route, { method: 'POST', body });
	if (result.token && result.token !== token) setSessionCookie(event, result.token, result.maxAge);
	return result.data;
}

export function updateCurrentAuthProfile(event, profile) {
	return authenticatedRequest(event, '/update-user', profile);
}

export function changeCurrentPassword(event, currentPassword, newPassword) {
	return authenticatedRequest(event, '/change-password', {
		currentPassword,
		newPassword,
		revokeOtherSessions: true
	});
}

export async function createManagedUser(event, fields) {
	const data = await authenticatedRequest(event, '/admin/create-user', fields);
	return data?.user ?? null;
}

export function updateManagedUser(event, userId, data) {
	return authenticatedRequest(event, '/admin/update-user', { userId, data });
}

export function setManagedUserRole(event, userId, role) {
	return authenticatedRequest(event, '/admin/set-role', { userId, role });
}

export function setManagedUserPassword(event, userId, newPassword) {
	return authenticatedRequest(event, '/admin/set-user-password', { userId, newPassword });
}

export function banManagedUser(event, userId) {
	return authenticatedRequest(event, '/admin/ban-user', {
		userId,
		banReason: '融资工作台人员已停用'
	});
}

export function unbanManagedUser(event, userId) {
	return authenticatedRequest(event, '/admin/unban-user', { userId });
}

export function removeManagedUser(event, userId) {
	return authenticatedRequest(event, '/admin/remove-user', { userId });
}

export function canWrite(user) {
	return user?.role === AUTH_ROLES.admin;
}

export { NeonAuthApiError } from './neon-auth-client.js';
