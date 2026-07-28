import { randomUUID } from 'node:crypto';
import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { auditRequestMeta, recordAudit } from '$lib/server/audit.js';
import { getDatabase } from '$lib/server/db.js';

const MAX_NODE_NAME = 120;
const MIN_OFFSET = -3650;
const MAX_OFFSET = 3650;

function templateExists(id: string) {
	return getDatabase().prepare('SELECT 1 FROM sop_templates WHERE id = ?').get(id);
}

function parseNode(data: FormData) {
	const name = String(data.get('name') ?? '').trim();
	const description = String(data.get('description') ?? '').trim();
	const ownerRole = String(data.get('ownerRole') ?? '').trim();
	const offsetDays = Number(data.get('offsetDays'));
	if (!name || name.length > MAX_NODE_NAME) return { error: '节点名称应为 1–120 个字符' } as const;
	if (!Number.isInteger(offsetDays) || offsetDays < MIN_OFFSET || offsetDays > MAX_OFFSET) {
		return { error: '相对日期必须是 -3650 至 3650 之间的整数' } as const;
	}
	if (ownerRole.length > 80) return { error: '默认角色不能超过 80 个字符' } as const;
	return { name, description, ownerRole, offsetDays } as const;
}

function normaliseOrder(templateId: string) {
	const db = getDatabase();
	const rows = db.prepare(`
		SELECT id FROM sop_nodes WHERE template_id = ? ORDER BY sort_order, created_at, id
	`).all(templateId) as Array<{ id: string }>;
	const setOrder = db.prepare('UPDATE sop_nodes SET sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
	rows.forEach((row, index) => setOrder.run(index + 1, row.id));
}

export const load: PageServerLoad = ({ params }) => {
	const db = getDatabase();
	const template = db.prepare(`
		SELECT id, name, debt_type AS debtType, description, is_active AS isActive,
			created_at AS createdAt, updated_at AS updatedAt
		FROM sop_templates WHERE id = ?
	`).get(params.id) as any;
	if (!template) throw error(404, 'SOP 模板不存在');
	const nodes = db.prepare(`
		SELECT id, name, description, sort_order AS sortOrder,
			default_offset_days AS offsetDays, default_owner_role AS ownerRole
		FROM sop_nodes WHERE template_id = ? ORDER BY sort_order, created_at
	`).all(params.id);
	const roles = db.prepare(`
		SELECT DISTINCT role FROM people
		WHERE active = 1 AND role IS NOT NULL AND trim(role) != ''
		ORDER BY role
	`).all().map((row: any) => row.role);
	return {
		template: { ...template, isActive: Boolean(template.isActive) },
		nodes,
		roles
	};
};

export const actions: Actions = {
	updateTemplate: async (event) => {
		const { request, params } = event;
		if (!templateExists(params.id)) return fail(404, { message: 'SOP 模板不存在' });
		const data = await request.formData();
		const name = String(data.get('name') ?? '').trim();
		const debtType = String(data.get('debtType') ?? '').trim();
		const description = String(data.get('description') ?? '').trim();
		if (!name || name.length > 120 || !debtType || debtType.length > 80) {
			return fail(400, { message: '请填写有效的 SOP 名称和负债品种' });
		}
		try {
			const db = getDatabase();
			const selectState = db.prepare('SELECT name, debt_type AS debtType, description FROM sop_templates WHERE id = ?');
			const before = selectState.get(params.id);
			db.transaction(() => {
				db.prepare(`
					UPDATE sop_templates
					SET name = ?, debt_type = ?, description = ?, updated_at = CURRENT_TIMESTAMP
					WHERE id = ?
				`).run(name, debtType, description || null, params.id);
				recordAudit({
					db,
					...auditRequestMeta(event),
					action: 'sop.update',
					entityType: 'sop',
					entityId: params.id,
					summary: `更新 SOP 模板：${name}`,
					before,
					after: selectState.get(params.id)
				});
			})();
			return { success: true, message: 'SOP 基本信息已保存' };
		} catch (cause) {
			return fail(409, { message: cause instanceof Error ? cause.message : '同品种下已存在同名 SOP' });
		}
	},
	toggleTemplate: async (event) => {
		const { params } = event;
		if (!templateExists(params.id)) return fail(404, { message: 'SOP 模板不存在' });
		const db = getDatabase();
		const before = db.prepare('SELECT name, is_active AS isActive FROM sop_templates WHERE id = ?').get(params.id) as any;
		db.transaction(() => {
			db.prepare(`
				UPDATE sop_templates
				SET is_active = CASE is_active WHEN 1 THEN 0 ELSE 1 END, updated_at = CURRENT_TIMESTAMP
				WHERE id = ?
			`).run(params.id);
			const after = db.prepare('SELECT name, is_active AS isActive FROM sop_templates WHERE id = ?').get(params.id);
			recordAudit({
				db,
				...auditRequestMeta(event),
				action: 'sop.toggle',
				entityType: 'sop',
				entityId: params.id,
				summary: `${after.isActive ? '启用' : '停用'} SOP 模板：${before.name}`,
				before,
				after
			});
		})();
		return { success: true, message: 'SOP 启停状态已更新' };
	},
	addNode: async (event) => {
		const { request, params } = event;
		if (!templateExists(params.id)) return fail(404, { message: 'SOP 模板不存在' });
		const parsed = parseNode(await request.formData());
		if ('error' in parsed) return fail(400, { message: parsed.error });
		const db = getDatabase();
		const nextOrder = (db.prepare(`
			SELECT COALESCE(MAX(sort_order), 0) + 1 AS nextOrder
			FROM sop_nodes WHERE template_id = ?
		`).get(params.id) as { nextOrder: number }).nextOrder;
		const nodeId = randomUUID();
		const after = {
			id: nodeId,
			name: parsed.name,
			description: parsed.description || null,
			sortOrder: nextOrder,
			offsetDays: parsed.offsetDays,
			ownerRole: parsed.ownerRole || null
		};
		db.transaction(() => {
			db.prepare(`
				INSERT INTO sop_nodes (
					id, template_id, name, description, sort_order,
					default_offset_days, default_owner_role
				) VALUES (?, ?, ?, ?, ?, ?, ?)
			`).run(nodeId, params.id, parsed.name, parsed.description || null, nextOrder, parsed.offsetDays, parsed.ownerRole || null);
			recordAudit({
				db,
				...auditRequestMeta(event),
				action: 'sop.node.create',
				entityType: 'sop',
				entityId: params.id,
				summary: `添加 SOP 节点：${parsed.name}`,
				after
			});
		})();
		return { success: true, message: 'SOP 节点已添加' };
	},
	updateNode: async (event) => {
		const { request, params } = event;
		if (!templateExists(params.id)) return fail(404, { message: 'SOP 模板不存在' });
		const data = await request.formData();
		const nodeId = String(data.get('nodeId') ?? '');
		const parsed = parseNode(data);
		if ('error' in parsed) return fail(400, { message: parsed.error });
		const db = getDatabase();
		if (!db.prepare('SELECT 1 FROM sop_nodes WHERE id = ? AND template_id = ?').get(nodeId, params.id)) {
			return fail(404, { message: 'SOP 节点不存在' });
		}
		const selectState = db.prepare(`
			SELECT id, name, description, sort_order AS sortOrder,
				default_offset_days AS offsetDays, default_owner_role AS ownerRole
			FROM sop_nodes WHERE id = ? AND template_id = ?
		`);
		const before = selectState.get(nodeId, params.id);
		db.transaction(() => {
			db.prepare(`
				UPDATE sop_nodes
				SET name = ?, description = ?, default_offset_days = ?,
					default_owner_role = ?, updated_at = CURRENT_TIMESTAMP
				WHERE id = ? AND template_id = ?
			`).run(parsed.name, parsed.description || null, parsed.offsetDays, parsed.ownerRole || null, nodeId, params.id);
			recordAudit({
				db,
				...auditRequestMeta(event),
				action: 'sop.node.update',
				entityType: 'sop',
				entityId: params.id,
				summary: `更新 SOP 节点：${parsed.name}`,
				before,
				after: selectState.get(nodeId, params.id)
			});
		})();
		return { success: true, message: 'SOP 节点已更新' };
	},
	moveNode: async (event) => {
		const { request, params } = event;
		if (!templateExists(params.id)) return fail(404, { message: 'SOP 模板不存在' });
		const data = await request.formData();
		const nodeId = String(data.get('nodeId') ?? '');
		const direction = String(data.get('direction') ?? '');
		if (!['up', 'down'].includes(direction)) return fail(400, { message: '排序方向无效' });
		const db = getDatabase();
		const node = db.prepare(`
			SELECT id, sort_order AS sortOrder FROM sop_nodes
			WHERE id = ? AND template_id = ?
		`).get(nodeId, params.id) as { id: string; sortOrder: number } | undefined;
		if (!node) return fail(404, { message: 'SOP 节点不存在' });
		const neighbour = db.prepare(`
			SELECT id, sort_order AS sortOrder FROM sop_nodes
			WHERE template_id = ? AND sort_order ${direction === 'up' ? '<' : '>'} ?
			ORDER BY sort_order ${direction === 'up' ? 'DESC' : 'ASC'} LIMIT 1
		`).get(params.id, node.sortOrder) as { id: string; sortOrder: number } | undefined;
		if (!neighbour) return { success: true, message: direction === 'up' ? '已经是首个节点' : '已经是最后一个节点' };
		db.transaction(() => {
			db.prepare('UPDATE sop_nodes SET sort_order = -1 WHERE id = ?').run(node.id);
			db.prepare('UPDATE sop_nodes SET sort_order = ? WHERE id = ?').run(node.sortOrder, neighbour.id);
			db.prepare('UPDATE sop_nodes SET sort_order = ? WHERE id = ?').run(neighbour.sortOrder, node.id);
			recordAudit({
				db,
				...auditRequestMeta(event),
				action: 'sop.node.reorder',
				entityType: 'sop',
				entityId: params.id,
				summary: `${direction === 'up' ? '上移' : '下移'} SOP 节点`,
				before: { nodeId, sortOrder: node.sortOrder },
				after: { nodeId, sortOrder: neighbour.sortOrder }
			});
		})();
		return { success: true, message: '节点顺序已调整' };
	},
	deleteNode: async (event) => {
		const { request, params } = event;
		if (!templateExists(params.id)) return fail(404, { message: 'SOP 模板不存在' });
		const nodeId = String((await request.formData()).get('nodeId') ?? '');
		const db = getDatabase();
		const before = db.prepare(`
			SELECT id, name, description, sort_order AS sortOrder,
				default_offset_days AS offsetDays, default_owner_role AS ownerRole
			FROM sop_nodes WHERE id = ? AND template_id = ?
		`).get(nodeId, params.id) as any;
		if (!before) return fail(404, { message: 'SOP 节点不存在' });
		db.transaction(() => {
			db.prepare('DELETE FROM sop_nodes WHERE id = ? AND template_id = ?').run(nodeId, params.id);
			normaliseOrder(params.id);
			recordAudit({
				db,
				...auditRequestMeta(event),
				action: 'sop.node.delete',
				entityType: 'sop',
				entityId: params.id,
				summary: `删除 SOP 节点：${before.name}`,
				before
			});
		})();
		return { success: true, message: 'SOP 节点已删除' };
	}
};
