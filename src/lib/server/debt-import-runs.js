// @ts-nocheck

const RUN_COLUMNS = `
	id, workflow_instance_id AS "workflowInstanceId",
	source_file_name AS "fileName", source_size_bytes AS "fileSizeBytes",
	source_sha256 AS "sourceSha256", status, stage, progress, message,
	source_as_of_date AS "asOfDate", source_total_yi AS "totalYi",
	source_debt_count AS "sourceDebtCount", source_cashflow_count AS "sourceCashflowCount",
	source_balance_count AS "sourceBalanceCount",
	inserted_debt_count AS "insertedDebtCount", updated_debt_count AS "updatedDebtCount",
	inserted_cashflow_count AS "insertedCashflowCount", updated_cashflow_count AS "updatedCashflowCount",
	database_debt_count AS "databaseDebtCount", database_cashflow_count AS "databaseCashflowCount",
	history_date_count AS "historyDateCount", derived_metric_count AS "derivedMetricCount",
	error_message AS "errorMessage", created_by_person_id AS "createdByPersonId",
	started_at AS "startedAt", completed_at AS "completedAt",
	created_at AS "createdAt", updated_at AS "updatedAt"
`;

function numberOrNull(value) {
	if (value === null || value === undefined) return null;
	const result = Number(value);
	return Number.isFinite(result) ? result : null;
}

function normalizeRun(row) {
	if (!row) return null;
	return {
		...row,
		fileSizeBytes: numberOrNull(row.fileSizeBytes),
		progress: numberOrNull(row.progress) ?? 0,
		totalYi: numberOrNull(row.totalYi),
		sourceDebtCount: numberOrNull(row.sourceDebtCount),
		sourceCashflowCount: numberOrNull(row.sourceCashflowCount),
		sourceBalanceCount: numberOrNull(row.sourceBalanceCount),
		insertedDebtCount: numberOrNull(row.insertedDebtCount),
		updatedDebtCount: numberOrNull(row.updatedDebtCount),
		insertedCashflowCount: numberOrNull(row.insertedCashflowCount),
		updatedCashflowCount: numberOrNull(row.updatedCashflowCount),
		databaseDebtCount: numberOrNull(row.databaseDebtCount),
		databaseCashflowCount: numberOrNull(row.databaseCashflowCount),
		historyDateCount: numberOrNull(row.historyDateCount),
		derivedMetricCount: numberOrNull(row.derivedMetricCount)
	};
}

export async function createDebtImportRun(database, {
	id,
	workflowInstanceId,
	fileName,
	fileSizeBytes,
	createdByPersonId
}) {
	return database.transaction(async (transaction) => {
		await transaction.query(`
			DELETE FROM financing.debt_import_payloads payload
			USING financing.debt_import_runs run
			WHERE payload.run_id = run.id
				AND run.status IN ('parsing', 'queued', 'running')
				AND run.updated_at < CURRENT_TIMESTAMP - INTERVAL '2 hours'
		`);
		await transaction.query(`
			UPDATE financing.debt_import_runs SET
				status = 'failed',
				message = '导入任务超时，请重新上传',
				error_message = '任务超过两小时未更新，系统已自动释放导入锁',
				completed_at = CURRENT_TIMESTAMP
			WHERE status IN ('parsing', 'queued', 'running')
				AND updated_at < CURRENT_TIMESTAMP - INTERVAL '2 hours'
		`);
		const result = await transaction.query(`
			INSERT INTO financing.debt_import_runs (
				id, workflow_instance_id, source_file_name, source_size_bytes,
				status, stage, progress, message, created_by_person_id, started_at
			) VALUES ($1, $2, $3, $4, 'parsing', 'parsing', 10, '正在解析并校验工作簿', $5, CURRENT_TIMESTAMP)
			RETURNING ${RUN_COLUMNS}
		`, [id, workflowInstanceId, fileName, fileSizeBytes, createdByPersonId]);
		return normalizeRun(result.rows[0]);
	});
}

export async function stageDebtImportPayload(database, {
	runId,
	payload,
	sourceSha256,
	fileSizeBytes,
	parsed
}) {
	return database.transaction(async (transaction) => {
		await transaction.query(`
			INSERT INTO financing.debt_import_payloads (run_id, payload)
			VALUES ($1, $2::jsonb)
		`, [runId, JSON.stringify(payload)]);
		const result = await transaction.query(`
			UPDATE financing.debt_import_runs SET
				source_size_bytes = $2,
				source_sha256 = $3,
				status = 'queued',
				stage = 'queued',
				progress = 45,
				message = '工作簿校验通过，等待更新线上数据',
				source_as_of_date = $4::date,
				source_total_yi = $5,
				source_debt_count = $6,
				source_cashflow_count = $7,
				source_balance_count = $8,
				error_message = NULL
			WHERE id = $1
			RETURNING ${RUN_COLUMNS}
		`, [
			runId,
			fileSizeBytes,
			sourceSha256,
			parsed.asOfDate,
			parsed.totalYi,
			parsed.debtCount,
			parsed.cashflowCount,
			parsed.balanceCount
		]);
		return normalizeRun(result.rows[0]);
	});
}

