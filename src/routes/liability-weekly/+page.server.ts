import type { PageServerLoad } from './$types';
import { getLiabilityWeeklyReportData } from '$lib/server/queries.js';

export const load: PageServerLoad = async () => ({
	report: await getLiabilityWeeklyReportData()
});
