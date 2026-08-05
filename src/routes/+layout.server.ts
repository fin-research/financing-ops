import type { LayoutServerLoad } from './$types';
import { getDataImportData } from '$lib/server/queries.js';

export const load: LayoutServerLoad = ({ locals }) => {
	const currentSnapshot = getDataImportData().currentSnapshot;
	return {
		user: locals.user,
		today: new Intl.DateTimeFormat('zh-CN', {
			timeZone: 'Asia/Shanghai', year: 'numeric', month: 'long', day: 'numeric'
		}).format(new Date()),
		dataAsOfDate: currentSnapshot?.asOfDate ?? null
	};
};
