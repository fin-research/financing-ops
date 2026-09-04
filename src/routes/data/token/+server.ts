import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { currentDataApiJwt } from '$lib/server/auth.js';
import { getDataApiUrl } from '$lib/server/data-api.js';
import { hasPermission } from '$lib/permissions.js';

export const GET: RequestHandler = async (event) => {
	if (!event.locals.user) throw error(401, '登录已失效');
	if (!hasPermission(event.locals.permissions, 'data_manage')) throw error(403, '当前角色无权使用数据后台');
	const token = currentDataApiJwt(event);
	if (!token) throw error(503, '暂时无法取得 Neon Data API 令牌');
	return json(
		{ token, dataApiUrl: getDataApiUrl() },
		{ headers: { 'cache-control': 'no-store, private', vary: 'Cookie' } }
	);
};
