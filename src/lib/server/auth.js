// @ts-nocheck
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { getDatabase } from './db.js';
import { hashPassword, verifyPassword } from './auth-crypto.js';
import { shouldTouchSession } from './session-policy.js';
import { isValidEmail, normalizeEmail } from '../email.js';

export { hashPassword, verifyPassword } from './auth-crypto.js';

export const SESSION_COOKIE = 'financing_session';
export const AUTH_ROLES = Object.freeze({
	admin: 'admin',
	handler: 'handler',
	reviewer: 'reviewer'
});

const DEFAULT_SESSION_HOURS = 12;
let adminReady = false;
let runtimeConfig = {};

export function configureAuth(config = {}) {
	runtimeConfig = config;
}

export async function ensureAdminUser(config = runtimeConfig) {
	if (adminReady) return;
	const email = normalizeEmail(config.ADMIN_EMAIL ?? process.env.ADMIN_EMAIL);
	const adminName = String(config.ADMIN_NAME ?? process.env.ADMIN_NAME ?? '管理员').trim() || '管理员';
	const password = config.ADMIN_PASSWORD ?? process.env.ADMIN_PASSWORD;

	const db = getDatabase();
	const existingAdmin = await db.prepare(`
		SELECT u.id, u.person_id AS personId, u.active AS userActive,
			p.email, p.role AS personRole, p.active AS personActive
		FROM auth_users u JOIN people p ON p.id = u.person_id
		WHERE u.role = 'admin'
		ORDER BY u.active DESC, u.created_at
		LIMIT 1
	`).get();
	if (existingAdmin) {
		const statements = [];
		if (!existingAdmin.userActive) {
			statements.push(db.prepare(`
				UPDATE auth_users SET active = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?
			`).bind(existingAdmin.id));
		}
		if (existingAdmin.personRole !== 'admin' || !existingAdmin.personActive) {
			statements.push(db.prepare(`
				UPDATE people SET role = 'admin', active = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?
			`).bind(existingAdmin.personId));
		}
		if (!existingAdmin.email && isValidEmail(email)) {
			statements.push(db.prepare(`
				UPDATE people SET email = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
			`).bind(email, existingAdmin.personId));
		}
		if (statements.length) await db.batch(statements);
		adminReady = true;
		return;
	}
	if (!password) {
		throw new Error('数据库中没有管理员，且缺少 ADMIN_PASSWORD，无法初始化管理员账号');
	}
	if (!isValidEmail(email)) {
		throw new Error('数据库中没有管理员，且缺少有效的 ADMIN_EMAIL，无法初始化管理员账号');
	}
	const existing = await db.prepare(`
		SELECT p.id AS personId, u.id AS userId
		FROM people p LEFT JOIN auth_users u ON u.person_id = p.id
		WHERE lower(p.email) = lower(?)
		LIMIT 1
	`).get(email);
	if (!existing?.userId) {
		const passwordHash = await hashPassword(password);
		const personId = existing?.personId ?? randomUUID();
		const userId = randomUUID();
		const statements = [existing?.personId
			? db.prepare(`
				UPDATE people SET role = 'admin', active = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?
			`).bind(personId)
			: db.prepare(`
				INSERT INTO people (id, name, email, role, active) VALUES (?, ?, ?, 'admin', 1)
			`).bind(personId, adminName, email),
			db.prepare(`
				INSERT INTO auth_users (id, person_id, username, password_hash, role, active)
				VALUES (?, ?, ?, ?, 'admin', 1)
			`).bind(userId, personId, userId, passwordHash)
		];
		await db.batch(statements);
	} else {
		await db.batch([
			db.prepare(`
				UPDATE auth_users SET role = 'admin', active = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?
			`).bind(existing.userId),
			db.prepare(`
				UPDATE people SET role = 'admin', active = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?
			`).bind(existing.personId)
		]);
	}
	adminReady = true;
}

function sha256(value) {
	return createHash('sha256').update(value).digest('hex');
}

function sessionHours() {
	const configured = Number(runtimeConfig.AUTH_SESSION_HOURS ?? process.env.AUTH_SESSION_HOURS ?? DEFAULT_SESSION_HOURS);
	return Number.isFinite(configured) && configured >= 1 && configured <= 168
		? configured
		: DEFAULT_SESSION_HOURS;
}

