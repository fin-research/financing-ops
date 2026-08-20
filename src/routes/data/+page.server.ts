import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getDataImportData } from '$lib/server/queries.js';
import { getDatabase } from '$lib/server/db.js';
import { auditRequestMeta, prepareAudit } from '$lib/server/audit.js';
import { recalculateImportStatistics } from '$lib/server/import-statistics.js';

export const load: PageServerLoad = async () => ({
	importData: await getDataImportData()
});

export const actions: Actions = {
	recalculateStatistics: async (event) => {
		if (event.locals.user?.role !== 'admin') {
			return fail(403, { message: '仅管理员可以重新统计数据' });
		}
		try {
			const statistics = await recalculateImportStatistics(getDatabase());
			return {
				success: true,
				message: `已重新统计并保存快照：${statistics.debtCount.toLocaleString('zh-CN')} 笔负债、${statistics.cashflowEventCount.toLocaleString('zh-CN')} 条现金流、${statistics.historyDateCount.toLocaleString('zh-CN')} 个历史日期`
			};
		} catch (error) {
			return fail(400, { message: error instanceof Error ? error.message : String(error) });
		}
	},
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
		const before = await db.prepare('SELECT code, value_yi AS valueYi, period_end AS periodEnd FROM finance_parameters').all();
		try {
			await db.batch([
				...values.map((item) => db.prepare(`
					UPDATE finance_parameters SET value_yi = ?, period_end = ?, updated_at = CURRENT_TIMESTAMP WHERE code = ?
				`).bind(item.valueYi, item.periodEnd, item.code)),
				prepareAudit({
					...auditRequestMeta(event), db, action: 'update', entityType: 'finance_parameter',
					entityId: 'regulatory-capital-base', summary: '更新监管指标计算参数', before, after: values
				})
			]);
			return { success: true, message: '净资产与净资本参数已更新' };
		} catch (error) {
			return fail(400, { message: error instanceof Error ? error.message : String(error) });
		}
	},
	reimport: async () => fail(400, { message: '请选择当前 Excel 工作簿重新导入。' })
};
