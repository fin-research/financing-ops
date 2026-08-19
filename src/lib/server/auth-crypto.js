// @ts-nocheck
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const HASH_PREFIX = 'scrypt';
const KEY_LENGTH = 64;

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
