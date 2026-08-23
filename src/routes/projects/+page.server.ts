import { randomUUID } from 'node:crypto';
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getDatabase } from '$lib/server/db.js';
import { getAssignableDebtOptions, getProjectGanttData } from '$lib/server/queries.js';
import { auditRequestMeta, prepareAudit } from '$lib/server/audit.js';

const PROJECT_STATUSES = new Set(['planning', 'in_progress', 'at_risk', 'completed', 'cancelled']);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
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
	if (status === 'cancelled') return { label: '已取消', tone: 'gray' };
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
			rawStatus: project.status,
			owner: project.ownerName ?? '待分配',
			ownerId: project.ownerId ?? null,
			debtId: project.debtId ?? null,
			debtName: project.debtName ?? null,
			notes: project.notes ?? '',
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

async function activeSop(db: ReturnType<typeof getDatabase>, debtType: string) {
	return await db.prepare(`
		SELECT id FROM sop_templates
		WHERE is_active = TRUE AND (
			debt_type = @debtType OR
			(@debtType IN ('小公募', '私募债', '次级债') AND debt_type = '公司债')
		)
		ORDER BY CASE WHEN debt_type = @debtType THEN 0 ELSE 1 END LIMIT 1
	`).get({ debtType }) as { id: string } | undefined;
}

function projectDates(data: FormData) {
	return {
		startDate: String(data.get('startDate') ?? '').trim(),
		endDate: String(data.get('endDate') ?? '').trim()
	};
}

function invalidProjectDates(startDate: string, endDate: string) {
	if (!ISO_DATE.test(startDate) || !ISO_DATE.test(endDate)) return '请填写有效的计划开始日和完成日';
	if (endDate < startDate) return '计划完成日不能早于开始日';
	return null;
}

