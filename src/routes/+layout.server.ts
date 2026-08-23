import type { LayoutServerLoad } from './$types';
import { getLayoutData } from '$lib/server/queries.js';

export const load: LayoutServerLoad = async ({ locals }) => {
	const todayIso = new Intl.DateTimeFormat('en-CA', {
		timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
	}).format(new Date());
	const reminderEnd = new Date(Date.parse(`${todayIso}T00:00:00Z`) + 7 * 86_400_000)
		.toISOString()
		.slice(0, 10);
	const layout = locals.user
		? await getLayoutData({
				today: todayIso,
				toDate: reminderEnd,
				personId: locals.user.personId,
				ownOnly: locals.user.role === 'handler'
			})
		: { reminders: { items: [], total: 0 } };
	return {
		user: locals.user,
		reminders: layout.reminders
	};
};
