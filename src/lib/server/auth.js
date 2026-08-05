// @ts-nocheck
import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { getDatabase } from './db.js';

export const SESSION_COOKIE = 'financing_session';
export const AUTH_ROLES = Object.freeze({
	admin: 'admin',
	handler: 'handler',
	reviewer: 'reviewer'
});

const scrypt = promisify(scryptCallback);
const HASH_PREFIX = 'scrypt';
const KEY_LENGTH = 64;
const DEFAULT_SESSION_HOURS = 12;
let adminReady = false;
let runtimeConfig = {};

export function configureAuth(config = {}) {
	runtimeConfig = config;
}

function encode(value) {
	return Buffer.from(value).toString('base64url');
}

function decode(value) {
	return Buffer.from(value, 'base64url');
}

export async function hashPassword(password) {
	if (typeof password !== 'string' || password.length < 16) {
		throw new Error('密码长度不得少于 16 个字符');
	}
	const salt = randomBytes(16);
	const derived = await scrypt(password, salt, KEY_LENGTH, { N: 16384, r: 8, p: 1 });
	return `${HASH_PREFIX}$16384$8$1$${encode(salt)}$${encode(derived)}`;
}

export async function verifyPassword(password, storedHash) {
	const [prefix, n, r, p, salt, expected] = String(storedHash).split('$');
	if (prefix !== HASH_PREFIX || !n || !r || !p || !salt || !expected) return false;
	try {
		const expectedBuffer = decode(expected);
		const actual = await scrypt(password, decode(salt), expectedBuffer.length, {
			N: Number(n),
			r: Number(r),
			p: Number(p)
		});
		return actual.length === expectedBuffer.length && timingSafeEqual(actual, expectedBuffer);
	} catch {
		return false;
	}
}

export async function ensureAdminUser(config = runtimeConfig) {
	if (adminReady) return;
	const username = (config.ADMIN_USERNAME ?? process.env.ADMIN_USERNAME ?? 'admin').trim();
	const password = config.ADMIN_PASSWORD ?? process.env.ADMIN_PASSWORD;
	if (!password) {
		throw new Error('缺少 ADMIN_PASSWORD，无法初始化管理员账号');
	}

	const db = getDatabase();
	const existing = db.prepare(`
		SELECT id, person_id AS personId, password_hash AS passwordHash
		FROM auth_users WHERE username = ? COLLATE NOCASE
	`).get(username);
	if (!existing) {
		const passwordHash = await hashPassword(password);
		db.transaction(() => {
			const matchedPerson = db.prepare('SELECT id FROM people WHERE lower(name) = lower(?) LIMIT 1').get(username);
			const personId = matchedPerson?.id ?? randomUUID();
			if (!matchedPerson) {
				db.prepare(`
					INSERT INTO people (id, name, role, active) VALUES (?, ?, 'admin', 1)
				`).run(personId, username);
			} else {
				db.prepare(`
					UPDATE people SET role = 'admin', active = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?
				`).run(personId);
			}
			db.prepare(`
				INSERT INTO auth_users (id, person_id, username, password_hash, role, active)
				VALUES (?, ?, ?, ?, 'admin', 1)
			`).run(randomUUID(), personId, username, passwordHash);
		})();
	} else if (!(await verifyPassword(password, existing.passwordHash))) {
		const passwordHash = await hashPassword(password);
		db.transaction(() => {
			db.prepare(`
				UPDATE auth_users
				SET password_hash = ?, role = 'admin', active = 1,
					failed_login_count = 0, locked_until = NULL, updated_at = CURRENT_TIMESTAMP
				WHERE id = ?
			`).run(passwordHash, existing.id);
			db.prepare(`
				UPDATE people SET role = 'admin', active = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?
			`).run(existing.personId);
		})();
	} else {
		db.transaction(() => {
			db.prepare(`
				UPDATE auth_users SET role = 'admin', active = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?
			`).run(existing.id);
			db.prepare(`
				UPDATE people SET role = 'admin', active = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?
			`).run(existing.personId);
		})();
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

export async function authenticate(username, password) {
	await ensureAdminUser();
	const db = getDatabase();
	const user = db.prepare(`
		SELECT id, username, password_hash AS passwordHash, role, active,
			failed_login_count AS failedLoginCount, locked_until AS lockedUntil
		FROM auth_users WHERE username = ? COLLATE NOCASE
	`).get(username);

	const now = Date.now();
	if (!user || !user.active) return null;
	if (user.lockedUntil && Date.parse(user.lockedUntil) > now) return null;

	const valid = await verifyPassword(password, user.passwordHash);
	if (!valid) {
		const failures = Number(user.failedLoginCount) + 1;
		const lockedUntil = failures >= 5 ? new Date(now + 15 * 60_000).toISOString() : null;
		db.prepare(`
			UPDATE auth_users
			SET failed_login_count = ?, locked_until = ?, updated_at = CURRENT_TIMESTAMP
			WHERE id = ?
		`).run(failures >= 5 ? 0 : failures, lockedUntil, user.id);
		return null;
	}

	db.prepare(`
		UPDATE auth_users
		SET failed_login_count = 0, locked_until = NULL,
			last_login_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`).run(user.id);
	const identity = db.prepare(`
		SELECT u.id, u.username, u.role, u.person_id AS personId, p.name AS personName
		FROM auth_users u JOIN people p ON p.id = u.person_id WHERE u.id = ?
	`).get(user.id);
	return identity ?? null;
}

export function createSession(userId) {
	const db = getDatabase();
	const token = randomBytes(32).toString('base64url');
	const expiresAt = new Date(Date.now() + sessionHours() * 60 * 60_000);
	db.prepare(`
		INSERT INTO auth_sessions (id, token_hash, user_id, expires_at)
		VALUES (?, ?, ?, ?)
	`).run(randomUUID(), sha256(token), userId, expiresAt.toISOString());
	return { token, expiresAt };
}

export function getSessionUser(token) {
	if (!token) return null;
	const db = getDatabase();
	db.prepare('DELETE FROM auth_sessions WHERE expires_at <= ?').run(new Date().toISOString());
	const user = db.prepare(`
		SELECT u.id, u.username, u.role, u.person_id AS personId, p.name AS personName
		FROM auth_sessions s
		JOIN auth_users u ON u.id = s.user_id
		JOIN people p ON p.id = u.person_id
		WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1 AND p.active = 1
	`).get(sha256(token), new Date().toISOString());
	if (!user) return null;
	db.prepare(`
		UPDATE auth_sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE token_hash = ?
	`).run(sha256(token));
	return user;
}

export function deleteSession(token) {
	if (!token) return;
	getDatabase().prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(sha256(token));
}

export function sessionCookieOptions(expires, secure = false) {
	return {
		path: '/',
		httpOnly: true,
		sameSite: /** @type {const} */ ('lax'),
		secure,
		expires
	};
}

export function canWrite(user) {
	return user?.role === AUTH_ROLES.admin;
}
