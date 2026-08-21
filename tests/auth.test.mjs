import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { isValidEmail, normalizeEmail } from '../src/lib/email.js';
import { createNeonAuthClient, NEON_SESSION_COOKIE, sessionMaxAgeFromSetCookie, sessionTokenFromSetCookie } from '../src/lib/server/neon-auth-client.js';

function migrationSql(name) {
	return fs.readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8')
		.replace(/^\s*BEGIN\s*;?/i, '').replace(/\s*COMMIT\s*;?\s*$/i, '');
}

async function installSchema(db) {
	await db.exec(`
		CREATE SCHEMA neon_auth;
		CREATE TABLE neon_auth."user" (
			id uuid PRIMARY KEY, name text NOT NULL, email text NOT NULL UNIQUE,
			"emailVerified" boolean NOT NULL, "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
			"updatedAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP, role text, banned boolean
		);
		CREATE TABLE neon_auth.session (
			id uuid PRIMARY KEY, "userId" uuid NOT NULL REFERENCES neon_auth."user"(id),
			"createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
		);
	`);
	for (const name of ['0001_financing_postgres.sql', '0002_neon_auth_prepare.sql', '0003_remove_custom_auth.sql']) await db.exec(migrationSql(name));
}

test('login emails are normalized and validated', () => {
	assert.equal(normalizeEmail(' User@Example.COM '), 'user@example.com');
	assert.equal(isValidEmail('user@example.com'), true);
	assert.equal(isValidEmail('legacy-admin'), false);
});

test('Neon Auth session cookie is proxied without exposing the upstream cookie', async () => {
	const cookie = `${NEON_SESSION_COOKIE}=opaque-token; Max-Age=3600; Path=/; HttpOnly; Secure`;
	assert.equal(sessionTokenFromSetCookie(cookie), 'opaque-token');
	assert.equal(sessionMaxAgeFromSetCookie(cookie), 3600);
	const requests = [];
	const client = createNeonAuthClient({
		baseUrl: 'https://example.neonauth.us-west-2.aws.neon.tech/neondb/auth',
		origin: 'https://eastmoney.hasbai.xyz', token: 'opaque-token',
		fetchImpl: async (url, options) => {
			requests.push({ url: String(url), options });
			return new Response(JSON.stringify({ user: { id: 'auth-id', email: 'admin@example.com' } }), { status: 200, headers: { 'content-type': 'application/json' } });
		}
	});
	const session = await client.getSession();
	assert.equal(session.data.user.id, 'auth-id');
	assert.equal(requests[0].options.headers.get('Cookie'), `${NEON_SESSION_COOKIE}=opaque-token`);
	assert.equal(requests[0].options.headers.get('Origin'), 'https://eastmoney.hasbai.xyz');
});

test('PostgreSQL schema removes custom auth and preserves debt integrity', async (t) => {
	const db = new PGlite();
	t.after(() => db.close());
	await installSchema(db);
	const authTables = (await db.query("SELECT to_regclass('financing.auth_users') AS users, to_regclass('financing.auth_sessions') AS sessions")).rows[0];
	assert.equal(authTables.users, null);
	assert.equal(authTables.sessions, null);
	const columns = (await db.query("SELECT column_name FROM information_schema.columns WHERE table_schema = 'financing' AND table_name = 'people'")).rows.map((row) => row.column_name);
	assert.ok(columns.includes('neon_auth_user_id'));
	assert.ok(columns.includes('avatar_data_url'));

	await db.query("INSERT INTO financing.people (id, name, email, role) VALUES ('one', '甲', 'user@example.com', 'handler')");
	await assert.rejects(db.query("INSERT INTO financing.people (id, name, email, role) VALUES ('two', '乙', 'USER@example.com', 'reviewer')"), /duplicate key value|unique constraint/i);
	await db.exec(`
		INSERT INTO financing.sop_templates (id, name, debt_type) VALUES ('sop', '测试 SOP', '小公募');
		INSERT INTO financing.projects (id, code, name, debt_type, sop_template_id) VALUES ('project', 'P-1', '测试项目', '小公募', 'sop');
	`);
	await db.query(`INSERT INTO financing.bond (id, project_id, debt_type, subtype, name, amount, interest_payable, annual_rate, issue_date, maturity_date, activated_at)
		VALUES (101, 'project', '债券', '小公募', '26东财01', 1000, 25, 0.02, '2026-01-01', '2027-01-01', '2026-01-01')`);
	const debt = (await db.query('SELECT total_amount, term_days, status, tableoid::regclass::text AS physical_table FROM financing.debt WHERE id = 101')).rows[0];
	assert.equal(Number(debt.total_amount), 1025);
	assert.equal(debt.term_days, 365);
	assert.equal(debt.status, 'active');
	assert.equal(debt.physical_table, 'financing.bond');
	await assert.rejects(db.query("INSERT INTO financing.income_certificate (id, debt_type, subtype, name, amount) VALUES (101, '收益凭证', '固定收益凭证', '冲突凭证', 100)"), /duplicate debt id/i);
	await db.query("INSERT INTO financing.cashflow (debt_id, cashflow_type, due_date, amount) VALUES (101, 'interest', '2026-12-31', 25)");
	assert.equal((await db.query('SELECT sequence FROM financing.cashflow')).rows[0].sequence, 1);
	await assert.rejects(db.query("INSERT INTO financing.cashflow (debt_id, cashflow_type, due_date, amount) VALUES (999, 'principal', '2026-12-31', 100)"), /debt does not exist/i);
	await db.query("DELETE FROM financing.projects WHERE id = 'project'");
	assert.equal((await db.query('SELECT project_id FROM financing.debt WHERE id = 101')).rows[0].project_id, null);
	await db.query('DELETE FROM financing.bond WHERE id = 101');
	assert.equal((await db.query('SELECT COUNT(*)::integer AS count FROM financing.cashflow')).rows[0].count, 0);
});
