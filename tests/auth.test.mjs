import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { isValidEmail, normalizeEmail } from '../src/lib/email.js';
import { DATA_ADMIN_DEBT_TYPES, DEBT_TYPES } from '../src/lib/debt-types.js';
import { cacheSessionUser, invalidateCachedSession, readCachedSessionUser } from '../src/lib/server/auth-cache.js';
import { createNeonAuthClient, jwtFromResponseHeaders, NEON_SESSION_COOKIE, sessionMaxAgeFromSetCookie, sessionTokenFromSetCookie } from '../src/lib/server/neon-auth-client.js';
import { dataApiUrlFromAuthUrl } from '../src/lib/neon-urls.js';
import { deleteProjectWithReminders } from '../src/lib/server/project-deletion.js';
import { actionNameFromUrl, isAuthorizedRequest, isSafeRequestMethod } from '../src/lib/server/request-authorization.js';

function migrationSql(name) {
	return fs.readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8')
		.replace(/^\s*BEGIN\s*;?/i, '').replace(/\s*COMMIT\s*;?\s*$/i, '');
}

async function installSchema(db, { beforeReminderMigration } = {}) {
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
	for (const name of [
		'0001_financing_postgres.sql',
		'0002_neon_auth_prepare.sql',
		'0003_remove_custom_auth.sql',
		'0004_data_api_rls.sql',
		'0005_hide_derived_data_api_tables.sql',
		'0006_enforce_single_debt_project.sql',
		'0007_detach_projects_from_debt.sql',
		'0008_sop_node_reminder_periods.sql',
		'0009_liability_report_sources_and_snapshots.sql',
		'0010_liability_report_daily_overwrite.sql',
		'0015_income_certificate_dates_and_names.sql',
		'0016_income_certificate_name_edge_cases.sql',
		'0017_normalize_refinancing_name.sql',
		'0018_liability_report_data_api.sql',
		'0019_allow_authenticated_liability_report_rpc.sql'
	]) {
		if (name === '0008_sop_node_reminder_periods.sql' && beforeReminderMigration) {
			await beforeReminderMigration(db);
		}
		await db.exec(migrationSql(name));
	}
}

test('login emails are normalized and validated', () => {
	assert.equal(normalizeEmail(' User@Example.COM '), 'user@example.com');
	assert.equal(isValidEmail('user@example.com'), true);
	assert.equal(isValidEmail('legacy-admin'), false);
});

test('write authorization is enforced by role and named action', () => {
	assert.equal(actionNameFromUrl(new URL('https://example.com/financing/logout')), 'default');
	assert.equal(actionNameFromUrl(new URL('https://example.com/financing/projects?/createProject')), 'createProject');
	for (const method of ['GET', 'HEAD', 'OPTIONS']) {
		assert.equal(isSafeRequestMethod(method), true);
		assert.equal(isAuthorizedRequest(null, '/projects', method), true);
	}
	assert.equal(isSafeRequestMethod('POST'), false);
	assert.equal(isAuthorizedRequest('admin', '/sop/[id]', 'POST', 'deleteNode'), true);

	for (const role of ['handler', 'reviewer']) {
		assert.equal(isAuthorizedRequest(role, '/logout', 'POST'), true);
		assert.equal(isAuthorizedRequest(role, '/settings', 'POST', 'updateProfile'), true);
		assert.equal(isAuthorizedRequest(role, '/settings', 'POST', 'updatePassword'), true);
		assert.equal(isAuthorizedRequest(role, '/projects/[id]', 'POST', 'updateOwnTaskStatus'), true);
		assert.equal(isAuthorizedRequest(role, '/projects/[id]', 'POST', 'updateTask'), false);
		assert.equal(isAuthorizedRequest(role, '/logout', 'DELETE'), false);
	}

	for (const [routeId, actionName] of [
		['/people', 'createPerson'],
		['/projects', 'createProject'],
		['/sop', 'createSop'],
		['/liability-report', 'saveSnapshot']
	]) {
		assert.equal(isAuthorizedRequest('reviewer', routeId, 'POST', actionName), true);
		assert.equal(isAuthorizedRequest('handler', routeId, 'POST', actionName), false);
	}
	assert.equal(isAuthorizedRequest('reviewer', '/people', 'POST', 'updatePerson'), false);
	assert.equal(isAuthorizedRequest('reviewer', '/sop', 'POST', 'createReminder'), false);
});

