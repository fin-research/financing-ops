import path from 'node:path';
import fs from 'node:fs';
import { buildTypedDebtData } from '../src/lib/debt-details.js';
import { createImportDatasets, importDatasetCounts } from '../src/lib/incremental-import.js';
import { parseDebtWorkbookData } from '../src/lib/excel-import.js';
import { sha256Hex } from '../src/lib/hash.js';
import {
	commitIncrementalImport,
	filterIncrementalRows,
	preflightIncrementalImport
} from '../src/lib/server/incremental-import.js';
import { seedDatabase } from '../src/lib/server/seed.js';
import { getLocalDatabase } from '../src/lib/server/local-db.js';
import { createSqliteD1Adapter } from '../src/lib/server/sqlite-d1.js';

function rowChunks(rows, maximumBytes = 450_000) {
	const encoder = new TextEncoder();
	const chunks = [];
	let current = [];
	let bytes = 2;
	for (const row of rows) {
		const rowBytes = encoder.encode(JSON.stringify(row)).byteLength + (current.length ? 1 : 0);
		if (current.length && (bytes + rowBytes > maximumBytes || current.length >= 2500)) {
			chunks.push(current);
			current = [];
			bytes = 2;
		}
		current.push(row);
		bytes += rowBytes;
	}
	if (current.length) chunks.push(current);
	return chunks;
}

const source = process.argv[2] ?? path.resolve('data', 'ledger.xlsx');
const sqlite = getLocalDatabase();
seedDatabase(sqlite);
const db = createSqliteD1Adapter(sqlite);
const workbookData = fs.readFileSync(source);
const sourceFile = path.basename(source);
const parsed = parseDebtWorkbookData(workbookData, sourceFile);
const datasets = createImportDatasets(parsed, buildTypedDebtData(parsed));
const metadata = {
	workbookName: sourceFile,
	workbookHash: sha256Hex(workbookData),
	asOfDate: parsed.snapshot.asOfDate,
	debtCount: datasets.debts.length,
	fieldValueCount: parsed.fieldValueCount,
	cashflowCount: datasets.cashflows.length,
	historyDateCount: parsed.historyDateCount,
	excludedFutureCount: parsed.excludedFutureDates.length,
	datasetCounts: importDatasetCounts(datasets)
};
const preflight = await preflightIncrementalImport(db, metadata);
if (preflight.unchanged) {
	console.log(JSON.stringify({ sourceFile, unchanged: true, inserted: 0, updated: 0, deleted: 0, rowsWritten: 0 }, null, 2));
	process.exit(0);
}
const incremental = Object.fromEntries(Object.keys(datasets).map((key) => [key, []]));
incremental.balances = datasets.balances.filter((row) =>
	!preflight.maxBalanceDate || String(row[0]) > String(preflight.maxBalanceDate)
);
for (const [key, rows] of Object.entries(datasets)) {
	if (key === 'balances') continue;
	for (const chunk of rowChunks(rows)) {
		const filtered = await filterIncrementalRows(db, preflight.expectedWorkbookHash, key, chunk);
		incremental[key].push(...filtered.newIndexes.map((index) => chunk[index]));
	}
}
console.log(JSON.stringify(await commitIncrementalImport(db, {
	expectedWorkbookHash: preflight.expectedWorkbookHash,
	metadata,
	datasets: incremental
}), null, 2));
