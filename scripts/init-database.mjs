import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { hashPassword } from '../src/lib/server/auth-crypto.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('缺少 DATABASE_URL；数据库初始化必须从本地直连 Neon');
const schemaOnly = process.argv.includes('--schema-only');

const client = new Client({ connectionString, application_name: 'eastmoney-financing-init' });
const migrationDirectory = path.resolve('migrations');
const migrations = fs.readdirSync(migrationDirectory)
	.filter((name) => /^\d+.*\.sql$/.test(name))
	.sort();

function migrationBody(sql) {
	return sql
		.replace(/^\s*BEGIN\s*;?/i, '')
		.replace(/\s*COMMIT\s*;?\s*$/i, '');
}

await client.connect();
try {
	await client.query('CREATE SCHEMA IF NOT EXISTS financing');
	await client.query(`
		CREATE TABLE IF NOT EXISTS financing.schema_migrations (
			name text PRIMARY KEY,
			applied_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
		)
	`);
	const applied = new Set((await client.query('SELECT name FROM financing.schema_migrations')).rows.map((row) => row.name));
	for (const name of migrations) {
		if (applied.has(name)) continue;
		await client.query('BEGIN');
		try {
			await client.query(migrationBody(fs.readFileSync(path.join(migrationDirectory, name), 'utf8')));
			await client.query('INSERT INTO financing.schema_migrations (name) VALUES ($1)', [name]);
			await client.query('COMMIT');
		} catch (error) {
			await client.query('ROLLBACK');
			throw error;
		}
	}

	await client.query(`
		INSERT INTO financing.finance_parameters (code, label)
		VALUES
			('securities_prior_year_net_assets', '证券上年末净资产'),
			('group_prior_year_net_assets', '集团上年末净资产'),
			('prior_month_net_capital', '上月末净资本')
		ON CONFLICT (code) DO UPDATE SET label = EXCLUDED.label
	`);

	const existingAdmin = await client.query(`
		SELECT u.id
		FROM financing.auth_users u
		WHERE u.role = 'admin'
		ORDER BY u.active DESC, u.created_at
		LIMIT 1
	`);
	if (!existingAdmin.rowCount && !schemaOnly) {
		const email = String(process.env.ADMIN_EMAIL ?? '').trim().toLowerCase();
		const name = String(process.env.ADMIN_NAME ?? '管理员').trim() || '管理员';
		const password = process.env.ADMIN_PASSWORD;
		if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('缺少有效的 ADMIN_EMAIL，无法初始化管理员');
		if (!password) throw new Error('缺少 ADMIN_PASSWORD，无法初始化管理员');
		const passwordHash = await hashPassword(password);
		await client.query('BEGIN');
		try {
			const existingPerson = await client.query('SELECT id FROM financing.people WHERE lower(email) = lower($1) LIMIT 1', [email]);
			const personId = existingPerson.rows[0]?.id ?? randomUUID();
			if (existingPerson.rowCount) {
				await client.query(`
					UPDATE financing.people SET role = 'admin', active = TRUE, updated_at = CURRENT_TIMESTAMP WHERE id = $1
				`, [personId]);
			} else {
				await client.query(`
					INSERT INTO financing.people (id, name, email, role) VALUES ($1, $2, $3, 'admin')
				`, [personId, name, email]);
			}
			await client.query(`
				INSERT INTO financing.auth_users (id, person_id, password_hash, role)
				VALUES ($1, $2, $3, 'admin')
			`, [randomUUID(), personId, passwordHash]);
			await client.query('COMMIT');
		} catch (error) {
			await client.query('ROLLBACK');
			throw error;
		}
	}

	console.log(JSON.stringify({ database: 'neon', schema: 'financing', migrations, schemaOnly, status: 'initialized' }, null, 2));
} finally {
	await client.end();
}
