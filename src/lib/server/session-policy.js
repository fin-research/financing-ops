const SESSION_TOUCH_INTERVAL_MS = 15 * 60_000;

/** @param {string | null | undefined} lastSeenAt @param {number} now */
export function shouldTouchSession(lastSeenAt, now = Date.now()) {
	const lastSeen = Date.parse(String(lastSeenAt ?? ''));
	return !Number.isFinite(lastSeen) || now - lastSeen >= SESSION_TOUCH_INTERVAL_MS;
}
