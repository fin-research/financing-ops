const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const AUTHENTICATED_POST_ACTIONS = new Set([
	'/logout:default',
	'/settings:updateProfile',
	'/settings:updatePassword',
	'/projects/[id]:updateOwnTaskStatus'
]);
const REVIEWER_CREATE_ACTIONS = new Set([
	'/people:createPerson',
	'/projects:createProject',
	'/sop:createSop',
	'/liability-report:saveSnapshot'
]);

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
	if (role === 'admin') return true;
	if (method !== 'POST' || (role !== 'handler' && role !== 'reviewer')) return false;
	const actionKey = `${routeId ?? ''}:${actionName}`;
	if (AUTHENTICATED_POST_ACTIONS.has(actionKey)) return true;
	return role === 'reviewer' && REVIEWER_CREATE_ACTIONS.has(actionKey);
}
