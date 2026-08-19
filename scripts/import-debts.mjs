import path from 'node:path';
import fs from 'node:fs';
import { importDebtWorkbook } from '../src/lib/excel-import.js';
import { seedDatabase } from '../src/lib/server/seed.js';
import { getLocalDatabase } from '../src/lib/server/local-db.js';

const source = process.argv[2] ?? path.resolve('data', 'ledger.xlsx');
const db = getLocalDatabase();
seedDatabase(db);
console.log(JSON.stringify(importDebtWorkbook(fs.readFileSync(source), path.basename(source), { db }), null, 2));