test('reviewer creation and own-task writes retain server-side field boundaries', () => {
	const peopleSource = fs.readFileSync(new URL('../src/routes/people/+page.server.ts', import.meta.url), 'utf8');
	assert.match(peopleSource, /actorRole === 'reviewer' && \(fields\.accountEnabled \|\| fields\.role === 'admin'\)/);
	const taskSource = fs.readFileSync(new URL('../src/routes/projects/[id]/+page.server.ts', import.meta.url), 'utf8');
	assert.match(taskSource, /updateOwnTaskStatus:/);
	assert.match(taskSource, /before\.assigneeId !== personId/);
	assert.match(taskSource, /WHERE id = \? AND project_id = \? AND assignee_id = \?/);
	const ownTaskAction = taskSource.slice(taskSource.indexOf('updateOwnTaskStatus:'), taskSource.indexOf('\n\taddTask:'));
	assert.match(ownTaskAction, /SET status = \?,\s*completed_at = CASE/);
	assert.doesNotMatch(ownTaskAction, /SET status = \?,\s*assignee_id = \?/);
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

test('Data API token requests bypass the Neon Auth session cookie cache', async () => {
	const requests = [];
	const client = createNeonAuthClient({
		baseUrl: 'https://example.neonauth.us-west-2.aws.neon.tech/neondb/auth',
		origin: 'https://eastmoney.hasbai.xyz', token: 'opaque-token',
		fetchImpl: async (url) => {
			requests.push(String(url));
			return new Response(JSON.stringify({ user: { id: 'auth-id' } }), {
				status: 200,
				headers: { 'content-type': 'application/json', 'set-auth-jwt': 'short-lived-jwt' }
			});
		}
	});
	const session = await client.getSession({ disableCookieCache: true });
	assert.equal(session.jwt, 'short-lived-jwt');
	assert.equal(new URL(requests[0]).searchParams.get('disableCookieCache'), 'true');
	const hooksSource = fs.readFileSync(new URL('../src/hooks.server.ts', import.meta.url), 'utf8');
	assert.match(hooksSource, /requireDataApiJwt:\s*routeId === '\/data\/token'/);
});

test('short-lived Worker auth cache hashes opaque tokens and can be invalidated', async () => {
	const entries = new Map();
	const writes = [];
	const cache = {
		async match(request) { return entries.get(request.url)?.clone(); },
		async put(request, response) { entries.set(request.url, response.clone()); },
		async delete(request) { return entries.delete(request.url); }
	};
	const event = {
		url: new URL('https://eastmoney.hasbai.xyz/financing/projects'),
		platform: {
			caches: { async open() { return cache; } },
			context: { waitUntil(promise) { writes.push(promise); } }
		}
	};
	const user = {
		id: 'auth-id', email: 'admin@example.com', role: 'admin', personId: 'person-id',
		personName: '管理员', hasAvatar: false, avatarVersion: '1'
	};
	await cacheSessionUser(event, 'opaque-session-token', user);
	await Promise.all(writes);
	assert.equal(entries.size, 1);
	assert.equal([...entries.keys()][0].includes('opaque-session-token'), false);
	assert.deepEqual(await readCachedSessionUser(event, 'opaque-session-token'), user);
	assert.equal(await invalidateCachedSession(event, 'opaque-session-token'), true);
	assert.equal(await readCachedSessionUser(event, 'opaque-session-token'), null);
});

test('收益凭证在数据后台合并、在仪表盘筛选中保留浮动和固定分类', () => {
	assert.deepEqual(
		DEBT_TYPES.filter((item) => item.type === '收益凭证').map((item) => item.label),
		['浮动收益凭证', '固定收益凭证']
	);
	const adminEntities = DATA_ADMIN_DEBT_TYPES.filter((item) => item.type === '收益凭证');
	assert.equal(adminEntities.length, 1);
	assert.equal(adminEntities[0].label, '收益凭证');
	assert.equal(adminEntities[0].filterSubtype, false);
	assert.deepEqual(adminEntities[0].subtypeOptions.map((item) => item.value), ['浮动收益凭证', '固定收益凭证']);
	const adminSource = fs.readFileSync(new URL('../src/lib/data-admin.ts', import.meta.url), 'utf8');
	assert.match(adminSource, /DATA_ADMIN_DEBT_TYPES\.map/);
	assert.match(adminSource, /item\.filterSubtype \? \{ subtype: item\.fixedSubtype \} : \{\}/);
});

test('Data API URL is derived from the branch-scoped Neon Auth URL', () => {
	assert.equal(
		dataApiUrlFromAuthUrl('https://ep-example.neonauth.us-west-2.aws.neon.tech/neondb/auth'),
		'https://ep-example.apirest.us-west-2.aws.neon.tech/neondb/rest/v1'
	);
	assert.equal(dataApiUrlFromAuthUrl('https://example.com/auth'), null);
});

test('SOP-node reminder migration removes legacy rules before installing the new relation model', async (t) => {
	const db = new PGlite();
	t.after(() => db.close());
	await installSchema(db, {
		beforeReminderMigration: async (database) => {
			await database.exec(`
				INSERT INTO financing.reminder_rules (id, name, trigger_field)
				VALUES ('legacy-rule', '旧提醒', 'due_date');
				INSERT INTO financing.reminder_deliveries (
					id, rule_id, target_type, target_id, delivery_date, recipients, status
				) VALUES ('legacy-delivery', 'legacy-rule', 'project_task', 'task', '2026-08-23', '[]', 'sent');
			`);
		}
	});
	assert.equal((await db.query('SELECT COUNT(*)::integer AS count FROM financing.reminder_rules')).rows[0].count, 0);
	assert.equal((await db.query('SELECT COUNT(*)::integer AS count FROM financing.reminder_deliveries')).rows[0].count, 0);
	const ruleColumns = (await db.query(`
		SELECT column_name FROM information_schema.columns
		WHERE table_schema = 'financing' AND table_name = 'reminder_rules'
	`)).rows.map((row) => row.column_name);
	assert.equal(ruleColumns.includes('frequency'), false);
	assert.equal(ruleColumns.includes('offset_days'), false);
	assert.equal((await db.query("SELECT to_regclass('financing.reminder_rule_nodes') AS table_name")).rows[0].table_name, 'financing.reminder_rule_nodes');
	assert.equal((await db.query("SELECT to_regclass('financing.reminder_rule_periods') AS table_name")).rows[0].table_name, 'financing.reminder_rule_periods');
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
	const debtColumns = (await db.query("SELECT column_name FROM information_schema.columns WHERE table_schema = 'financing' AND table_name = 'debt'")).rows.map((row) => row.column_name);
	assert.equal(debtColumns.includes('project_id'), false);
	for (const table of ['liability_market_observations', 'liability_peer_issuances', 'liability_registration_progress']) {
		assert.equal((await db.query('SELECT to_regclass($1) AS table_name', [`financing.${table}`])).rows[0].table_name, null);
	}
	assert.equal(
		(await db.query("SELECT to_regprocedure('financing.liability_weekly_report_data(date)')::text AS function_name")).rows[0].function_name,
		'financing.liability_weekly_report_data(date)'
	);
	assert.equal(
		(await db.query("SELECT has_function_privilege('authenticated', 'financing.liability_weekly_report_data(date)', 'EXECUTE') AS allowed")).rows[0].allowed,
		true
	);
	assert.equal(
		(await db.query("SELECT has_function_privilege('anonymous', 'financing.liability_weekly_report_data(date)', 'EXECUTE') AS allowed")).rows[0].allowed,
		false
	);
	await db.exec('CREATE TABLE public.edb (indicator_code text, observation_date date, value numeric)');
	await db.exec('SET ROLE authenticated');
	const reportPayload = (await db.query(`
		SELECT financing.liability_weekly_report_data(
			(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date
		) AS payload
	`)).rows[0].payload;
	await db.exec('RESET ROLE');
	assert.equal(reportPayload.version, 1);
	assert.equal(reportPayload.report.asOfDate, new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' }));

	await db.query("INSERT INTO financing.people (id, name, email, role) VALUES ('one', '甲', 'user@example.com', 'handler')");
	await assert.rejects(db.query("INSERT INTO financing.people (id, name, email, role) VALUES ('two', '乙', 'USER@example.com', 'reviewer')"), /duplicate key value|unique constraint/i);
	await db.exec(`
		INSERT INTO financing.sop_templates (id, name, debt_type) VALUES ('sop', '测试 SOP', '小公募');
		INSERT INTO financing.sop_nodes (id, template_id, name, sort_order) VALUES ('node', 'sop', '测试节点', 1);
		INSERT INTO financing.projects (id, code, name, debt_type, sop_template_id) VALUES ('project', 'P-1', '测试项目', '小公募', 'sop');
	`);
	await db.query(`INSERT INTO financing.bond (id, debt_type, subtype, name, amount, interest_payable, annual_rate, issue_date, maturity_date, activated_at)
		VALUES (101, '债券', '小公募', '26东财01', 1000, 25, 0.02, '2026-01-01', '2027-01-01', '2026-01-01')`);
	await db.query("INSERT INTO financing.debt (id, debt_type, name, amount) VALUES (102, '集团借款', '独立负债', 100)");
	const debt = (await db.query('SELECT total_amount, term_days, status, tableoid::regclass::text AS physical_table FROM financing.debt WHERE id = 101')).rows[0];
	assert.equal(Number(debt.total_amount), 1025);
	assert.equal(debt.term_days, 365);
	assert.equal(debt.status, 'active');
	assert.equal(debt.physical_table, 'financing.bond');
	await assert.rejects(db.query("INSERT INTO financing.income_certificate (id, debt_type, subtype, name, amount) VALUES (101, '收益凭证', '固定收益凭证', '冲突凭证', 100)"), /duplicate debt id/i);
	await db.query(`INSERT INTO financing.income_certificate (
		id, debt_type, subtype, name, amount, subscription_date, redemption_date, activated_at
	) VALUES (103, '收益凭证', '固定收益凭证', '东方财富证券财气东来两年期1918号收益凭证', 150000,
		'2026-09-01', '2026-09-07', '2026-09-01')`);
	const certificate = (await db.query('SELECT name, maturity_date, subscription_date, redemption_date FROM financing.income_certificate WHERE id = 103')).rows[0];
	assert.equal(certificate.name, '财气东来1918号收益凭证');
	assert.equal(new Date(certificate.maturity_date).toISOString().slice(0, 10), '2026-09-04');
	assert.equal(new Date(certificate.subscription_date).toISOString().slice(0, 10), '2026-09-01');
	assert.equal(new Date(certificate.redemption_date).toISOString().slice(0, 10), '2026-09-07');
	await db.query(`INSERT INTO financing.refinancing (
		id, debt_type, name, counterparty, amount, issue_date, maturity_date, activated_at
	) VALUES (104, '转融资', '转融资·不应保留的对手方·2026-01-01', '测试对手方', 200000,
		'2026-01-01', '2026-12-31', '2026-01-01')`);
	const refinancing = (await db.query('SELECT name, counterparty FROM financing.refinancing WHERE id = 104')).rows[0];
	assert.equal(refinancing.name, '转融资');
	assert.equal(refinancing.counterparty, '测试对手方');
	await db.query("INSERT INTO financing.cashflow (debt_id, cashflow_type, due_date, amount) VALUES (101, 'interest', '2026-12-31', 25)");
	assert.equal((await db.query('SELECT sequence FROM financing.cashflow')).rows[0].sequence, 1);
	await assert.rejects(db.query("INSERT INTO financing.cashflow (debt_id, cashflow_type, due_date, amount) VALUES (999, 'principal', '2026-12-31', 100)"), /debt does not exist/i);
	await db.exec(`
		INSERT INTO financing.project_tasks (id, project_id, sop_node_id, name, due_date) VALUES ('task', 'project', 'node', '测试节点', '2026-08-23');
		INSERT INTO financing.reminder_rules (id, name) VALUES ('rule', '测试提醒');
		INSERT INTO financing.reminder_rule_nodes (rule_id, sop_node_id) VALUES ('rule', 'node');
		INSERT INTO financing.reminder_rule_periods (id, rule_id, lead_hours, sort_order) VALUES ('period', 'rule', 36, 1);
		INSERT INTO financing.reminder_deliveries (id, rule_id, period_id, target_type, target_id, delivery_date, scheduled_for, recipients, status) VALUES
			('delivery-project', 'rule', 'period', 'project', 'project', '2026-08-23', '2026-08-22T04:00:00Z', '[]', 'pending'),
			('delivery-task', 'rule', 'period', 'project_task', 'task', '2026-08-23', '2026-08-22T04:00:00Z', '[]', 'pending'),
			('delivery-debt', 'rule', 'period', 'debt', '101', '2026-08-23', '2026-08-22T04:00:00Z', '[]', 'pending');
	`);
	const deleted = await deleteProjectWithReminders(db, 'project');
	assert.equal(deleted.taskCount, 1);
	assert.equal(deleted.reminderCount, 2);
	assert.equal((await db.query('SELECT COUNT(*)::integer AS count FROM financing.projects')).rows[0].count, 0);
	assert.equal((await db.query('SELECT COUNT(*)::integer AS count FROM financing.project_tasks')).rows[0].count, 0);
	assert.deepEqual(
		(await db.query('SELECT id FROM financing.reminder_deliveries ORDER BY id')).rows.map((row) => row.id),
		['delivery-debt']
	);
	assert.equal(await deleteProjectWithReminders(db, 'project'), null);
	assert.equal((await db.query('SELECT COUNT(*)::integer AS count FROM financing.debt')).rows[0].count, 4);
	await db.query('DELETE FROM financing.bond WHERE id = 101');
	assert.equal((await db.query('SELECT COUNT(*)::integer AS count FROM financing.cashflow')).rows[0].count, 0);
});
