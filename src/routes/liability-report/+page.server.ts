import type { PageServerLoad } from './$types';
import { getLiabilityWeeklyReportData } from '$lib/server/queries.js';
import { getDatabase } from '$lib/server/db.js';
import { fail } from '@sveltejs/kit';
import {
	generateLiabilityWeeklyReport,
	getLiabilityWeeklyReportHistory,
	getLiabilityWeeklyReportSourceStatus,
	readLiabilityWeeklyReportSnapshot
} from '$lib/server/liability-weekly-reports.js';

export const load: PageServerLoad = async ({ url, platform }) => {
	const database = getDatabase();
	const [liveReport, history] = await Promise.all([
		getLiabilityWeeklyReportData(),
		getLiabilityWeeklyReportHistory(database)
	]);
	const selectedRunId = url.searchParams.get('run');
	const reportHistory = history as any[];
	const selectedRun = reportHistory.find((item) => item.id === selectedRunId) ?? reportHistory[0] ?? null;
	let report: any = liveReport;
	let snapshotError: string | null = null;
	if (selectedRun && platform?.env?.LIABILITY_REPORT_SNAPSHOTS) {
		try {
			const snapshot = await readLiabilityWeeklyReportSnapshot(platform.env, selectedRun);
			report = { ...snapshot.report, provenance: snapshot.provenance };
		} catch (error: any) {
			snapshotError = String(error?.message ?? error);
		}
	}
	if (!report.provenance) {
		const sourceStatus = await getLiabilityWeeklyReportSourceStatus(database, report.asOfDate);
		const missingModules = [...sourceStatus.missingModules];
		if (!report.quality.liveDerivedReliable) {
			missingModules.push({
				code: 'reconciliation',
				title: '负债明细与余额快照勾稽',
				detail: `明细余额与 ${report.asOfDate} 快照相差 ${Math.abs(report.quality.reconciliationDeltaYi).toFixed(4)} 亿元；保留明细展示，但金额须核对。`
			});
		}
		report.provenance = {
			generation: 'live-preview',
			missingModules
		};
	}
	return { report, reportHistory, selectedRunId: selectedRun?.id ?? null, snapshotError };
};

export const actions = {
	generate: async (event) => {
		const data = await event.request.formData();
		if (String(data.get('confirm') ?? '') !== 'yes') {
			return fail(400, { message: '请确认手动生成；本次最多各发起一次 EDB 和 CTR 逻辑请求，失败请求可重试且不计配额。' });
		}
		try {
			const result = await generateLiabilityWeeklyReport({
				database: getDatabase(event),
				env: event.platform?.env,
				actor: event.locals.user
			});
			return { success: true, reportRunId: result.id, message: `已生成 ${result.asOfDate} 周报快照` };
		} catch (error: any) {
			return fail(503, { message: `周报生成失败：${String(error?.message ?? error)}` });
		}
	}
};
