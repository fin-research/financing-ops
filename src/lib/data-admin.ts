import { DEBT_TYPES } from './debt-types.js';

export type DataRow = Record<string, unknown>;
export type FieldType = 'text' | 'textarea' | 'number' | 'date' | 'datetime' | 'select' | 'boolean' | 'json';

export type FieldConfig = {
	key: string;
	label: string;
	type?: FieldType;
	required?: boolean;
	readOnly?: boolean;
	table?: boolean;
	form?: boolean;
	step?: string;
	min?: number;
	max?: number;
	options?: Array<{ value: string; label: string }>;
	displayFactor?: number;
	omitWhenEmptyOnCreate?: boolean;
	emptyValue?: unknown;
};

export type EntityConfig = {
	key: string;
	label: string;
	tableName: string;
	primaryKeys: string[];
	fields: FieldConfig[];
	searchFields: string[];
	defaultSort: { key: string; direction: 'asc' | 'desc' };
	canCreate?: boolean;
	canDelete?: boolean;
	readOnly?: boolean;
	insertTable?: (row: DataRow) => string;
};

const option = (value: string, label = value) => ({ value, label });
const debtTypeOptions = [...new Set(DEBT_TYPES.map((item) => item.type))].map((value) => option(value));
const debtSubtypeOptions = [option('', '无'), ...DEBT_TYPES.filter((item) => item.subtype).map((item) => option(item.subtype as string))];

const commonTimestamps: FieldConfig[] = [
	{ key: 'created_at', label: '创建时间', type: 'datetime', readOnly: true, form: false },
	{ key: 'updated_at', label: '更新时间', type: 'datetime', readOnly: true }
];

function debtInsertTable(row: DataRow) {
	switch (row.debt_type) {
		case '债券': return 'bond';
		case '收益凭证': return 'income_certificate';
		case '收益权转让': return 'income_right';
		case '转融资': return 'refinancing';
		case '互换便利': return 'swap_facility';
		default: return 'debt';
	}
}

