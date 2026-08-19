import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDatabase } from '$lib/server/db.js';
import { beginStagedImport, finalizeStagedImport, stageImportRows } from '$lib/server/staged-import.js';

export const POST: RequestHandler = async ({ request, locals }) => {
	if (locals.user?.role !== 'admin') return json({ message: '仅管理员可以导入负债台账' }, { status: 403 });
	try {
		const body = await request.json();
		const db = getDatabase();
		if (body.operation === 'begin') return json(await beginStagedImport(db, body.metadata ?? {}));
		if (body.operation === 'stage') {
			return json(await stageImportRows(db, String(body.token ?? ''), String(body.key ?? ''), body.rows));
		}
		if (body.operation === 'finalize') {
			return json(await finalizeStagedImport(db, String(body.token ?? '')));
		}
		return json({ message: '未知导入操作' }, { status: 400 });
	} catch (error) {
		return json({ message: error instanceof Error ? error.message : String(error) }, { status: 400 });
	}
};
