import test from 'node:test';
import assert from 'node:assert/strict';
import { tsImport } from 'tsx/esm/api';

const { FINANCE_PARAMETER_CONFIG, financeParameterValue, financeParameterPayload } = await tsImport('../src/lib/finance-parameters.ts', import.meta.url);

test('financial amounts retain the existing hundred-million-yuan unit and four decimal precision', () => {
	const payload = financeParameterPayload('total_assets', '1234.5678', '2026-08-31', ' 月末财务报表 ');
	assert.equal(FINANCE_PARAMETER_CONFIG.tableName, 'finance_parameters');
	assert.equal(payload.value_yi, 1234.5678);
	assert.equal(payload.period_end, '2026-08-31');
	assert.equal(payload.notes, '月末财务报表');
	assert.equal(financeParameterValue('total_assets', payload.value_yi), '1234.5678');
	assert.equal(financeParameterValue('total_assets', 0), '0');
	assert.equal(financeParameterValue('total_assets', null), '');
});

test('both asset liability ratios round trip percentages without changing their stored decimal caliber', () => {
	for (const code of ['asset_liability_ratio', 'adjusted_asset_liability_ratio']) {
		assert.equal(financeParameterValue(code, '0.5678'), '56.78');
		assert.equal(financeParameterPayload(code, '56.78', '2026-08-31', '').value_yi, 0.5678);
		assert.equal(financeParameterPayload(code, '0', '2026-08-31', '').value_yi, 0);
		assert.equal(financeParameterPayload(code, '100', '2026-08-31', '').value_yi, 1);
	}
});

test('financial input rejects missing values and invalid dates while accepting real leap days', () => {
	for (const value of ['', ' ', '-1', 'NaN', 'Infinity']) {
		assert.throws(() => financeParameterPayload('total_assets', value, '2026-08-31', ''), /有效的非负数值/);
	}
	for (const date of ['', '2026-02-29', '2026-04-31', '2026-13-01']) {
		assert.throws(() => financeParameterPayload('total_assets', '1', date, ''), /有效的口径日期/);
	}
	assert.equal(financeParameterPayload('total_assets', '1', '2024-02-29', '').period_end, '2024-02-29');
});
