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
		code: 'SUB-2026-001',
		name: '2026 年公募次级债',
		debtType: '次级债',
		amount: 3_000_000_000,
		status: 'in_progress',
		plannedStartDate: '2026-07-01',
		plannedIssueDate: '2026-08-13',
		plannedMaturityDate: '2029-08-13',
		sopTemplateId: 'sop-bond-issue',
		notes: '3Y/5Y',
		ownerId: 'person-finance'
	},
	{
		id: 'project-bond-2026-001',
		code: 'BOND-2026-001',
		name: '2026 年小公募公司债',
		debtType: '小公募',
		amount: 4_000_000_000,
		status: 'planning',
		plannedStartDate: '2026-07-15',
		plannedIssueDate: '2026-08-20',
		plannedMaturityDate: '2029-08-20',
		sopTemplateId: 'sop-bond-issue',
		notes: '3Y/5Y',
		ownerId: 'person-business'
	}
];

const DEFAULT_TASKS = [
	['task-cp-1', 'project-cp-2026-001', 'sop-bond-issue-node-1', '融资方案确认', 'completed', 'person-finance', '2026-07-01', '2026-07-04', '2026-07-04', 1],
	['task-cp-2', 'project-cp-2026-001', 'sop-bond-issue-node-2', '中介机构协调', 'in_progress', 'person-business', '2026-07-05', '2026-08-03', null, 2],
	['task-cp-3', 'project-cp-2026-001', 'sop-bond-issue-node-3', '申报材料定稿', 'not_started', 'person-risk', '2026-08-04', '2026-08-10', null, 3],
	['task-cp-4', 'project-cp-2026-001', 'sop-bond-issue-node-5', '簿记与缴款', 'not_started', 'person-finance', '2026-08-11', '2026-08-13', null, 4],
	['task-bond-1', 'project-bond-2026-001', 'sop-bond-issue-node-1', '融资方案确认', 'not_started', 'person-finance', '2026-08-03', '2026-08-12', null, 1],
	['task-bond-2', 'project-bond-2026-001', 'sop-bond-issue-node-2', '中介机构协调', 'not_started', 'person-business', '2026-08-13', '2026-08-28', null, 2],
	['task-bond-3', 'project-bond-2026-001', 'sop-bond-issue-node-3', '申报材料定稿', 'not_started', 'person-risk', '2026-08-31', '2026-09-14', null, 3]
];

const DEBT_TYPE_CATALOG = [
	['yield_certificate', '收益凭证', null, '收益凭证', '收益凭证', 10],
	['yield_floating', '浮动收益凭证', 'yield_certificate', '浮收', '收益凭证', 11],
	['yield_fixed', '固定收益凭证', 'yield_certificate', '固收', '收益凭证', 12],
	['bond', '债券', null, '债券', '债券', 20],
	['bond_public', '小公募', 'bond', '小公募', '小公募', 21],
	['bond_subordinated', '次级债', 'bond', '次级债', '次级债', 22],
	['bond_private', '私募债', 'bond', '私募债', '私募债', 23],
	['bond_tech', '科创债', 'bond', '科创债', '科创债', 24],
	['bond_cp', '短期融资券', 'bond', '短融', '短期融资券', 25],
	['refinancing', '转融资', null, '转融资', '转融资', 30],
	['group_loan', '集团借款', null, '集团借款', '集团借款', 40],
	['interbank', '同业拆借', null, '同业拆借', '同业拆借', 50],
	['swap_facility', '互换便利', null, '互换便利', '互换便利', 60]
];

const FINANCE_PARAMETERS = [
	['securities_prior_year_net_assets', '证券上年末净资产'],
	['group_prior_year_net_assets', '集团上年末净资产'],
	['prior_month_net_capital', '上月末净资本']
];

