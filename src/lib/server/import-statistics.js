// @ts-nocheck

const number = (value) => Number(value ?? 0);

export async function getCachedImportAsOfDate(db) {
	const row = await db.prepare('SELECT as_of_date AS asOfDate FROM data_import_state WHERE id = 1').get();
	return row?.asOfDate ?? null;
}

export async function getCachedImportStatistics(db) {
	const row = await db.prepare(`
		SELECT workbook_name AS sourceFile, as_of_date AS asOfDate, status,
			started_at AS startedAt, finished_at AS finishedAt,
			inserted_count AS insertedCount, updated_count AS updatedCount,
			deleted_count AS deletedCount, debt_count AS debtCount,
			field_value_count AS fieldValueCount, cashflow_count AS cashflowEventCount,
			history_date_count AS historyDateCount, snapshot_total_yi AS totalYi,
			history_start_date AS historyStartDate, history_end_date AS historyEndDate,
			stats_refreshed_at AS statsRefreshedAt, error_message AS errorMessage
		FROM data_import_state WHERE id = 1
	`).get();
	if (!row) return null;
	return {
		...row,
		insertedCount: number(row.insertedCount),
		updatedCount: number(row.updatedCount),
		deletedCount: number(row.deletedCount),
		debtCount: number(row.debtCount),
		fieldValueCount: number(row.fieldValueCount),
		cashflowEventCount: number(row.cashflowEventCount),
		historyDateCount: number(row.historyDateCount),
		totalYi: row.totalYi == null ? null : number(row.totalYi),
		statsReady: row.totalYi != null && row.historyStartDate != null && row.historyEndDate != null
	};
}

export async function recalculateImportStatistics(db) {
	const current = await db.prepare('SELECT id FROM data_import_state WHERE id = 1').get();
	if (!current) throw new Error('尚未导入 Excel 台账，无法重新统计');

	const statistics = await db.prepare(`
		WITH balance_stats AS (
			SELECT COUNT(*) AS balanceRowCount,
				COUNT(DISTINCT as_of_date) AS historyDateCount,
				MIN(as_of_date) AS historyStartDate,
				MAX(as_of_date) AS historyEndDate
			FROM debt_balance_daily
		), latest_snapshot AS (
			SELECT COUNT(*) AS debtTypeCount, SUM(b.balance_yi) AS totalYi
			FROM debt_balance_daily b
			JOIN balance_stats s ON b.as_of_date = s.historyEndDate
		)
		SELECT (SELECT COUNT(*) FROM debts) AS debtCount,
			(SELECT COUNT(*) FROM debt_cashflow_events) AS cashflowEventCount,
			s.balanceRowCount, s.historyDateCount, s.historyStartDate, s.historyEndDate,
			l.debtTypeCount, l.totalYi
		FROM balance_stats s CROSS JOIN latest_snapshot l
	`).get();

	const historyDateCount = number(statistics?.historyDateCount);
	const balanceRowCount = number(statistics?.balanceRowCount);
	if (!statistics?.historyEndDate || historyDateCount === 0) {
		throw new Error('日余额历史为空，统计已取消');
	}
	if (number(statistics.debtTypeCount) !== 10 || balanceRowCount !== historyDateCount * 10) {
		throw new Error(`日余额历史不完整：${historyDateCount} 个日期、${balanceRowCount} 条品种余额`);
	}

	const result = await db.prepare(`
		UPDATE data_import_state SET
			as_of_date = ?, debt_count = ?, cashflow_count = ?, history_date_count = ?,
			snapshot_total_yi = ?, history_start_date = ?, history_end_date = ?,
			stats_refreshed_at = CURRENT_TIMESTAMP
		WHERE id = 1
	`).run(
		statistics.historyEndDate,
		number(statistics.debtCount),
		number(statistics.cashflowEventCount),
		historyDateCount,
		number(statistics.totalYi),
		statistics.historyStartDate,
		statistics.historyEndDate
	);
	if (Number(result?.meta?.changes ?? 0) !== 1) throw new Error('统计快照保存失败');

	return {
		debtCount: number(statistics.debtCount),
		cashflowEventCount: number(statistics.cashflowEventCount),
		historyDateCount,
		historyStartDate: statistics.historyStartDate,
		historyEndDate: statistics.historyEndDate,
		totalYi: number(statistics.totalYi)
	};
}
