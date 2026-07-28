import { closeDatabase } from '../src/lib/server/db.js';
import { sendDueReminders } from '../src/lib/server/reminders.js';

const asOfArgument = process.argv.find((argument) => argument.startsWith('--date='));
const asOfDate = asOfArgument?.split('=')[1];
const dryRun = process.argv.includes('--dry-run');

try {
	const result = await sendDueReminders({ asOfDate, dryRun });
	console.log(JSON.stringify(result, null, 2));
} finally {
	closeDatabase();
}
