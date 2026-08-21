import crypto from 'node:crypto';

try {
	process.loadEnvFile('.env');
} catch (error) {
	if (error?.code !== 'ENOENT') throw error;
}

const [{ getLocalDatabase, databasePath }, { seedDatabase }, { hashPassword }] = await Promise.all([
	import('../src/lib/server/local-db.js'),
	import('../src/lib/server/seed.js'),
	import('../src/lib/server/auth-crypto.js')
]);

const db = getLocalDatabase();
seedDatabase(db);
const email = String(process.env.ADMIN_EMAIL ?? '').trim().toLowerCase();
const adminName = String(process.env.ADMIN_NAME ?? '管理员').trim() || '管理员';
const password = process.env.ADMIN_PASSWORD;
const existingAdmin = db.prepare(`
	SELECT u.id, u.person_id AS personId, p.email
	FROM auth_users u JOIN people p ON p.id = u.person_id
	WHERE u.role = 'admin' AND u.active = 1
	LIMIT 1
`).get();
if (existingAdmin && !existingAdmin.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
	db.prepare('UPDATE people SET email = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(email, existingAdmin.personId);
}
if (!existingAdmin) {
	if (!password) throw new Error('缺少 ADMIN_PASSWORD，无法初始化管理员账号');
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
		throw new Error('缺少有效的 ADMIN_EMAIL，无法初始化管理员账号');
	}
	const passwordHash = await hashPassword(password);
	const person = db.prepare('SELECT id FROM people WHERE lower(email) = lower(?) LIMIT 1').get(email);
	const personId = person?.id ?? crypto.randomUUID();
	const accountId = crypto.randomUUID();
	db.transaction(() => {
		if (!person) {
			db.prepare("INSERT INTO people (id, name, email, role, active) VALUES (?, ?, ?, 'admin', 1)").run(personId, adminName, email);
		} else {
			db.prepare("UPDATE people SET role = 'admin', active = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(personId);
		}
		db.prepare(`
			INSERT INTO auth_users (id, person_id, username, password_hash, role, active)
			VALUES (?, ?, ?, ?, 'admin', 1)
		`).run(accountId, personId, accountId, passwordHash);
	})();
}
console.log(JSON.stringify({ databasePath, status: 'initialized' }, null, 2));
