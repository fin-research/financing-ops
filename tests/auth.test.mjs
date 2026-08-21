import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { isValidEmail, normalizeEmail } from '../src/lib/email.js';
import { shouldTouchSession } from '../src/lib/server/session-policy.js';

function schemaSql() {
	return fs.readFileSync(new URL('../migrations/0001_financing_postgres.sql', import.meta.url), 'utf8')
		.replace(/^\s*BEGIN\s*;?/i, '')
		.replace(/\s*COMMIT\s*;?\s*$/i, '');
}

test('session activity writes are limited to once per fifteen minutes', () => {
	const now = Date.parse('2026-08-20T00:30:00.000Z');
	assert.equal(shouldTouchSession('2026-08-20T00:20:01.000Z', now), false);
	assert.equal(shouldTouchSession('2026-08-20T00:15:00.000Z', now), true);
	assert.equal(shouldTouchSession(null, now), true);
});

test('login emails are normalized and validated', () => {
	assert.equal(normalizeEmail(' User@Example.COM '), 'user@example.com');
	assert.equal(isValidEmail('user@example.com'), true);
	assert.equal(isValidEmail('legacy-admin'), false);
});

test('PostgreSQL schema enforces email identity, debt inheritance and cashflow integrity', async (t) => {
	const db = new PGlite();
	t.after(() => db.close());
	await db.exec(schemaSql());
	await db.query("INSERT INTO financing.people (id, name, email, role) VALUES ('one', '甲', 'user@example.com', 'handler')");
	await assert.rejects(
		db.query("INSERT INTO financing.people (id, name, email, role) VALUES ('two', '乙', 'USER@example.com', 'reviewer')"),
		/duplicate key value|unique constraint/i
	);

	await db.exec(`
		INSERT INTO financing.sop_templates (id, name, debt_type) VALUES ('sop', '测试 SOP', '小公募');
		INSERT INTO financing.projects (id, code, name, debt_type, sop_template_id)
		VALUES ('project', 'P-1', '测试项目', '小公募', 'sop');
	`);
	await db.query(`
		INSERT INTO financing.bond (
			id, project_id, debt_type, subtype, name, amount, interest_payable, annual_rate,
			issue_date, maturity_date, activated_at
		) VALUES (101, 'project', '债券', '小公募', '26东财01', 1000, 25, 0.02, '2026-01-01', '2027-01-01', '2026-01-01')
	`);
	const debt = (await db.query(`
		SELECT id, total_amount, term_days, status, tableoid::regclass::text AS physical_table
		FROM financing.debt WHERE id = 101
	`)).rows[0];
	assert.equal(Number(debt.total_amount), 1025);
	assert.equal(debt.term_days, 365);
	assert.equal(debt.status, 'active');
	assert.equal(debt.physical_table, 'financing.bond');

	await assert.rejects(
		db.query(`
			INSERT INTO financing.income_certificate (id, debt_type, subtype, name, amount)
			VALUES (101, '收益凭证', '固定收益凭证', '冲突凭证', 100)
		`),
		/duplicate debt id/i
	);
	await db.query(`
		INSERT INTO financing.cashflow (debt_id, cashflow_type, due_date, amount)
		VALUES (101, 'interest', '2026-12-31', 25)
	`);
	const cashflow = (await db.query('SELECT debt_id, sequence FROM financing.cashflow')).rows[0];
	assert.equal(Number(cashflow.debt_id), 101);
	assert.equal(cashflow.sequence, 1);
	await assert.rejects(
		db.query(`
			INSERT INTO financing.cashflow (debt_id, cashflow_type, due_date, amount)
			VALUES (999, 'principal', '2026-12-31', 100)
		`),
		/debt does not exist/i
	);
	await db.query("DELETE FROM financing.projects WHERE id = 'project'");
	assert.equal((await db.query('SELECT project_id FROM financing.debt WHERE id = 101')).rows[0].project_id, null);
	await db.query('DELETE FROM financing.bond WHERE id = 101');
	assert.equal((await db.query('SELECT COUNT(*)::integer AS count FROM financing.cashflow')).rows[0].count, 0);
});
