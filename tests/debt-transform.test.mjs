import assert from 'node:assert/strict';
import test from 'node:test';
import {
	normalizeIncomeCertificateName,
	previousWorkingDay,
	transformWorkbook
} from '../scripts/lib/debt-transform.mjs';

test('income-certificate names use product serials without issuer or tenor decorations', () => {
	assert.equal(normalizeIncomeCertificateName('东方财富证券吉祥231号收益凭证'), '吉祥231号收益凭证');
	assert.equal(normalizeIncomeCertificateName('东方财富证券财气东来两年期1918号收益凭证'), '财气东来1918号收益凭证');
	assert.equal(normalizeIncomeCertificateName('西藏东方财富证券吉祥32号收益凭证（两年）'), '吉祥32号收益凭证');
});

test('previous working day skips weekends', () => {
	assert.equal(previousWorkingDay('2026-04-14'), '2026-04-13');
	assert.equal(previousWorkingDay('2026-09-07'), '2026-09-04');
});

test('income-certificate transform keeps subscription and redemption dates and fills missing maturity', () => {
	const values = [];
	values[1] = '吉祥';
	values[2] = '东方财富证券吉祥239号收益凭证';
	values[3] = '2025-10-14';
	values[4] = '2026-04-14';
	const parsed = {
		definitions: [
			['收益凭证', 1, '系列'],
			['收益凭证', 2, '产品名称'],
			['收益凭证', 3, '认购日'],
			['收益凭证', 4, '兑付日']
		],
		debts: [[
			1, 'certificate-239', '收益凭证', '收益凭证', '固定收益凭证',
			'东方财富证券吉祥239号收益凭证', 'SSDG39', null, '银行',
			70000000, 70000000, 'CNY', 0.0178, '2025-10-15', null, 'matured'
		]],
		recordGroups: [['certificate-239', [[1, values]]]],
		cashflows: [], balances: [], snapshot: { asOfDate: '2026-08-31', totalYi: 0 }
	};
	const [debt] = transformWorkbook(parsed).debts;
	assert.equal(debt.name, '吉祥239号收益凭证');
	assert.equal(debt.legacyName, '吉祥');
	assert.equal(debt.maturityDate, '2026-04-13');
	assert.equal(debt.settledAt, '2026-04-13');
	assert.equal(debt.extension.subscriptionDate, '2025-10-14');
	assert.equal(debt.extension.redemptionDate, '2026-04-14');
});
