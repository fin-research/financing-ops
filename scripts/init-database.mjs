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
const username = String(process.env.ADMIN_USERNAME ?? 'admin').trim();
const password = process.env.ADMIN_PASSWORD;
if (!password) throw new Error('缺少 ADMIN_PASSWORD，无法初始化管理员账号');
const existingAdmin = db.prepare("SELECT id FROM auth_users WHERE role = 'admin' AND active = 1 LIMIT 1").get();
if (!existingAdmin) {
	const passwordHash = await hashPassword(password);
	const person = db.prepare('SELECT id FROM people WHERE lower(name) = lower(?) LIMIT 1').get(username);
	const personId = person?.id ?? crypto.randomUUID();
	db.transaction(() => {
		if (!person) {
			db.prepare("INSERT INTO people (id, name, role, active) VALUES (?, ?, 'admin', 1)").run(personId, username);
		} else {
			db.prepare("UPDATE people SET role = 'admin', active = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(personId);
		}
		db.prepare(`
			INSERT INTO auth_users (id, person_id, username, password_hash, role, active)
			VALUES (?, ?, ?, ?, 'admin', 1)
		`).run(crypto.randomUUID(), personId, username, passwordHash);
	})();
}
console.log(JSON.stringify({ databasePath, status: 'initialized' }, null, 2));
