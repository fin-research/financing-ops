import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { isValidEmail, normalizeEmail } from '../src/lib/email.js';
import { createSchema } from '../src/lib/server/schema.js';
import { shouldTouchSession } from '../src/lib/server/session-policy.js';

test('session activity writes are limited to once per fifteen minutes', () => {
	const now = Date.parse('2026-08-20T00:30:00.000Z');
	assert.equal(shouldTouchSession('2026-08-20T00:20:01.000Z', now), false);
	assert.equal(shouldTouchSession('2026-08-20T00:15:00.000Z', now), true);
	assert.equal(shouldTouchSession(null, now), true);
});

test('login emails are normalized and validated', () => {
	assert.equal(normalizeEmail(' User@Example.COM '), 'user@example.com');
	assert.equal(isValidEmail('user@example.com'), true);
	assert.equal(isValidEmail('legacy-admin'), false);
});

test('person emails are unique without case sensitivity', (t) => {
	const sqlite = new Database(':memory:');
	t.after(() => sqlite.close());
	createSchema(sqlite);
	sqlite.prepare("INSERT INTO people (id, name, email, role) VALUES ('one', '甲', 'user@example.com', 'handler')").run();
	assert.throws(
		() => sqlite.prepare("INSERT INTO people (id, name, email, role) VALUES ('two', '乙', 'USER@example.com', 'reviewer')").run(),
		/UNIQUE constraint failed/
	);
});
