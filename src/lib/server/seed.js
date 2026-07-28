// @ts-nocheck

const DEFAULT_PEOPLE = [
	['person-finance', '陈语桐', 'yutong.chen@example.com', '资金管理'],
	['person-business', '王岚', 'lan.wang@example.com', '业务部门'],
	['person-risk', '周明远', 'mingyuan.zhou@example.com', '风险合规']
];

const DEFAULT_SOPS = [
	{
		id: 'sop-short-term-financing',
		name: '短期融资券发行 SOP',
		debtType: '短期融资券',
		description: '适用于短期融资券的立项、申报、发行和存续期管理。',
		nodes: [
			['立项与方案确认', -45, '资金管理'],
			['材料准备与内部审批', -30, '业务部门'],
			['监管申报', -20, '风险合规'],
			['簿记发行', 0, '资金管理'],
			['发行后归档', 5, '资金管理']
		]
	},
	{
		id: 'sop-bond-issue',
		name: '债券发行 SOP',
		debtType: '公司债',
		description: '适用于公司债、小公募及私募债的标准发行流程。',
		nodes: [
			['融资方案确认', -75, '资金管理'],
			['中介机构协调', -60, '业务部门'],
			['申报材料定稿', -35, '风险合规'],
			['发行窗口确认', -10, '资金管理'],
			['簿记与缴款', 0, '资金管理']
		]
	}
];

const DEFAULT_PROJECTS = [
	{
		id: 'project-cp-2026-001',
		code: 'CP-2026-001',
		name: '2026 年第三期短期融资券',
		debtType: '短期融资券',
		amount: 1_500_000_000,
		status: 'in_progress',
		plannedStartDate: '2026-07-01',
		plannedIssueDate: '2026-08-18',
		plannedMaturityDate: '2026-11-16',
		sopTemplateId: 'sop-short-term-financing',
		ownerId: 'person-finance'
	},
	{
		id: 'project-bond-2026-001',
		code: 'BOND-2026-001',
		name: '2026 年公司债第一期',
		debtType: '公司债',
		amount: 2_000_000_000,
		status: 'planning',
		plannedStartDate: '2026-08-03',
		plannedIssueDate: '2026-09-25',
		plannedMaturityDate: '2029-09-25',
		sopTemplateId: 'sop-bond-issue',
		ownerId: 'person-business'
	}
];

const DEFAULT_TASKS = [
	['task-cp-1', 'project-cp-2026-001', 'sop-short-term-financing-node-1', '立项与方案确认', 'completed', 'person-finance', '2026-07-01', '2026-07-04', '2026-07-04', 1],
	['task-cp-2', 'project-cp-2026-001', 'sop-short-term-financing-node-2', '材料准备与内部审批', 'in_progress', 'person-business', '2026-07-05', '2026-08-03', null, 2],
	['task-cp-3', 'project-cp-2026-001', 'sop-short-term-financing-node-3', '监管申报', 'not_started', 'person-risk', '2026-08-04', '2026-08-10', null, 3],
	['task-cp-4', 'project-cp-2026-001', 'sop-short-term-financing-node-4', '簿记发行', 'not_started', 'person-finance', '2026-08-11', '2026-08-18', null, 4],
	['task-bond-1', 'project-bond-2026-001', 'sop-bond-issue-node-1', '融资方案确认', 'not_started', 'person-finance', '2026-08-03', '2026-08-12', null, 1],
	['task-bond-2', 'project-bond-2026-001', 'sop-bond-issue-node-2', '中介机构协调', 'not_started', 'person-business', '2026-08-13', '2026-08-28', null, 2],
	['task-bond-3', 'project-bond-2026-001', 'sop-bond-issue-node-3', '申报材料定稿', 'not_started', 'person-risk', '2026-08-31', '2026-09-14', null, 3]
];

export function seedDatabase(db) {
	const insertPerson = db.prepare(`
		INSERT INTO people (id, name, email, role)
		VALUES (@id, @name, @email, @role)
		ON CONFLICT(id) DO UPDATE SET
			name = excluded.name, email = excluded.email, role = excluded.role, updated_at = CURRENT_TIMESTAMP
	`);
	const insertTemplate = db.prepare(`
		INSERT INTO sop_templates (id, name, debt_type, description)
		VALUES (@id, @name, @debtType, @description)
		ON CONFLICT(name, debt_type) DO UPDATE SET description = excluded.description, updated_at = CURRENT_TIMESTAMP
	`);
	const insertNode = db.prepare(`
		INSERT INTO sop_nodes (id, template_id, name, sort_order, default_offset_days, default_owner_role)
		VALUES (@id, @templateId, @name, @sortOrder, @offsetDays, @ownerRole)
		ON CONFLICT(template_id, sort_order) DO UPDATE SET
			name = excluded.name,
			default_offset_days = excluded.default_offset_days,
			default_owner_role = excluded.default_owner_role,
			updated_at = CURRENT_TIMESTAMP
	`);
	const insertProject = db.prepare(`
		INSERT INTO projects (id, code, name, debt_type, amount, status, planned_start_date, planned_issue_date, planned_maturity_date, sop_template_id, owner_id)
		VALUES (@id, @code, @name, @debtType, @amount, @status, @plannedStartDate, @plannedIssueDate, @plannedMaturityDate, @sopTemplateId, @ownerId)
		ON CONFLICT(code) DO UPDATE SET
			name = excluded.name, debt_type = excluded.debt_type, amount = excluded.amount, status = excluded.status,
			planned_start_date = excluded.planned_start_date, planned_issue_date = excluded.planned_issue_date,
			planned_maturity_date = excluded.planned_maturity_date, sop_template_id = excluded.sop_template_id,
			owner_id = excluded.owner_id, updated_at = CURRENT_TIMESTAMP
	`);
	const insertTask = db.prepare(`
		INSERT INTO project_tasks (id, project_id, sop_node_id, name, status, assignee_id, planned_start_date, due_date, completed_at, sort_order)
		VALUES (@id, @projectId, @sopNodeId, @name, @status, @assigneeId, @plannedStartDate, @dueDate, @completedAt, @sortOrder)
		ON CONFLICT(id) DO UPDATE SET
			name = excluded.name, status = excluded.status, assignee_id = excluded.assignee_id,
			planned_start_date = excluded.planned_start_date, due_date = excluded.due_date,
			completed_at = excluded.completed_at, sort_order = excluded.sort_order, updated_at = CURRENT_TIMESTAMP
	`);

	db.transaction(() => {
		for (const [id, name, email, role] of DEFAULT_PEOPLE) insertPerson.run({ id, name, email, role });
		for (const template of DEFAULT_SOPS) {
			insertTemplate.run(template);
			template.nodes.forEach(([name, offsetDays, ownerRole], sortOrder) => {
				insertNode.run({
					id: `${template.id}-node-${sortOrder + 1}`,
					templateId: template.id,
					name,
					sortOrder: sortOrder + 1,
					offsetDays,
					ownerRole
				});
			});
		}
		for (const project of DEFAULT_PROJECTS) insertProject.run(project);
		for (const [id, projectId, sopNodeId, name, status, assigneeId, plannedStartDate, dueDate, completedAt, sortOrder] of DEFAULT_TASKS) {
			insertTask.run({ id, projectId, sopNodeId, name, status, assigneeId, plannedStartDate, dueDate, completedAt, sortOrder });
		}
	})();
}
