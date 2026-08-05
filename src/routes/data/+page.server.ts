import { randomUUID } from 'node:crypto';
import { writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { importDebtWorkbook } from '$lib/server/excel-import.js';
import { getDataImportData } from '$lib/server/queries.js';
import { getDatabase } from '$lib/server/db.js';
import { auditRequestMeta, recordAudit } from '$lib/server/audit.js';

const defaultWorkbook = path.resolve('data', '东方财富证券借入资金汇总表20260727.xlsx');

export const load: PageServerLoad = () => ({
	importData: getDataImportData()
});

export const actions: Actions = {
	updateFinanceParameters: async (event) => {
		const data = await event.request.formData();
		const fields = [
			['securities_prior_year_net_assets', '证券上年末净资产'],
			['group_prior_year_net_assets', '集团上年末净资产'],
			['prior_month_net_capital', '上月末净资本']
		] as const;
		const values: Array<{ code: string; label: string; valueYi: number | null; periodEnd: string | null }> = [];
		for (const [code, label] of fields) {
			const rawValue = String(data.get(code) ?? '').trim();
			const periodEnd = String(data.get(`${code}_period_end`) ?? '').trim();
			const valueYi = rawValue === '' ? null : Number(rawValue);
			if (valueYi != null && (!Number.isFinite(valueYi) || valueYi <= 0)) {
				return fail(400, { message: `${label}必须是大于 0 的亿元数值` });
			}
			if (valueYi != null && !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)) {
				return fail(400, { message: `${label}需同时填写口径日期` });
			}
			values.push({ code, label, valueYi, periodEnd: valueYi == null ? null : periodEnd });
		}
		const db = getDatabase();
		const before = db.prepare('SELECT code, value_yi AS valueYi, period_end AS periodEnd FROM finance_parameters').all();
		const update = db.prepare(`
			UPDATE finance_parameters SET value_yi = ?, period_end = ?, updated_at = CURRENT_TIMESTAMP WHERE code = ?
		`);
		try {
			db.transaction(() => {
				for (const item of values) update.run(item.valueYi, item.periodEnd, item.code);
				recordAudit({
					...auditRequestMeta(event), db, action: 'update', entityType: 'finance_parameter',
					entityId: 'regulatory-capital-base', summary: '更新监管指标计算参数', before, after: values
				});
			})();
			return { success: true, message: '净资产与净资本参数已更新' };
		} catch (error) {
			return fail(400, { message: error instanceof Error ? error.message : String(error) });
		}
	},
	reimport: async () => {
		try {
			return { success: true, importResult: importDebtWorkbook(defaultWorkbook, { replaceExisting: true }) };
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
			return {
				success: true,
				importResult: importDebtWorkbook(temporaryPath, {
					sourceFileName: workbook.name,
					replaceExisting: true
				})
			};
		} catch (error) {
			return fail(500, { message: error instanceof Error ? error.message : String(error) });
		} finally {
			await unlink(temporaryPath).catch(() => undefined);
		}
	}
};
