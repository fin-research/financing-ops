import { createPostgresDatabase } from '../src/lib/postgres.js';
import { sendDueReminders } from '../src/lib/server/reminders.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('缺少 DATABASE_URL；提醒任务必须从本地直连 Neon');

const asOfArgument = process.argv.find((argument) => argument.startsWith('--date='));
const asOfDate = asOfArgument?.split('=')[1];
const dryRun = process.argv.includes('--dry-run');
const db = createPostgresDatabase(connectionString, 'eastmoney-financing-reminders');

try {
	const result = await sendDueReminders({ asOfDate, dryRun, db, config: process.env });
	console.log(JSON.stringify(result, null, 2));
} finally {
	await db.close();
}
