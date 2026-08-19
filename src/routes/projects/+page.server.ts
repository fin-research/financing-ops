import { randomUUID } from 'node:crypto';
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getDatabase } from '$lib/server/db.js';
import {
	getActiveSopDebtTypeOptions,
	getProjectGanttData
} from '$lib/server/queries.js';
import { auditRequestMeta, prepareAudit } from '$lib/server/audit.js';

const timelineStart = Date.parse('2026-07-20T00:00:00Z');
const timelineEnd = Date.parse('2026-08-31T00:00:00Z');
const timelineSpan = timelineEnd - timelineStart;

function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
}

function position(date: string | null | undefined) {
	if (!date) return 0;
	return clamp(((Date.parse(`${date}T00:00:00Z`) - timelineStart) / timelineSpan) * 100, 0, 100);
}

function statusMeta(status: string) {
	if (status === 'completed') return { label: '已完成', tone: 'gray' };
	if (status === 'at_risk') return { label: '延期风险', tone: 'orange' };
	if (status === 'in_progress') return { label: '执行中', tone: 'blue' };
	return { label: '需求确认', tone: 'teal' };
}

function dueText(date: string | null | undefined) {
	if (!date) return '待安排';
	const today = new Intl.DateTimeFormat('en-CA', {
		timeZone: 'Asia/Shanghai',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).format(new Date());
	const days = Math.ceil((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
	if (days === 0) return '今天';
	if (days === 1) return '明天';
	if (days > 1 && days <= 7) return `${days}天后`;
	return date.slice(5).replace('-', '月') + '日';
}

async function mapProjects() {
	const source = await getProjectGanttData();
	return source.projects.map((project: any) => {
		const tasks = project.tasks;
		const completed = tasks.filter((task: any) => task.status === 'completed').length;
		const progress = tasks.length
			? Math.round((completed / tasks.length) * 100)
			: project.status === 'completed' ? 100 : 0;
		const start = project.plannedStartDate ?? project.plannedIssueDate ?? '2026-07-28';
		const end = project.plannedIssueDate ?? project.plannedMaturityDate ?? start;
		const startPct = position(start);
		const endPct = Math.max(position(end), startPct + 5);
		const nextTask = tasks.find((task: any) => task.status !== 'completed');
		const meta = statusMeta(project.status);
		const members = [...new Set([project.ownerName, ...tasks.map((task: any) => task.assigneeName)]
			.filter((name: unknown): name is string => typeof name === 'string' && name.length > 0)
			.map((name) => name.slice(0, 1)))];

		return {
			id: project.id,
			code: project.code,
			name: project.name,
			type: project.debtType,
			owner: project.ownerName ?? '待分配',
			ownerId: project.ownerId ?? null,
			status: meta.label,
			progress,
			start,
			end,
			startPct,
			widthPct: clamp(endPct - startPct, 5, 100 - startPct),
			tone: meta.tone,
			nextNode: nextTask?.name ?? '项目归档',
			dueText: dueText(nextTask?.dueDate ?? end),
			members: members.length ? members : ['待'],
			tasks: tasks.map((task: any) => {
				const taskStart = position(task.plannedStartDate ?? start);
				const taskEnd = Math.max(position(task.dueDate ?? task.plannedStartDate ?? start), taskStart + 3);
				return {
					name: task.name,
					status: task.status === 'completed' ? 'done' : task.status === 'in_progress' ? 'doing' : 'waiting',
					startPct: taskStart,
					widthPct: clamp(taskEnd - taskStart, 3, 100 - taskStart)
				};
			})
		};
	});
}

export const load: PageServerLoad = async ({ locals }) => {
	const db = getDatabase();
	const today = new Intl.DateTimeFormat('en-CA', {
		timeZone: 'Asia/Shanghai',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).format(new Date());
	const [projects, people, activeSopDebtTypes] = await Promise.all([
		mapProjects(),
		db.prepare('SELECT id, name FROM people WHERE active = 1 ORDER BY name').all(),
		getActiveSopDebtTypeOptions()
	]);
	return {
		projects,
		people,
		activeSopDebtTypes,
		today,
		viewContext: {
			role: locals.user?.role ?? 'reviewer',
			personId: locals.user?.personId ?? null,
			personName: locals.user?.personName ?? null,
			defaultOwnProjects: locals.user?.role === 'handler'
		}
	};
};

export const actions: Actions = {
	createProject: async (event) => {
		const data = await event.request.formData();
		const name = String(data.get('name') ?? '').trim();
		const debtType = String(data.get('debtType') ?? '').trim();
		const ownerName = String(data.get('owner') ?? '').trim();
		const startDate = String(data.get('startDate') ?? '').trim();
		const endDate = String(data.get('endDate') ?? '').trim();
		if (!name || !debtType || !startDate || !endDate) return fail(400, { message: '请完整填写项目资料' });
		if (endDate < startDate) return fail(400, { message: '计划完成日不能早于开始日' });

		const db = getDatabase();
		const owner = (await db.prepare('SELECT id FROM people WHERE name = ?').get(ownerName))
			?? await db.prepare('SELECT id FROM people WHERE active = 1 ORDER BY name LIMIT 1').get();
		const sop = await db.prepare(`
			SELECT id FROM sop_templates
			WHERE is_active = 1 AND (
				debt_type = @debtType OR
				(@debtType IN ('小公募', '私募债', '次级债') AND debt_type = '公司债')
			)
			ORDER BY CASE WHEN debt_type = @debtType THEN 0 ELSE 1 END LIMIT 1
		`).get({ debtType });
		if (!sop) {
			return fail(400, { message: '该负债品种没有启用中的 SOP，请先完成 SOP 配置' });
		}
		const projectId = randomUUID();
		const code = `FIN-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}`;
		const nodes = await db.prepare(`
			SELECT id, name, sort_order AS sortOrder, default_offset_days AS offsetDays,
				default_owner_role AS ownerRole
			FROM sop_nodes WHERE template_id = ? ORDER BY sort_order
		`).all(sop.id);
		const assignees = await db.prepare(`
			SELECT id, role FROM people WHERE active = 1
			ORDER BY name
		`).all();
		const assigneeByRole = new Map<string, { id: string }>();
		for (const assignee of assignees as Array<{ id: string; role: string }>) {
			if (!assigneeByRole.has(assignee.role)) assigneeByRole.set(assignee.role, assignee);
		}
		const statements = [
			db.prepare(`
				INSERT INTO projects (
					id, code, name, debt_type, status, planned_start_date,
					planned_issue_date, sop_template_id, owner_id
				) VALUES (?, ?, ?, ?, 'planning', ?, ?, ?, ?)
			`).bind(projectId, code, name, debtType, startDate, endDate, sop.id, owner?.id ?? null)
		];
		const issueTime = Date.parse(`${endDate}T00:00:00Z`);
		for (const node of nodes) {
			const dueDate = new Date(issueTime + Number(node.offsetDays) * 86_400_000).toISOString().slice(0, 10);
			const assignee = assigneeByRole.get(node.ownerRole) ?? owner;
			statements.push(db.prepare(`
						INSERT INTO project_tasks (
							id, project_id, sop_node_id, name, status, assignee_id,
							planned_start_date, due_date, sort_order
						) VALUES (?, ?, ?, ?, 'not_started', ?, ?, ?, ?)
					`).bind(randomUUID(), projectId, node.id, node.name, assignee?.id ?? null, startDate, dueDate, node.sortOrder));
		}
		statements.push(prepareAudit({
				...auditRequestMeta(event),
				db,
				action: 'create',
				entityType: 'project',
				entityId: projectId,
				summary: `创建项目：${name}`,
				after: {
					code,
					name,
					debtType,
					status: 'planning',
					plannedStartDate: startDate,
					plannedIssueDate: endDate,
					sopTemplateId: sop.id,
					ownerId: owner?.id ?? null
				}
			}));
		await db.batch(statements);
		return { success: true, projectId, message: '项目已创建，并已套用对应 SOP 节点。' };
	}
};
