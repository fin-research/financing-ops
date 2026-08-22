import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { currentDataApiJwt } from '$lib/server/auth.js';

export const GET: RequestHandler = async (event) => {
	if (!event.locals.user) throw error(401, '登录已失效');
	const token = currentDataApiJwt(event);
	if (!token) throw error(503, '暂时无法取得 Neon Data API 令牌');
	return json(
		{ token },
		{ headers: { 'cache-control': 'no-store, private', vary: 'Cookie' } }
	);
};
