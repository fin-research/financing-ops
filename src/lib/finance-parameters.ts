import { DATA_ENTITIES, valueForDatabase, type DataRow, type FieldConfig } from './data-admin';

export const FINANCE_PARAMETER_CONFIG = {
	...DATA_ENTITIES.find((entity) => entity.key === 'parameter')!, canCreate: true
};

export const FINANCE_PARAMETERS = [
	{ code: 'prior_month_net_capital', label: '上月末净资本', unit: '亿元' },
	{ code: 'securities_prior_year_net_assets', label: '证券上年末净资产', unit: '亿元' },
	{ code: 'group_prior_year_net_assets', label: '集团上年末净资产', unit: '亿元' },
	{ code: 'total_assets', label: '总资产', unit: '亿元' },
	{ code: 'total_liabilities', label: '总负债', unit: '亿元' },
	{ code: 'agency_brokerage_funds', label: '代理买卖证券款', unit: '亿元' },
	{ code: 'asset_liability_ratio', label: '资产负债率', unit: '%' },
	{ code: 'adjusted_asset_liability_ratio', label: '资产负债率（扣代理买卖）', unit: '%' }
];

export function financeParameterDefinition(code: string, label?: unknown) {
	return FINANCE_PARAMETERS.find((parameter) => parameter.code === code)
		?? { code, label: String(label || code), unit: '亿元' };
}

export function financeParameterValue(code: string, value: unknown) {
	if (value == null || value === '') return '';
	const isRatio = financeParameterDefinition(code).unit === '%';
	return Number((Number(value) * (isRatio ? 100 : 1)).toFixed(isRatio ? 2 : 4)).toString();
}

export function financeParameterPayload(code: string, value: string, periodEnd: string, notes: string, label?: unknown): DataRow {
	const definition = financeParameterDefinition(code, label);
	if (!value.trim() || !Number.isFinite(Number(value)) || Number(value) < 0) {
		throw new Error('请填写有效的非负数值');
	}
	if (!/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)
		|| Number.isNaN(Date.parse(periodEnd))
		|| new Date(periodEnd).toISOString().slice(0, 10) !== periodEnd) {
		throw new Error('请填写有效的口径日期');
	}
	const field: FieldConfig = {
		key: 'value_yi', label: definition.label, type: 'number',
		displayFactor: definition.unit === '%' ? 100 : 1
	};
	return {
		code, label: definition.label,
		value_yi: Number(Number(valueForDatabase(field, value)).toFixed(4)),
		period_end: periodEnd, notes: notes.trim() || null
	};
}
