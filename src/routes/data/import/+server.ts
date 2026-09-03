import { randomUUID } from 'node:crypto';
import { json } from '@sveltejs/kit';
import { getDatabase } from '$lib/server/db.js';
import {
	createDebtImportRun,
	failDebtImportRun,
	listDebtImportRuns,
	stageDebtImportPayload
} from '$lib/server/debt-import-runs.js';
import { transformWorkbook } from '../../../../scripts/lib/debt-transform.mjs';
import { parseDebtWorkbookData } from '../../../../scripts/lib/excel-import.mjs';
import { sha256Hex } from '../../../../scripts/lib/hash.mjs';
import type { RequestHandler } from './$types';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const RUN_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRIVATE_JSON_HEADERS = {
	'cache-control': 'no-store, private',
	vary: 'Cookie'
};

function requireAdmin(locals: App.Locals) {
	return locals.user?.role === 'admin';
}

function uploadFileName(request: Request) {
	const encoded = request.headers.get('x-import-filename');
	if (!encoded) throw new Error('请选择借入资金汇总表文件');
	let decoded: string;
	try {
		decoded = decodeURIComponent(encoded);
	} catch {
		throw new Error('文件名编码无效');
	}
	const name = decoded.split(/[/\\]/).at(-1)?.trim() ?? '';
	if (!name.toLowerCase().endsWith('.xlsx')) throw new Error('仅支持 .xlsx 格式的借入资金汇总表');
	if (!name || name.length > 240) throw new Error('文件名无效或过长');
	return name;
}

function uploadSize(request: Request) {
	const value = request.headers.get('content-length') ?? request.headers.get('x-import-file-size');
	const size = Number(value);
	if (!Number.isInteger(size) || size <= 0) throw new Error('无法确认上传文件大小');
	if (size > MAX_UPLOAD_BYTES) throw new Error('文件超过 10 MB 上限');
	return size;
}

function workbookSummary(transformed: ReturnType<typeof transformWorkbook>) {
	return {
		asOfDate: transformed.snapshot.asOfDate,
		totalYi: transformed.snapshot.totalYi,
		debtCount: transformed.debts.length,
		cashflowCount: transformed.cashflows.length,
		balanceCount: transformed.balances.length
	};
}

function workbookError(error: unknown) {
	const message = error instanceof Error ? error.message : String(error);
	return message.slice(0, 1000) || '工作簿解析失败';
}

export const GET: RequestHandler = async ({ locals }) => {
	if (!requireAdmin(locals)) return json({ error: '仅管理员可查看台账导入记录' }, { status: 403 });
	const runs = await listDebtImportRuns(getDatabase(), 8);
	return json({ runs }, { headers: PRIVATE_JSON_HEADERS });
};

export const POST: RequestHandler = async ({ request, url, locals, platform }) => {
	if (!requireAdmin(locals)) return json({ error: '仅管理员可上传借入资金汇总表' }, { status: 403 });
	if (request.headers.get('origin') !== url.origin) {
		return json({ error: '上传请求来源无效，请刷新页面后重试' }, { status: 403 });
	}
	if (!request.body) return json({ error: '请选择借入资金汇总表文件' }, { status: 400 });

	let fileName: string;
	let claimedSize: number;
	try {
		fileName = uploadFileName(request);
		claimedSize = uploadSize(request);
	} catch (error) {
		return json({ error: workbookError(error) }, { status: 400 });
	}

	const requestedRunId = request.headers.get('x-import-run-id')?.trim();
	const runId = requestedRunId && RUN_ID_PATTERN.test(requestedRunId) ? requestedRunId : randomUUID();
	const workflowInstanceId = `debt-import-${runId}`;
	const database = getDatabase();
	try {
		await createDebtImportRun(database, {
			id: runId,
			workflowInstanceId,
			fileName,
			fileSizeBytes: claimedSize,
			createdByPersonId: locals.user!.personId
		});
	} catch (error: any) {
		if (error?.code === '23505') {
			return json({ error: '已有台账正在解析或导入，请等待当前任务完成' }, { status: 409 });
		}
		throw error;
	}

	let run;
	try {
		const workbookData = await request.arrayBuffer();
		if (workbookData.byteLength > MAX_UPLOAD_BYTES) throw new Error('文件超过 10 MB 上限');
		const signature = new Uint8Array(workbookData, 0, Math.min(4, workbookData.byteLength));
		if (signature[0] !== 0x50 || signature[1] !== 0x4b) throw new Error('文件不是有效的 .xlsx 工作簿');
		const parsed = parseDebtWorkbookData(workbookData, fileName);
		const transformed = transformWorkbook(parsed);
		run = await stageDebtImportPayload(database, {
			runId,
			payload: transformed,
			sourceSha256: sha256Hex(workbookData),
			fileSizeBytes: workbookData.byteLength,
			parsed: workbookSummary(transformed)
		});
	} catch (error) {
		const message = workbookError(error);
		await failDebtImportRun(database, runId, message);
		return json({ runId, error: message }, { status: 400, headers: PRIVATE_JSON_HEADERS });
	}

	if (!platform?.env?.DEBT_IMPORT_WORKFLOW) {
		const message = 'Workflow 启动失败，请稍后重试';
		await failDebtImportRun(database, runId, message);
		return json({ runId, error: message }, { status: 503, headers: PRIVATE_JSON_HEADERS });
	}
	try {
		await platform.env.DEBT_IMPORT_WORKFLOW.create({
			id: workflowInstanceId,
			params: { runId }
		});
		return json({ run }, { status: 202, headers: PRIVATE_JSON_HEADERS });
	} catch (error) {
		console.error('Failed to create debt import Workflow instance', error);
		const message = 'Workflow 启动失败，请稍后重试';
		await failDebtImportRun(database, runId, message);
		return json({ runId, error: message }, { status: 503, headers: PRIVATE_JSON_HEADERS });
	}
};