const DEBT_LIMITS = [
	['收益凭证', 476.13, 'outstanding', null, null, 'net_capital_60', 10],
	['小公募', 400, 'since_approval', '2026-03-25', '2028-03-25', 'manual', 20],
	['科创债', 10, 'since_approval', '2025-08-14', '2027-08-14', 'manual', 30],
	['公募次级', 200, 'outstanding', '2026-01-06', '2028-01-06', 'manual', 40],
	['私募债', 100, 'since_approval', '2025-12-24', '2026-12-24', 'manual', 50],
	['短期融资券', 386, 'outstanding', '2026-02-13', null, 'manual', 60],
	['转融资', 150, 'outstanding', '2025-10-27', null, 'manual', 70]
];

export function seedDatabase(db) {
	const insertCategory = db.prepare(`
		INSERT INTO debt_type_catalog (code, name, parent_code, compact_name, display_name, sort_order)
		VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT(code) DO UPDATE SET name = excluded.name, parent_code = excluded.parent_code,
			compact_name = excluded.compact_name, display_name = excluded.display_name,
			sort_order = excluded.sort_order, updated_at = CURRENT_TIMESTAMP
	`);
	const insertParameter = db.prepare(`
		INSERT INTO finance_parameters (code, label) VALUES (?, ?)
		ON CONFLICT(code) DO UPDATE SET label = excluded.label
	`);
	const insertLimit = db.prepare(`
		INSERT INTO debt_limit_configs (
			debt_type, limit_yi, usage_basis, approved_date, expiry_date, calculation_mode, sort_order
		) VALUES (?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(debt_type) DO UPDATE SET
			usage_basis = excluded.usage_basis,
			approved_date = excluded.approved_date,
			expiry_date = excluded.expiry_date,
			calculation_mode = excluded.calculation_mode,
			sort_order = excluded.sort_order,
			updated_at = CURRENT_TIMESTAMP
	`);
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
		INSERT INTO projects (id, code, name, debt_type, amount, status, planned_start_date, planned_issue_date, planned_maturity_date, sop_template_id, owner_id, notes)
		VALUES (@id, @code, @name, @debtType, @amount, @status, @plannedStartDate, @plannedIssueDate, @plannedMaturityDate, @sopTemplateId, @ownerId, @notes)
		ON CONFLICT(id) DO UPDATE SET
			code = excluded.code, name = excluded.name, debt_type = excluded.debt_type, amount = excluded.amount, status = excluded.status,
			planned_start_date = excluded.planned_start_date, planned_issue_date = excluded.planned_issue_date,
			planned_maturity_date = excluded.planned_maturity_date, sop_template_id = excluded.sop_template_id,
			owner_id = excluded.owner_id, notes = excluded.notes, updated_at = CURRENT_TIMESTAMP
	`);
	const insertTask = db.prepare(`
		INSERT INTO project_tasks (id, project_id, sop_node_id, name, status, assignee_id, planned_start_date, due_date, completed_at, sort_order)
		VALUES (@id, @projectId, @sopNodeId, @name, @status, @assigneeId, @plannedStartDate, @dueDate, @completedAt, @sortOrder)
		ON CONFLICT(id) DO UPDATE SET
			project_id = excluded.project_id, sop_node_id = excluded.sop_node_id,
			name = excluded.name, status = excluded.status, assignee_id = excluded.assignee_id,
			planned_start_date = excluded.planned_start_date, due_date = excluded.due_date,
			completed_at = excluded.completed_at, sort_order = excluded.sort_order, updated_at = CURRENT_TIMESTAMP
	`);

	db.transaction(() => {
		for (const category of DEBT_TYPE_CATALOG.filter((item) => item[2] === null)) insertCategory.run(...category);
		for (const category of DEBT_TYPE_CATALOG.filter((item) => item[2] !== null)) insertCategory.run(...category);
		for (const parameter of FINANCE_PARAMETERS) insertParameter.run(...parameter);
		for (const limit of DEBT_LIMITS) insertLimit.run(...limit);
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
