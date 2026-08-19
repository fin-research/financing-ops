import { closeLocalDatabase, getLocalDatabase } from '../src/lib/server/local-db.js';
import { sendDueReminders } from '../src/lib/server/reminders.js';

const asOfArgument = process.argv.find((argument) => argument.startsWith('--date='));
const asOfDate = asOfArgument?.split('=')[1];
const dryRun = process.argv.includes('--dry-run');

try {
	const result = await sendDueReminders({ asOfDate, dryRun, db: getLocalDatabase(), config: process.env });
	console.log(JSON.stringify(result, null, 2));
} finally {
	closeLocalDatabase();
}
