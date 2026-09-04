const ROLE_CODES = new Set(['admin', 'handler', 'reviewer']);

export const INTERNAL_TEST_FULL_ACCESS = true;

/** @param {string | null | undefined} role */
export function hasInternalTestFullAccess(role) {
	return INTERNAL_TEST_FULL_ACCESS && role != null && ROLE_CODES.has(role);
}
