try {
	process.loadEnvFile('.env');
} catch (error) {
	if (error?.code !== 'ENOENT') throw error;
}

const [{ getDatabase, databasePath }, { seedDatabase }, { ensureAdminUser }] = await Promise.all([
	import('../src/lib/server/db.js'),
	import('../src/lib/server/seed.js'),
	import('../src/lib/server/auth.js')
]);

const db = getDatabase();
seedDatabase(db);
await ensureAdminUser();
console.log(JSON.stringify({ databasePath, status: 'initialized' }, null, 2));