export const load: PageServerLoad = async ({ locals }) => {
	const db = getDatabase();
	const today = new Intl.DateTimeFormat('en-CA', {
		timeZone: 'Asia/Shanghai',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).format(new Date());
	const [projects, people, assignableDebts] = await Promise.all([
		mapProjects(),
		db.prepare('SELECT id, name, role FROM people WHERE active = TRUE ORDER BY name').all(),
		getAssignableDebtOptions()
	]);
	return {
		projects,
		people,
		assignableDebts,
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
		const debtId = String(data.get('debtId') ?? '').trim();
		const ownerId = String(data.get('ownerId') ?? '').trim();
		const { startDate, endDate } = projectDates(data);
		if (!/^\d+$/.test(debtId)) return fail(400, { message: '请选择一笔已经存在的负债' });
		const dateError = invalidProjectDates(startDate, endDate);
		if (dateError) return fail(400, { message: dateError });

		const db = getDatabase();
		if (ownerId && !await db.prepare('SELECT 1 FROM people WHERE id = ? AND active = TRUE').get(ownerId)) {
			return fail(400, { message: '负责人不存在或已停用' });
		}
		const debt = await db.prepare(`
			SELECT debt.id::text AS id, debt.name, debt.counterparty, debt.amount,
				debt.maturity_date AS maturityDate,
				COALESCE(NULLIF(debt.subtype, ''), debt.debt_type) AS projectDebtType
			FROM debt
			WHERE debt.id = ?::bigint AND debt.project_id IS NULL
		`).get(debtId) as any;
		if (!debt) return fail(409, { message: '该负债不存在或已绑定其他项目，请重新选择' });
		const sop = await activeSop(db, debt.projectDebtType);
		if (!sop) return fail(400, { message: '该负债品种没有启用中的 SOP，请先完成 SOP 配置' });

		const projectId = randomUUID();
		const code = `FIN-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${projectId.slice(0, 8).toUpperCase()}`;
		const nodes = await db.prepare(`
			SELECT id, name, sort_order AS sortOrder, default_offset_days AS offsetDays,
				default_owner_role AS ownerRole
			FROM sop_nodes WHERE template_id = ? ORDER BY sort_order
		`).all(sop.id);
		const assignees = await db.prepare('SELECT id, role FROM people WHERE active = TRUE ORDER BY name').all();
		const assigneeByRole = new Map<string, { id: string }>();
		for (const assignee of assignees as Array<{ id: string; role: string }>) {
			if (!assigneeByRole.has(assignee.role)) assigneeByRole.set(assignee.role, assignee);
		}
		const issueTime = Date.parse(`${endDate}T00:00:00Z`);
		try {
			await db.transaction(async (transaction: ReturnType<typeof getDatabase>) => {
				await transaction.prepare(`
					INSERT INTO projects (
						id, code, name, debt_type, borrower, amount, status,
						planned_start_date, planned_issue_date, planned_maturity_date,
						sop_template_id, owner_id
					) VALUES (?, ?, ?, ?, ?, ?, 'planning', ?, ?, ?, ?, ?)
				`).run(
					projectId, code, debt.name, debt.projectDebtType, debt.counterparty,
					debt.amount, startDate, endDate, debt.maturityDate, sop.id, ownerId || null
				);
				const linked = await transaction.prepare(`
					UPDATE debt SET project_id = ? WHERE id = ?::bigint AND project_id IS NULL
				`).run(projectId, debtId);
				if (linked.meta.changes !== 1) throw new Error('DEBT_ALREADY_BOUND');
				for (const node of nodes) {
					const dueDate = new Date(issueTime + Number(node.offsetDays) * 86_400_000).toISOString().slice(0, 10);
					const assignee = assigneeByRole.get(node.ownerRole) ?? (ownerId ? { id: ownerId } : undefined);
					await transaction.prepare(`
						INSERT INTO project_tasks (
							id, project_id, sop_node_id, name, status, assignee_id,
							planned_start_date, due_date, sort_order
						) VALUES (?, ?, ?, ?, 'not_started', ?, ?, ?, ?)
					`).run(randomUUID(), projectId, node.id, node.name, assignee?.id ?? null, startDate, dueDate, node.sortOrder);
				}
				await prepareAudit({
					...auditRequestMeta(event),
					db: transaction,
					action: 'project.create',
					entityType: 'project',
					entityId: projectId,
					summary: `从既有负债创建项目：${debt.name}`,
					after: {
						code,
						name: debt.name,
						debtId,
						debtType: debt.projectDebtType,
						status: 'planning',
						plannedStartDate: startDate,
						plannedIssueDate: endDate,
						sopTemplateId: sop.id,
						ownerId: ownerId || null
					}
				}).run();
			});
		} catch (error) {
			if (error instanceof Error && (error.message.includes('DEBT_ALREADY_BOUND') || error.message.includes('already linked'))) {
				return fail(409, { message: '该负债刚刚已被其他项目绑定，请重新选择' });
			}
			throw error;
		}
		return { success: true, projectId, message: '项目已绑定既有负债，并已套用对应 SOP 节点。' };
	},

	updateProject: async (event) => {
		const data = await event.request.formData();
		const projectId = String(data.get('id') ?? '').trim();
		const name = String(data.get('name') ?? '').trim();
		const status = String(data.get('status') ?? '').trim();
		const ownerId = String(data.get('ownerId') ?? '').trim();
		const notes = String(data.get('notes') ?? '').trim();
		const { startDate, endDate } = projectDates(data);
		if (!projectId || !name || name.length > 160) return fail(400, { message: '项目名称须为 1–160 个字符' });
		if (!PROJECT_STATUSES.has(status)) return fail(400, { message: '项目状态无效' });
		if (notes.length > 4000) return fail(400, { message: '项目说明不能超过 4,000 个字符' });
		const dateError = invalidProjectDates(startDate, endDate);
		if (dateError) return fail(400, { message: dateError });

		const db = getDatabase();
		if (ownerId && !await db.prepare('SELECT 1 FROM people WHERE id = ? AND active = TRUE').get(ownerId)) {
			return fail(400, { message: '负责人不存在或已停用' });
		}
		const before = await db.prepare(`
			SELECT id, name, status, owner_id AS ownerId,
				planned_start_date AS plannedStartDate, planned_issue_date AS plannedIssueDate, notes
			FROM projects WHERE id = ?
		`).get(projectId) as any;
		if (!before) return fail(404, { message: '项目不存在' });
		const after = {
			...before,
			name,
			status,
			ownerId: ownerId || null,
			plannedStartDate: startDate,
			plannedIssueDate: endDate,
			notes: notes || null
		};
		await db.batch([
			db.prepare(`
				UPDATE projects
				SET name = ?, status = ?, owner_id = ?, planned_start_date = ?,
					planned_issue_date = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
				WHERE id = ?
			`).bind(name, status, ownerId || null, startDate, endDate, notes || null, projectId),
			prepareAudit({
				...auditRequestMeta(event), db,
				action: 'project.update', entityType: 'project', entityId: projectId,
				summary: `更新项目：${name}`, before, after
			})
		]);
		return { success: true, updatedProjectId: projectId, message: `已更新项目 ${name}` };
	},

	deleteProject: async (event) => {
		const data = await event.request.formData();
		const projectId = String(data.get('id') ?? '').trim();
		const db = getDatabase();
		const before = projectId ? await db.prepare(`
			SELECT p.id, p.code, p.name, p.debt_type AS debtType, p.status,
				p.owner_id AS ownerId,
				(SELECT COUNT(*) FROM project_tasks task WHERE task.project_id = p.id) AS taskCount,
				(SELECT COUNT(*) FROM debt WHERE debt.project_id = p.id) AS debtCount
			FROM projects p WHERE p.id = ?
		`).get(projectId) as any : null;
		if (!before) return fail(404, { message: '项目不存在' });
		await db.batch([
			prepareAudit({
				...auditRequestMeta(event), db,
				action: 'project.delete', entityType: 'project', entityId: projectId,
				summary: `删除项目：${before.name}`, before
			}),
			db.prepare('DELETE FROM projects WHERE id = ?').bind(projectId)
		]);
		return {
			success: true,
			deletedProjectId: projectId,
			message: `已删除项目 ${before.name}；关联负债已保留并解除项目绑定`
		};
	}
};
