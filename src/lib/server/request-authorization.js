import { hasInternalTestFullAccess } from '../role-access.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** @param {string} method */
export function isSafeRequestMethod(method) {
	return SAFE_METHODS.has(method);
}

/**
 * Mirrors SvelteKit's named-action parsing for URLs such as `?/createProject`.
 * @param {URL} url
 */
export function actionNameFromUrl(url) {
	for (const [name] of url.searchParams) {
		if (name.startsWith('/')) return name.slice(1);
	}
	return 'default';
}

/**
 * @param {string | null | undefined} role
 * @param {string | null} routeId
 * @param {string} method
 * @param {string} actionName
 */
export function isAuthorizedRequest(role, routeId, method, actionName = 'default') {
	if (isSafeRequestMethod(method)) return true;
	return hasInternalTestFullAccess(role);
}