export async function authenticate(email, password) {
	await ensureAdminUser();
	const db = getDatabase();
	const normalizedEmail = normalizeEmail(email);
	let user = await db.prepare(`
		SELECT u.id, u.password_hash AS passwordHash, u.role, u.active,
			u.failed_login_count AS failedLoginCount, u.locked_until AS lockedUntil
		FROM auth_users u
		JOIN people p ON p.id = u.person_id
		WHERE lower(p.email) = lower(?)
	`).get(normalizedEmail);
	if (!user && normalizedEmail && !isValidEmail(normalizedEmail)) {
		user = await db.prepare(`
		SELECT u.id, u.password_hash AS passwordHash, u.role, u.active,
			failed_login_count AS failedLoginCount, locked_until AS lockedUntil
		FROM auth_users u
		JOIN people p ON p.id = u.person_id
		WHERE u.username = ? COLLATE NOCASE AND (p.email IS NULL OR trim(p.email) = '')
		`).get(normalizedEmail);
	}

	const now = Date.now();
	if (!user || !user.active) return null;
	if (user.lockedUntil && Date.parse(user.lockedUntil) > now) return null;

	const valid = await verifyPassword(password, user.passwordHash);
	if (!valid) {
		const failures = Number(user.failedLoginCount) + 1;
		const lockedUntil = failures >= 5 ? new Date(now + 15 * 60_000).toISOString() : null;
		await db.prepare(`
			UPDATE auth_users
			SET failed_login_count = ?, locked_until = ?, updated_at = CURRENT_TIMESTAMP
			WHERE id = ?
		`).run(failures >= 5 ? 0 : failures, lockedUntil, user.id);
		return null;
	}

	await db.prepare(`
		UPDATE auth_users
		SET failed_login_count = 0, locked_until = NULL,
			last_login_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`).run(user.id);
	const identity = await db.prepare(`
		SELECT u.id, u.role, u.person_id AS personId, p.name AS personName, p.email,
			u.avatar_data_url AS avatarDataUrl
		FROM auth_users u JOIN people p ON p.id = u.person_id WHERE u.id = ?
	`).get(user.id);
	return identity ?? null;
}

export async function createSession(userId) {
	const db = getDatabase();
	const token = randomBytes(32).toString('base64url');
	const expiresAt = new Date(Date.now() + sessionHours() * 60 * 60_000);
	await db.batch([
		db.prepare('DELETE FROM auth_sessions WHERE expires_at <= ?').bind(new Date().toISOString()),
		db.prepare(`
			INSERT INTO auth_sessions (id, token_hash, user_id, expires_at)
			VALUES (?, ?, ?, ?)
		`).bind(randomUUID(), sha256(token), userId, expiresAt.toISOString())
	]);
	return { token, expiresAt };
}

export async function getSessionUser(token) {
	if (!token) return null;
	const db = getDatabase();
	const tokenHash = sha256(token);
	const now = new Date();
	const session = await db.prepare(`
		SELECT u.id, u.role, u.person_id AS personId, p.name AS personName, p.email,
			u.avatar_data_url AS avatarDataUrl, s.last_seen_at AS lastSeenAt
		FROM auth_sessions s
		JOIN auth_users u ON u.id = s.user_id
		JOIN people p ON p.id = u.person_id
		WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1 AND p.active = 1
	`).get(tokenHash, now.toISOString());
	if (!session) return null;
	if (shouldTouchSession(session.lastSeenAt, now.getTime())) {
		await db.prepare(`
			UPDATE auth_sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE token_hash = ?
		`).run(tokenHash);
	}
	const { lastSeenAt: _lastSeenAt, ...user } = session;
	return user;
}

export async function deleteSession(token) {
	if (!token) return;
	await getDatabase().prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(sha256(token));
}

export async function deleteOtherSessions(userId, currentToken) {
	if (!userId || !currentToken) return;
	await getDatabase().prepare(`
		DELETE FROM auth_sessions
		WHERE user_id = ? AND token_hash != ?
	`).run(userId, sha256(currentToken));
}

export function sessionCookieOptions(expires, secure = false, path = '/') {
	return {
		path,
		httpOnly: true,
		sameSite: /** @type {const} */ ('lax'),
		secure,
		expires
	};
}

export function canWrite(user) {
	return user?.role === AUTH_ROLES.admin;
}