export const DATA_ENTITIES: EntityConfig[] = [
	{
		key: 'debt', label: '负债', tableName: 'debt', primaryKeys: ['id'], searchFields: ['name', 'counterparty', 'debt_type', 'subtype'],
		defaultSort: { key: 'id', direction: 'desc' }, canCreate: true, canDelete: true, insertTable: debtInsertTable,
		fields: [
			{ key: 'id', label: 'ID', type: 'number', readOnly: true },
			{ key: 'project_id', label: '关联项目 ID' },
			{ key: 'debt_type', label: '负债大类', type: 'select', options: debtTypeOptions, required: true },
			{ key: 'subtype', label: '负债小类', type: 'select', options: debtSubtypeOptions },
			{ key: 'name', label: '负债简称', required: true },
			{ key: 'counterparty', label: '交易对手' },
			{ key: 'amount', label: '本金（元）', type: 'number', required: true, min: 0, step: '0.01' },
			{ key: 'interest_payable', label: '应付利息（元）', type: 'number', min: 0, step: '0.01', omitWhenEmptyOnCreate: true },
			{ key: 'total_amount', label: '本息合计（元）', type: 'number', readOnly: true, form: false },
			{ key: 'annual_rate', label: '年利率（%）', type: 'number', min: 0, max: 100, step: '0.0001', displayFactor: 100 },
			{ key: 'issue_date', label: '起息日', type: 'date' },
			{ key: 'maturity_date', label: '到期日', type: 'date' },
			{ key: 'activated_at', label: '生效日', type: 'date', table: false },
			{ key: 'settled_at', label: '结清日', type: 'date', table: false },
			{ key: 'closed_at', label: '关闭日', type: 'date', table: false },
			{ key: 'term_days', label: '期限（天）', type: 'number', readOnly: true, form: false },
			{ key: 'status', label: '状态', readOnly: true, form: false },
			...commonTimestamps
		]
	},
	{
		key: 'cashflow', label: '现金流', tableName: 'cashflow', primaryKeys: ['debt_id', 'sequence'], searchFields: ['note', 'cashflow_type'],
		defaultSort: { key: 'due_date', direction: 'desc' }, canCreate: true, canDelete: true,
		fields: [
			{ key: 'debt_id', label: '负债 ID', type: 'number', required: true },
			{ key: 'sequence', label: '序号', type: 'number', min: 1, step: '1', omitWhenEmptyOnCreate: true },
			{ key: 'cashflow_type', label: '现金流类型', type: 'select', required: true, options: [option('interest', '利息'), option('principal', '本金'), option('fee', '费用'), option('supplemental', '补充流')] },
			{ key: 'due_date', label: '应付日期', type: 'date', required: true },
			{ key: 'amount', label: '应付金额（元）', type: 'number', min: 0, step: '0.01' },
			{ key: 'paid_amount', label: '实付金额（元）', type: 'number', min: 0, step: '0.01' },
			{ key: 'paid_at', label: '实付日期', type: 'date' },
			{ key: 'accrual_start_date', label: '计息开始日', type: 'date', table: false },
			{ key: 'accrual_end_date', label: '计息结束日', type: 'date', table: false },
			{ key: 'note', label: '备注', type: 'textarea' },
			...commonTimestamps
		]
	},
	{
		key: 'balance', label: '历史余额', tableName: 'balance_snapshot', primaryKeys: ['as_of_date', 'debt_type', 'subtype'], searchFields: ['debt_type', 'subtype'],
		defaultSort: { key: 'as_of_date', direction: 'desc' }, canCreate: true, canDelete: true,
		fields: [
			{ key: 'as_of_date', label: '数据日期', type: 'date', required: true },
			{ key: 'debt_type', label: '负债大类', type: 'select', options: debtTypeOptions, required: true },
			{ key: 'subtype', label: '负债小类', type: 'select', options: debtSubtypeOptions, emptyValue: '' },
			{ key: 'amount', label: '余额（元）', type: 'number', required: true, min: 0, step: '0.01' },
			...commonTimestamps
		]
	},
	{
		key: 'parameter', label: '监管参数', tableName: 'finance_parameters', primaryKeys: ['code'], searchFields: ['code', 'label', 'notes'],
		defaultSort: { key: 'code', direction: 'asc' }, canCreate: false, canDelete: false,
		fields: [
			{ key: 'code', label: '参数编码', readOnly: true },
			{ key: 'label', label: '参数名称', required: true },
			{ key: 'value_yi', label: '金额（亿元）', type: 'number', min: 0, step: '0.0001' },
			{ key: 'period_end', label: '口径日期', type: 'date' },
			{ key: 'notes', label: '说明', type: 'textarea' },
			...commonTimestamps
		]
	},
	{
		key: 'limit', label: '负债额度', tableName: 'debt_limit_configs', primaryKeys: ['debt_type'], searchFields: ['debt_type', 'usage_basis', 'calculation_mode'],
		defaultSort: { key: 'sort_order', direction: 'asc' }, canCreate: true, canDelete: true,
		fields: [
			{ key: 'debt_type', label: '负债品种', required: true },
			{ key: 'limit_yi', label: '额度（亿元）', type: 'number', required: true, min: 0, step: '0.0001' },
			{ key: 'usage_basis', label: '使用口径', type: 'select', required: true, options: [option('outstanding', '存量余额'), option('since_approval', '批复后累计')] },
			{ key: 'approved_date', label: '批复日期', type: 'date' },
			{ key: 'expiry_date', label: '到期日期', type: 'date' },
			{ key: 'calculation_mode', label: '计算方式', type: 'select', required: true, options: [option('manual', '手工额度'), option('net_capital_60', '净资本 60%')] },
			{ key: 'sort_order', label: '排序', type: 'number', step: '1', omitWhenEmptyOnCreate: true },
			...commonTimestamps
		]
	},
	{
		key: 'audit', label: '审计记录', tableName: 'audit_logs', primaryKeys: ['id'], searchFields: ['actor_email', 'action', 'entity_type', 'entity_id', 'summary'],
		defaultSort: { key: 'created_at', direction: 'desc' }, readOnly: true,
		fields: [
			{ key: 'created_at', label: '操作时间', type: 'datetime' },
			{ key: 'actor_email', label: '操作账号' },
			{ key: 'action', label: '动作' },
			{ key: 'entity_type', label: '数据类型' },
			{ key: 'entity_id', label: '数据标识' },
			{ key: 'summary', label: '摘要' },
			{ key: 'before_json', label: '变更前', type: 'json', table: false, form: false },
			{ key: 'after_json', label: '变更后', type: 'json', table: false, form: false }
		]
	}
];

export function formatDataValue(field: FieldConfig, value: unknown) {
	if (value === null || value === undefined || value === '') return '—';
	if (field.type === 'boolean') return value ? '是' : '否';
	if (field.type === 'number') {
		const numeric = Number(value) * (field.displayFactor ?? 1);
		return Number.isFinite(numeric) ? numeric.toLocaleString('zh-CN', { maximumFractionDigits: 6 }) : String(value);
	}
	if (field.type === 'datetime') return new Date(String(value)).toLocaleString('zh-CN', { hour12: false });
	if (field.type === 'json') return JSON.stringify(value);
	return String(value);
}

export function valueForEditor(field: FieldConfig, value: unknown) {
	if (value === null || value === undefined) return '';
	if (field.type === 'number' && field.displayFactor) return String(Number(value) * field.displayFactor);
	if (field.type === 'boolean') return Boolean(value);
	return String(value);
}

export function valueForDatabase(field: FieldConfig, value: unknown) {
	if (field.type === 'boolean') return Boolean(value);
	if (value === '' || value === null || value === undefined) return field.emptyValue ?? null;
	if (field.type === 'number') {
		const numeric = Number(value);
		if (!Number.isFinite(numeric)) throw new Error(`${field.label}必须是有效数值`);
		return numeric / (field.displayFactor ?? 1);
	}
	return String(value).trim();
}