export async function getDebtImportPayload(database, runId) {
	const result = await database.query(`
		SELECT payload FROM financing.debt_import_payloads WHERE run_id = $1
	`, [runId]);
	return result.rows[0]?.payload ?? null;
}

export async function updateDebtImportStage(database, runId, {
	status = 'running',
	stage,
	progress,
	message
}) {
	const result = await database.query(`
		UPDATE financing.debt_import_runs SET
			status = $2,
			stage = $3,
			progress = $4,
			message = $5,
			error_message = NULL
		WHERE id = $1
		RETURNING ${RUN_COLUMNS}
	`, [runId, status, stage, progress, message]);
	return normalizeRun(result.rows[0]);
}

export async function completeDebtImportRun(database, runId, importResult, derivativeResult) {
	return database.transaction(async (transaction) => {
		const result = await transaction.query(`
			UPDATE financing.debt_import_runs SET
				status = 'succeeded',
				stage = 'completed',
				progress = 100,
				message = '线上数据与衍生指标已更新',
				inserted_debt_count = $2,
				updated_debt_count = $3,
				inserted_cashflow_count = $4,
				updated_cashflow_count = $5,
				database_debt_count = $6,
				database_cashflow_count = $7,
				history_date_count = $8,
				derived_metric_count = $9,
				completed_at = CURRENT_TIMESTAMP,
				error_message = NULL
			WHERE id = $1
			RETURNING ${RUN_COLUMNS}
		`, [
			runId,
			importResult.insertedDebtCount,
			importResult.updatedDebtCount,
			importResult.insertedCashflowCount,
			importResult.updatedCashflowCount,
			importResult.debtCount,
			importResult.cashflowCount,
			importResult.historyDateCount,
			derivativeResult.refreshedCount
		]);
		await transaction.query('DELETE FROM financing.debt_import_payloads WHERE run_id = $1', [runId]);
		await transaction.query(`
			INSERT INTO financing.audit_logs (
				id, actor_person_id, actor_email, action, entity_type, entity_id,
				summary, after_json
			)
			SELECT $2, run.created_by_person_id, person.email,
				'debt_import.complete', 'debt_import', run.id,
				'线上借入资金汇总表导入完成',
				jsonb_build_object(
					'fileName', run.source_file_name,
					'asOfDate', run.source_as_of_date,
					'totalYi', run.source_total_yi,
					'sourceSha256', run.source_sha256,
					'insertedDebtCount', run.inserted_debt_count,
					'updatedDebtCount', run.updated_debt_count,
					'insertedCashflowCount', run.inserted_cashflow_count,
					'updatedCashflowCount', run.updated_cashflow_count,
					'derivedMetricCount', run.derived_metric_count
				)
			FROM financing.debt_import_runs run
			LEFT JOIN financing.people person ON person.id = run.created_by_person_id
			WHERE run.id = $1
			ON CONFLICT (id) DO NOTHING
		`, [runId, `${runId}:audit`]);
		return normalizeRun(result.rows[0]);
	});
}

export async function failDebtImportRun(database, runId, message) {
	return database.transaction(async (transaction) => {
		const result = await transaction.query(`
			UPDATE financing.debt_import_runs SET
				status = 'failed',
				message = '导入失败，请按提示修正后重新上传',
				error_message = $2,
				completed_at = CURRENT_TIMESTAMP
			WHERE id = $1 AND status <> 'succeeded'
			RETURNING ${RUN_COLUMNS}
		`, [runId, String(message).slice(0, 1000)]);
		await transaction.query('DELETE FROM financing.debt_import_payloads WHERE run_id = $1', [runId]);
		return normalizeRun(result.rows[0]);
	});
}

export async function getDebtImportRun(database, runId) {
	const result = await database.query(`
		SELECT ${RUN_COLUMNS}
		FROM financing.debt_import_runs
		WHERE id = $1
	`, [runId]);
	return normalizeRun(result.rows[0]);
}

export async function listDebtImportRuns(database, limit = 8) {
	const safeLimit = Math.min(Math.max(Number(limit) || 8, 1), 20);
	const result = await database.query(`
		SELECT ${RUN_COLUMNS}
		FROM financing.debt_import_runs
		ORDER BY created_at DESC, id DESC
		LIMIT $1
	`, [safeLimit]);
	return result.rows.map(normalizeRun);
}
