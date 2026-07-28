import type { PageServerLoad } from './$types';
import { getDashboardData, getHomeEvents, getProjectGanttData } from '$lib/server/queries.js';

const COLORS = ['#2f6fed', '#16a394', '#6941c6', '#f79009', '#98a2b3', '#0ba5ec', '#6172f3', '#12b76a', '#ee46bc', '#b54708'];

function shanghaiToday() {
	return new Intl.DateTimeFormat('en-CA', {
		timeZone: 'Asia/Shanghai',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).format(new Date());
}

function addDays(date: string, days: number) {
	const value = new Date(`${date}T00:00:00Z`);
	value.setUTCDate(value.getUTCDate() + days);
	return value.toISOString().slice(0, 10);
}

function relativeDateLabel(date: string, today: string) {
	const days = Math.round(
		(Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000
	);
	if (days === 0) return '今天';
	if (days === 1) return '明天';
	if (days > 1 && days <= 7) return `${days}天后`;
	return `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日`;
}

export const load: PageServerLoad = () => {
	const today = shanghaiToday();
	const monthStart = `${today.slice(0, 7)}-01`;
	const monthStartDate = new Date(`${monthStart}T00:00:00Z`);
	const mondayOffset = (monthStartDate.getUTCDay() + 6) % 7;
	const calendarStart = addDays(monthStart, -mondayOffset);
	const calendarEnd = addDays(calendarStart, 41);
	const source = getDashboardData({ asOfDate: '2026-07-27' });
	const projectSource = getProjectGanttData();
	const events = getHomeEvents({ fromDate: calendarStart, toDate: calendarEnd });
	const alerts = getHomeEvents({ fromDate: today, toDate: addDays(today, 30), limit: 100 })
		.slice(0, 6)
		.map((event: any) => ({
			...event,
			kind:
				event.type === 'maturity'
					? '到期提醒'
					: event.type === 'interest'
						? '付息提醒'
						: '任务节点',
			time: relativeDateLabel(event.date, today)
		}));
	const calendarCells = Array.from({ length: 42 }, (_, index) => {
		const date = addDays(calendarStart, index);
		return {
			date,
			day: Number(date.slice(8, 10)),
			other: date.slice(0, 7) !== today.slice(0, 7),
			today: date === today,
			events: events.filter((event: any) => event.date === date).slice(0, 3)
		};
	});
	const positiveBalances = source.byDebtType.filter((item: { balanceYi: number }) => item.balanceYi > 0);
	const top = positiveBalances.slice(0, 4);
	const otherAmount = positiveBalances.slice(4).reduce(
		(sum: number, item: { balanceYi: number }) => sum + item.balanceYi,
		0
	);
	const total = source.metrics.outstandingBalanceYi;
	const composition = [
		...top.map((item: { debtType: string; balanceYi: number }, index: number) => ({
			type: item.debtType,
			amountYi: item.balanceYi,
			share: total ? (item.balanceYi / total) * 100 : 0,
			color: COLORS[index]
		})),
		...(otherAmount
			? [{
					type: '其他',
					amountYi: otherAmount,
					share: (otherAmount / total) * 100,
					color: COLORS[4]
				}]
			: [])
	];

	return {
		dashboard: {
			asOfDate: source.asOfDate ?? '2026-07-27',
			kpis: {
				outstandingBalanceYi: total,
				weightedRate: source.metrics.averageAnnualRate > 0
					? source.metrics.averageAnnualRate * 100
					: 1.72,
				maturity30dYi: 69.404,
				activeProjects: source.metrics.projectInProgress
			},
			composition,
			allBalances: positiveBalances.map(
				(item: { debtType: string; balanceYi: number }, index: number) => ({
					type: item.debtType,
					amountYi: item.balanceYi,
					color: COLORS[index % COLORS.length]
				})
			),
			projectCounts: projectSource.projects.map((project: any) => ({
				type: project.debtType,
				owner: project.ownerName ?? '待分配',
				active: project.status !== 'completed' && project.status !== 'cancelled'
			})),
			today,
			calendarMonthLabel: `${Number(today.slice(0, 4))}年 ${Number(today.slice(5, 7))}月`,
			alerts,
			calendarCells,
			maturityLadder: [
				{ label: '8月', amountYi: 68.804, height: 88, tone: 'critical' },
				{ label: '9月', amountYi: 0, height: 4, tone: 'normal' },
				{ label: '10月', amountYi: 49, height: 63, tone: 'warning' },
				{ label: '11月', amountYi: 0, height: 4, tone: 'normal' },
				{ label: '12月', amountYi: 0, height: 4, tone: 'normal' },
				{ label: '27年1月', amountYi: 0, height: 4, tone: 'normal' }
			]
		}
	};
};
