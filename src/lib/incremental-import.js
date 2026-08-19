// @ts-nocheck

export const IMPORT_DATASET_SPECS = Object.freeze({
	debts: { columns: 15, keyColumns: [0] },
	bond: { columns: 15, keyColumns: [0] },
	bondSchedule: { columns: 7, keyColumns: [0, 1] },
	certificate: { columns: 15, keyColumns: [0] },
	incomeRight: { columns: 5, keyColumns: [0] },
	incomeRightSchedule: { columns: 4, keyColumns: [0, 1] },
	interbank: { columns: 4, keyColumns: [0] },
	refinancing: { columns: 9, keyColumns: [0] },
	groupLoan: { columns: 2, keyColumns: [0] },
	groupSchedule: { columns: 11, keyColumns: [0, 1] },
	swap: { columns: 6, keyColumns: [0] },
	cashflows: { columns: 6, keyColumns: [0] },
	balances: { columns: 3, keyColumns: [0, 1] },
	workbookNotes: { columns: 2, keyColumns: [0] }
});

export const IMPORT_DATASET_KEYS = Object.freeze(Object.keys(IMPORT_DATASET_SPECS));

function comparable(value) {
	if (value === undefined) return null;
	if (typeof value === 'number') return Number.isFinite(value) ? value : null;
	return value;
}

export function importRowKey(key, row) {
	const spec = IMPORT_DATASET_SPECS[key];
	if (!spec) throw new Error(`未知导入数据类型：${key}`);
	if (!Array.isArray(row) || row.length !== spec.columns) {
		throw new Error(`${key} 记录字段数量不一致`);
	}
	return JSON.stringify(spec.keyColumns.map((index) => comparable(row[index])));
}

export function importRowsEqual(left, right) {
	return left.length === right.length && left.every((value, index) => {
		const other = right[index];
		if (value == null && other == null) return true;
		if (typeof value === 'number' || typeof other === 'number') {
			return Number(value) === Number(other);
		}
		return String(value) === String(other);
	});
}

export function normaliseImportDatasets(input) {
	if (!input || typeof input !== 'object' || Array.isArray(input)) {
		throw new Error('导入数据集格式无效');
	}
	const unknown = Object.keys(input).filter((key) => !IMPORT_DATASET_SPECS[key]);
	if (unknown.length) throw new Error(`存在未知导入数据集：${unknown.join('、')}`);

	const output = {};
	for (const key of IMPORT_DATASET_KEYS) {
		const rows = input[key] ?? [];
		if (!Array.isArray(rows)) throw new Error(`${key} 数据集必须是数组`);
		const unique = new Map();
		for (const row of rows) {
			const rowKey = importRowKey(key, row);
			const existing = unique.get(rowKey);
			if (existing && !importRowsEqual(existing, row)) {
				if (key === 'balances') {
					unique.set(rowKey, row.map(comparable));
					continue;
				}
				throw new Error(`${key} 存在业务键相同但内容不一致的重复记录：${rowKey}`);
			}
			if (!existing) unique.set(rowKey, row.map(comparable));
		}
		output[key] = [...unique.values()];
	}
	return output;
}

export function createImportDatasets(parsed, typed) {
	return normaliseImportDatasets({
		debts: parsed.debts.map((debt) => debt.slice(1)),
		...typed,
		cashflows: parsed.cashflows,
		balances: parsed.balances,
		workbookNotes: parsed.workbookNotes
	});
}

export function importDatasetCounts(datasets) {
	return Object.fromEntries(IMPORT_DATASET_KEYS.map((key) => [key, datasets[key]?.length ?? 0]));
}
