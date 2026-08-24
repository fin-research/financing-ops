import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDatabase } from '$lib/server/db.js';

const AVATAR_DATA = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/;

export const GET: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) throw error(401, '登录已失效');
	if (!locals.user.hasAvatar) throw error(404, '未设置头像');

	const etag = `"avatar-${locals.user.personId}-${locals.user.avatarVersion}"`;
	if (request.headers.get('if-none-match') === etag) {
		return new Response(null, {
			status: 304,
			headers: { ETag: etag, 'Cache-Control': 'private, max-age=31536000, immutable' }
		});
	}

	const row = await getDatabase().prepare(`
		SELECT avatar_data_url AS avatarDataUrl
		FROM people WHERE id = ? AND active = TRUE
	`).get(locals.user.personId) as { avatarDataUrl?: string } | undefined;
	const match = String(row?.avatarDataUrl ?? '').match(AVATAR_DATA);
	if (!match) throw error(404, '未设置头像');
	const body = Buffer.from(match[2], 'base64');
	return new Response(body, {
		headers: {
			'Content-Type': match[1],
			'Content-Length': String(body.byteLength),
			'Cache-Control': 'private, max-age=31536000, immutable',
			ETag: etag,
			'X-Content-Type-Options': 'nosniff'
		}
	});
};
