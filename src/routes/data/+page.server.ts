import { randomUUID } from 'node:crypto';
import { writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { importDebtWorkbook } from '$lib/server/excel-import.js';
import { getDataImportData } from '$lib/server/queries.js';

const defaultWorkbook = path.resolve('data', '东方财富证券借入资金汇总表20260727.xlsx');

export const load: PageServerLoad = () => ({
	importData: getDataImportData()
});

export const actions: Actions = {
	reimport: async () => {
		try {
			return { success: true, importResult: importDebtWorkbook(defaultWorkbook) };
		} catch (error) {
			return fail(500, { message: error instanceof Error ? error.message : String(error) });
		}
	},
	upload: async ({ request }) => {
		const data = await request.formData();
		const workbook = data.get('workbook');
		if (!(workbook instanceof File) || workbook.size === 0) {
			return fail(400, { message: '请选择 Excel 文件' });
		}
		if (!workbook.name.toLowerCase().endsWith('.xlsx')) {
			return fail(400, { message: '仅支持 .xlsx 文件' });
		}
		if (workbook.size > 25 * 1024 * 1024) {
			return fail(413, { message: '文件不能超过 25MB' });
		}

		const temporaryPath = path.join(os.tmpdir(), `financing-workbench-${randomUUID()}.xlsx`);
		try {
			await writeFile(temporaryPath, Buffer.from(await workbook.arrayBuffer()));
			return { success: true, importResult: importDebtWorkbook(temporaryPath) };
		} catch (error) {
			return fail(500, { message: error instanceof Error ? error.message : String(error) });
		} finally {
			await unlink(temporaryPath).catch(() => undefined);
		}
	}
};
