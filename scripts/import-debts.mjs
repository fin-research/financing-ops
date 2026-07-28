import path from 'node:path';
import { importDebtWorkbook } from '../src/lib/server/excel-import.js';
import { seedDatabase } from '../src/lib/server/seed.js';
import { getDatabase } from '../src/lib/server/db.js';

const source = process.argv[2] ?? path.resolve('data', 'ledger.xlsx');
seedDatabase(getDatabase());
console.log(JSON.stringify(importDebtWorkbook(source), null, 2));
