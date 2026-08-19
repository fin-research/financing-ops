import type { LayoutServerLoad } from './$types';
import { getDataImportData, getTopbarReminders } from '$lib/server/queries.js';

export const load: LayoutServerLoad = async ({ locals }) => {
	const currentSnapshot = (await getDataImportData()).currentSnapshot;
	const todayIso = new Intl.DateTimeFormat('en-CA', {
		timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
	}).format(new Date());
	const reminderEnd = new Date(Date.parse(`${todayIso}T00:00:00Z`) + 7 * 86_400_000)
		.toISOString()
		.slice(0, 10);
	const reminders = locals.user
		? await getTopbarReminders({
				today: todayIso,
				toDate: reminderEnd,
				personId: locals.user.personId,
				ownOnly: locals.user.role === 'handler'
			})
		: { items: [], total: 0 };
	return {
		user: locals.user,
		dataAsOfDate: currentSnapshot?.asOfDate ?? null,
		reminders
	};
};
