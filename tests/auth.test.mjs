import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { isValidEmail, normalizeEmail } from '../src/lib/email.js';
import { createNeonAuthClient, jwtFromResponseHeaders, NEON_SESSION_COOKIE, sessionMaxAgeFromSetCookie, sessionTokenFromSetCookie } from '../src/lib/server/neon-auth-client.js';
import { dataApiUrlFromAuthUrl } from '../src/lib/neon-urls.js';

function migrationSql(name) {
	return fs.readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8')
		.replace(/^\s*BEGIN\s*;?/i, '').replace(/\s*COMMIT\s*;?\s*$/i, '');
}

async function installSchema(db) {
	await db.exec(`
		CREATE ROLE authenticated;
		CREATE ROLE anonymous;
		CREATE SCHEMA auth;
		CREATE FUNCTION auth.user_id() RETURNS text LANGUAGE sql STABLE AS $$
			SELECT current_setting('request.jwt.claim.sub', true)
		$$;
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
	for (const name of ['0001_financing_postgres.sql', '0002_neon_auth_prepare.sql', '0003_remove_custom_auth.sql', '0004_data_api_rls.sql', '0005_hide_derived_data_api_tables.sql', '0006_enforce_single_debt_project.sql']) await db.exec(migrationSql(name));
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
			return new Response(JSON.stringify({ user: { id: 'auth-id', email: 'admin@example.com' } }), { status: 200, headers: { 'content-type': 'application/json', 'set-auth-jwt': 'short-lived-jwt' } });
		}
	});
	const session = await client.getSession();
	assert.equal(session.data.user.id, 'auth-id');
	assert.equal(session.jwt, 'short-lived-jwt');
	assert.equal(requests[0].options.headers.get('Cookie'), `${NEON_SESSION_COOKIE}=opaque-token`);
	assert.equal(requests[0].options.headers.get('Origin'), 'https://eastmoney.hasbai.xyz');
});

test('Data API JWT is read from the dedicated Neon Auth response header', () => {
	assert.equal(jwtFromResponseHeaders(new Headers({ 'Set-Auth-Jwt': ' jwt-value ' })), 'jwt-value');
	assert.equal(jwtFromResponseHeaders(new Headers()), null);
});

test('Data API URL is derived from the branch-scoped Neon Auth URL', () => {
	assert.equal(
		dataApiUrlFromAuthUrl('https://ep-example.neonauth.us-west-2.aws.neon.tech/neondb/auth'),
		'https://ep-example.apirest.us-west-2.aws.neon.tech/neondb/rest/v1'
	);
	assert.equal(dataApiUrlFromAuthUrl('https://example.com/auth'), null);
});

test('Data API RLS lets every active financing role edit and writes audit records', async (t) => {
	const db = new PGlite();
	t.after(() => db.close());
	await installSchema(db);
	const roles = ['admin', 'handler', 'reviewer'];
	const debtFixtures = [
		{ table: 'bond', debtType: '债券', subtype: '小公募' },
		{ table: 'income_certificate', debtType: '收益凭证', subtype: '固定收益凭证' },
		{ table: 'swap_facility', debtType: '互换便利', subtype: null }
	];
	for (const [index, role] of roles.entries()) {
		const authId = `00000000-0000-4000-8000-00000000000${index + 1}`;
		await db.query('INSERT INTO neon_auth."user" (id, name, email, "emailVerified", role) VALUES ($1, $2, $3, TRUE, $4)', [authId, role, `${role}@example.com`, role]);
		await db.query('INSERT INTO financing.people (id, name, email, role, neon_auth_user_id) VALUES ($1, $2, $3, $4, $5)', [`person-${role}`, role, `${role}@example.com`, role, authId]);
		await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [authId]);
		await db.exec('SET ROLE authenticated');
		await db.query('INSERT INTO financing.finance_parameters (code, label, value_yi) VALUES ($1, $2, $3)', [`rls-${role}`, role, index + 1]);
		await db.query('UPDATE financing.finance_parameters SET value_yi = $1 WHERE code = $2', [index + 10, `rls-${role}`]);
		const fixture = debtFixtures[index];
		const debt = (await db.query(
			`INSERT INTO financing.${fixture.table} (debt_type, subtype, name, amount, issue_date) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
			[fixture.debtType, fixture.subtype, `rls-${role}`, index + 100, `2026-08-0${index + 1}`]
		)).rows[0];
		await db.query(`UPDATE financing.${fixture.table} SET amount = $1 WHERE id = $2`, [index + 200, debt.id]);
		await db.exec('RESET ROLE');
	}
	const saved = (await db.query("SELECT code, value_yi FROM financing.finance_parameters WHERE code LIKE 'rls-%' ORDER BY code")).rows;
	assert.equal(saved.length, 3);
	const audit = (await db.query("SELECT COUNT(*)::integer AS count FROM financing.audit_logs WHERE entity_type = 'finance_parameter' AND entity_id LIKE 'rls-%'")).rows[0];
	assert.equal(audit.count, 6);
	const debtAudit = (await db.query("SELECT COUNT(*)::integer AS count FROM financing.audit_logs WHERE entity_type = 'debt' AND summary LIKE 'Data API %'")).rows[0];
	assert.equal(debtAudit.count, 6);

	const inactiveAuthId = '00000000-0000-4000-8000-000000000009';
	await db.query('INSERT INTO neon_auth."user" (id, name, email, "emailVerified", role) VALUES ($1, $2, $3, TRUE, $4)', [inactiveAuthId, 'inactive', 'inactive@example.com', 'reviewer']);
	await db.query("INSERT INTO financing.people (id, name, email, role, active, neon_auth_user_id) VALUES ('inactive', 'inactive', 'inactive@example.com', 'reviewer', FALSE, $1)", [inactiveAuthId]);
	await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [inactiveAuthId]);
	await db.exec('SET ROLE authenticated');
	await assert.rejects(db.query("INSERT INTO financing.finance_parameters (code, label) VALUES ('rls-denied', 'denied')"), /row-level security|policy/i);
	await db.exec('RESET ROLE');

	for (const table of ['cashflow', 'balance_snapshot', 'audit_logs']) {
		const privilege = (await db.query(
			"SELECT has_table_privilege('authenticated', $1, 'SELECT') AS can_select, has_table_privilege('authenticated', $1, 'INSERT') AS can_insert",
			[`financing.${table}`]
		)).rows[0];
		assert.equal(privilege.can_select, false);
		assert.equal(privilege.can_insert, false);
	}
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
	await assert.rejects(
		db.query("INSERT INTO financing.debt (id, project_id, debt_type, name, amount) VALUES (102, 'project', '集团借款', '重复绑定', 100)"),
		/project is already linked to another debt/i
	);
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
