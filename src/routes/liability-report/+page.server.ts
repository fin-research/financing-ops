import type { PageServerLoad } from './$types';
import { getLiabilityWeeklyReportData } from '$lib/server/queries.js';
import { getDatabase } from '$lib/server/db.js';
import { fail } from '@sveltejs/kit';
import {
	getLiabilityWeeklyReportHistory,
	getLiabilityWeeklyReportSourceStatus,
	readLiabilityWeeklyReportSnapshot,
	saveLiabilityWeeklyReportSnapshot
} from '$lib/server/liability-weekly-reports.js';

const MAX_SOURCE_PAYLOAD_LENGTH = 4_000_000;

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
	const configuredDataApiUrl = platform?.env?.CHOICE_DATA_API_URL;
	const dataApiUrl = String(configuredDataApiUrl || new URL('/data', url.origin))
		.replace(/\/$/, '');
	return {
		report,
		reportHistory,
		selectedRunId: selectedRun?.id ?? null,
		snapshotError,
		liveAsOfDate: liveReport.asOfDate,
		dataApiUrl
	};
};

export const actions = {
	saveSnapshot: async (event) => {
		const data = await event.request.formData();
		const sourcesPayload = String(data.get('sources') ?? '');
		if (!sourcesPayload || sourcesPayload.length > MAX_SOURCE_PAYLOAD_LENGTH) {
			return fail(400, { message: '周报数据源为空或超过快照大小限制' });
		}
		let sources;
		try {
			sources = JSON.parse(sourcesPayload);
		} catch {
			return fail(400, { message: '周报数据源格式无效' });
		}
		try {
			const result = await saveLiabilityWeeklyReportSnapshot({
				database: getDatabase(event),
				env: event.platform?.env,
				actor: event.locals.user,
				sources,
				expectedAsOfDate: String(data.get('asOfDate') ?? '')
			});
			return {
				success: true,
				reportRunId: result.id,
				missingModules: result.missingModules,
				message: `已生成 ${result.asOfDate} 周报快照`
			};
		} catch (error: any) {
			return fail(503, { message: `周报快照保存失败：${String(error?.message ?? error)}` });
		}
	}
};
