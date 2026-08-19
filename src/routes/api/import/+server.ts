import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDatabase } from '$lib/server/db.js';
import {
	commitIncrementalImport,
	filterIncrementalRows,
	preflightIncrementalImport
} from '$lib/server/incremental-import.js';

export const POST: RequestHandler = async ({ request, locals }) => {
	if (locals.user?.role !== 'admin') return json({ message: '仅管理员可以导入负债台账' }, { status: 403 });
	try {
		const body = await request.json();
		const db = getDatabase();
		if (body.operation === 'preflight') {
			return json(await preflightIncrementalImport(db, body.metadata ?? {}));
		}
		if (body.operation === 'filter') {
			return json(await filterIncrementalRows(
				db,
				body.expectedWorkbookHash ?? null,
				String(body.key ?? ''),
				body.rows
			));
		}
		if (body.operation === 'commit') {
			return json(await commitIncrementalImport(db, body));
		}
		return json({ message: '未知导入操作' }, { status: 400 });
	} catch (error) {
		return json({ message: error instanceof Error ? error.message : String(error) }, { status: 400 });
	}
};
