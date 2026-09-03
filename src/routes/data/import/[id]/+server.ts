import { json } from '@sveltejs/kit';
import { getDatabase } from '$lib/server/db.js';
import { getDebtImportRun } from '$lib/server/debt-import-runs.js';
import type { RequestHandler } from './$types';

const RUN_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const GET: RequestHandler = async ({ params, locals }) => {
	if (locals.user?.role !== 'admin') {
		return json({ error: '仅管理员可查看台账导入进度' }, { status: 403 });
	}
	if (!RUN_ID_PATTERN.test(params.id)) return json({ error: '导入任务编号无效' }, { status: 400 });
	const run = await getDebtImportRun(getDatabase(), params.id);
	if (!run) return json({ error: '未找到导入任务' }, { status: 404 });
	return json({ run }, {
		headers: {
			'cache-control': 'no-store, private',
			vary: 'Cookie'
		}
	});
};
