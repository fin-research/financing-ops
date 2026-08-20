import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldTouchSession } from '../src/lib/server/session-policy.js';

test('session activity writes are limited to once per fifteen minutes', () => {
	const now = Date.parse('2026-08-20T00:30:00.000Z');
	assert.equal(shouldTouchSession('2026-08-20T00:20:01.000Z', now), false);
	assert.equal(shouldTouchSession('2026-08-20T00:15:00.000Z', now), true);
	assert.equal(shouldTouchSession(null, now), true);
});
