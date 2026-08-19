// @ts-nocheck
import { stableDebtKey } from '../debt-key.js';
import { DEBT_FIELD_COLUMNS } from '../debt-fields.js';
import { migrateTypedDebtDetails } from '../debt-details.js';

const schemaVersion = 11;

function createDebtRecordsTable(db, tableName = 'debt_records', debtsTable = 'debts') {
	db.exec(`
		CREATE TABLE IF NOT EXISTS ${tableName} (
			debt_id TEXT NOT NULL REFERENCES ${debtsTable}(id) ON DELETE CASCADE,
			row_sequence INTEGER NOT NULL,
			${DEBT_FIELD_COLUMNS.map((column) => `${column} TEXT`).join(',\n\t\t\t')},
			PRIMARY KEY (debt_id, row_sequence)
		)
	`);
}

function tableColumns(db, table) {
	return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((item) => item.name));
}

function columnIndex(address) {
	const letters = String(address ?? '').match(/^[A-Z]+/i)?.[0]?.toUpperCase();
	if (!letters) return 0;
	return [...letters].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

function sourceDate(sourceFile) {
	const match = String(sourceFile ?? '').match(/(20\d{2})(\d{2})(\d{2})/);
	return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

function migrateCompactImportedData(db) {
	if (!tableColumns(db, 'debts').has('raw_data')) return;

	const latestSource = db.prepare(`
		SELECT source_file AS sourceFile, MAX(as_of_date) AS latestDate, COUNT(*) AS rowCount
		FROM debt_balance_history
		GROUP BY source_file
		ORDER BY latestDate DESC, rowCount DESC
		LIMIT 1
	`).get();
	if (!latestSource) return;

	const selectedRun = db.prepare(`
		SELECT source_file AS sourceFile, file_hash AS fileHash, started_at AS startedAt, finished_at AS finishedAt
		FROM import_runs
		WHERE source_file = ? AND status = 'completed'
		ORDER BY finished_at DESC
		LIMIT 1
	`).get(latestSource.sourceFile);
	const canonicalRun = selectedRun
		? db.prepare(`
			SELECT source_file AS sourceFile
			FROM import_runs
			WHERE file_hash = ? AND source_file GLOB '*20??????.xlsx'
			ORDER BY source_file DESC
			LIMIT 1
		`).get(selectedRun.fileHash)
		: null;
	const workbookName = canonicalRun?.sourceFile ?? latestSource.sourceFile;
	const asOfDate = sourceDate(workbookName) ?? latestSource.latestDate;
	const sourceRows = db.prepare(`
		SELECT source_sheet AS debtType, source_row AS sourceRow, parent_external_key AS externalKey, row_data AS rowData
		FROM debt_source_rows
		WHERE source_file = ? AND parent_external_key IS NOT NULL
		ORDER BY source_sheet, source_row
	`).all(latestSource.sourceFile);
	const cashflows = db.prepare(`
		SELECT event_key AS eventKey, debt_external_key AS externalKey,
			event_type AS eventType, event_date AS eventDate, amount
		FROM debt_cashflow_events
		WHERE source_file = ?
		ORDER BY source_sheet, source_row, event_date, event_type
	`).all(latestSource.sourceFile);

	db.pragma('foreign_keys = OFF');
	try {
		db.transaction(() => {
			db.exec(`
				DROP TABLE IF EXISTS debt_field_values;
				DROP TABLE IF EXISTS debt_field_definitions;
				DROP TABLE IF EXISTS data_import_state;

				CREATE TABLE debts_compact (
					id TEXT PRIMARY KEY,
					external_key TEXT NOT NULL UNIQUE,
					project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
					debt_type TEXT NOT NULL,
					category_level_1 TEXT,
					category_level_2 TEXT,
					instrument_name TEXT,
					instrument_code TEXT,
					borrower TEXT,
					counterparty TEXT,
					principal_amount REAL,
					outstanding_amount REAL,
					currency TEXT NOT NULL DEFAULT 'CNY',
					annual_rate REAL,
					issue_date TEXT,
					maturity_date TEXT,
					status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'matured', 'planned', 'closed')),
					import_marker TEXT,
					imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
					created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
					updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
				);
				INSERT INTO debts_compact (
					id, external_key, project_id, debt_type, category_level_1, category_level_2,
					instrument_name, instrument_code, borrower, counterparty, principal_amount,
					outstanding_amount, currency, annual_rate, issue_date, maturity_date, status,
					imported_at, created_at, updated_at
				)
				SELECT id, external_key, project_id, debt_type, category_level_1, category_level_2,
					instrument_name, instrument_code, borrower, counterparty, principal_amount,
					outstanding_amount, currency, annual_rate, issue_date, maturity_date, status,
					imported_at, created_at, updated_at
				FROM debts;

				CREATE TABLE debt_field_definitions_compact (
					id INTEGER PRIMARY KEY AUTOINCREMENT,
					debt_type TEXT NOT NULL,
					field_order INTEGER NOT NULL,
					field_name TEXT NOT NULL,
					UNIQUE(debt_type, field_order)
				);
				CREATE TABLE debt_field_values_compact (
					debt_id TEXT NOT NULL REFERENCES debts_compact(id) ON DELETE CASCADE,
					row_sequence INTEGER NOT NULL,
					field_id INTEGER NOT NULL REFERENCES debt_field_definitions_compact(id) ON DELETE CASCADE,
					display_value TEXT NOT NULL,
					numeric_value REAL,
					date_value TEXT,
					PRIMARY KEY (debt_id, row_sequence, field_id)
				);

				CREATE TABLE debt_cashflow_events_compact (
					event_key TEXT PRIMARY KEY,
					debt_id TEXT NOT NULL REFERENCES debts_compact(id) ON DELETE CASCADE,
					event_type TEXT NOT NULL CHECK (event_type IN ('interest', 'principal')),
					event_date TEXT NOT NULL,
					amount REAL,
					sequence INTEGER NOT NULL DEFAULT 0,
					created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
					updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
				);

				CREATE TABLE debt_balance_daily_compact (
					as_of_date TEXT NOT NULL,
					debt_type TEXT NOT NULL,
					balance_yi REAL NOT NULL,
					created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
					updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
					PRIMARY KEY (as_of_date, debt_type)
				);
				INSERT INTO debt_balance_daily_compact (as_of_date, debt_type, balance_yi, created_at, updated_at)
				SELECT as_of_date, debt_type, balance_yi, created_at, updated_at
				FROM debt_balance_daily
				WHERE as_of_date <= '${asOfDate.replaceAll("'", "''")}';

				CREATE TABLE data_import_state_compact (
					id INTEGER PRIMARY KEY CHECK (id = 1),
					workbook_name TEXT NOT NULL,
					workbook_hash TEXT NOT NULL,
					as_of_date TEXT NOT NULL,
					status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
					started_at TEXT NOT NULL,
					finished_at TEXT,
					inserted_count INTEGER NOT NULL DEFAULT 0,
					updated_count INTEGER NOT NULL DEFAULT 0,
					deleted_count INTEGER NOT NULL DEFAULT 0,
					debt_count INTEGER NOT NULL DEFAULT 0,
					field_value_count INTEGER NOT NULL DEFAULT 0,
					cashflow_count INTEGER NOT NULL DEFAULT 0,
					history_date_count INTEGER NOT NULL DEFAULT 0,
					excluded_future_count INTEGER NOT NULL DEFAULT 0,
					error_message TEXT
				);
			`);

			const debtIds = new Map(db.prepare('SELECT external_key AS externalKey, id FROM debts_compact').all().map((row) => [row.externalKey, row.id]));
			const definitionIds = new Map();
			const rowSequences = new Map();
			const insertDefinition = db.prepare(`
				INSERT INTO debt_field_definitions_compact (debt_type, field_order, field_name)
				VALUES (?, ?, ?)
				ON CONFLICT(debt_type, field_order) DO UPDATE SET field_name = excluded.field_name
			`);
			const findDefinition = db.prepare(`
				SELECT id FROM debt_field_definitions_compact WHERE debt_type = ? AND field_order = ?
			`);
			const insertValue = db.prepare(`
				INSERT OR REPLACE INTO debt_field_values_compact (
					debt_id, row_sequence, field_id, display_value, numeric_value, date_value
				) VALUES (?, ?, ?, ?, ?, ?)
			`);
			for (const row of sourceRows) {
				const debtId = debtIds.get(row.externalKey);
				if (!debtId) continue;
				const sequence = rowSequences.get(row.externalKey) ?? 0;
				rowSequences.set(row.externalKey, sequence + 1);
				let cells = [];
				try { cells = JSON.parse(row.rowData); } catch { cells = []; }
				for (const cell of cells) {
					const fieldOrder = columnIndex(cell.cell);
					const fieldName = String(cell.header ?? '').trim() || `未命名字段 ${fieldOrder + 1}`;
					const definitionKey = `${row.debtType}:${fieldOrder}`;
					let fieldId = definitionIds.get(definitionKey);
					if (!fieldId) {
						insertDefinition.run(row.debtType, fieldOrder, fieldName);
						fieldId = findDefinition.get(row.debtType, fieldOrder).id;
						definitionIds.set(definitionKey, fieldId);
					}
					const displayValue = String(cell.formatted ?? cell.value ?? '');
					const numericValue = typeof cell.value === 'number' && Number.isFinite(cell.value) ? cell.value : null;
					insertValue.run(debtId, sequence, fieldId, displayValue, numericValue, null);
				}
			}

			const cashflowSequence = new Map();
			const insertCashflow = db.prepare(`
				INSERT INTO debt_cashflow_events_compact (
					event_key, debt_id, event_type, event_date, amount, sequence
				) VALUES (?, ?, ?, ?, ?, ?)
			`);
			for (const flow of cashflows) {
				const debtId = debtIds.get(flow.externalKey);
				if (!debtId) continue;
				const sequenceKey = `${debtId}:${flow.eventType}:${flow.eventDate}`;
				const sequence = cashflowSequence.get(sequenceKey) ?? 0;
				cashflowSequence.set(sequenceKey, sequence + 1);
				insertCashflow.run(flow.eventKey, debtId, flow.eventType, flow.eventDate, flow.amount, sequence);
			}

			const debtCount = db.prepare('SELECT COUNT(*) AS count FROM debts_compact').get().count;
			const fieldValueCount = db.prepare('SELECT COUNT(*) AS count FROM debt_field_values_compact').get().count;
			const cashflowCount = db.prepare('SELECT COUNT(*) AS count FROM debt_cashflow_events_compact').get().count;
			const historyDateCount = db.prepare('SELECT COUNT(DISTINCT as_of_date) AS count FROM debt_balance_daily_compact').get().count;
			db.prepare(`
				INSERT INTO data_import_state_compact (
					id, workbook_name, workbook_hash, as_of_date, status, started_at, finished_at,
					debt_count, field_value_count, cashflow_count, history_date_count
				) VALUES (1, ?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?)
			`).run(
				workbookName,
				selectedRun?.fileHash ?? '',
				asOfDate,
				selectedRun?.startedAt ?? new Date().toISOString(),
				selectedRun?.finishedAt ?? new Date().toISOString(),
				debtCount,
				fieldValueCount,
				cashflowCount,
				historyDateCount
			);

			db.exec(`
				DROP TABLE debt_cashflow_events;
				DROP TABLE debt_source_rows;
				DROP TABLE debt_balance_history;
				DROP TABLE debt_balance_daily;
				DROP TABLE debts;
				DROP TABLE import_runs;
				ALTER TABLE debts_compact RENAME TO debts;
				ALTER TABLE debt_field_definitions_compact RENAME TO debt_field_definitions;
				ALTER TABLE debt_field_values_compact RENAME TO debt_field_values;
				ALTER TABLE debt_cashflow_events_compact RENAME TO debt_cashflow_events;
				ALTER TABLE debt_balance_daily_compact RENAME TO debt_balance_daily;
				ALTER TABLE data_import_state_compact RENAME TO data_import_state;
			`);
		})();
	} finally {
		db.pragma('foreign_keys = ON');
	}
}

function migrateStableDebtKeys(db) {
	if (db.prepare('SELECT 1 FROM schema_migrations WHERE version = 8').get()) return;
	const debts = db.prepare(`
		SELECT id, debt_type AS debtType, instrument_name AS instrumentName,
			instrument_code AS instrumentCode, borrower, counterparty,
			principal_amount AS principalAmount, issue_date AS issueDate,
			maturity_date AS maturityDate, annual_rate AS annualRate
		FROM debts
		ORDER BY debt_type, issue_date, maturity_date, instrument_code,
			instrument_name, counterparty, principal_amount, created_at, id
	`).all();
	const occurrences = new Map();
	db.transaction(() => {
		db.prepare("UPDATE debts SET external_key = 'legacy:' || external_key").run();
		const update = db.prepare('UPDATE debts SET external_key = ? WHERE id = ?');
		for (const debt of debts) {
			const base = stableDebtKey(debt, 0);
			const occurrence = occurrences.get(base) ?? 0;
			occurrences.set(base, occurrence + 1);
			update.run(stableDebtKey(debt, occurrence), debt.id);
		}
		db.prepare('INSERT INTO schema_migrations (version) VALUES (8)').run();
	})();
}

function migrateWideDebtFields(db) {
	if (db.prepare('SELECT 1 FROM schema_migrations WHERE version = 9').get()) return;
	if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'debt_field_values'").get()) {
		db.exec(`
			CREATE TABLE IF NOT EXISTS debt_field_definitions (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				debt_type TEXT NOT NULL,
				field_order INTEGER NOT NULL,
				field_name TEXT NOT NULL,
				UNIQUE(debt_type, field_order)
			)
		`);
		createDebtRecordsTable(db);
		db.prepare('INSERT INTO schema_migrations (version) VALUES (9)').run();
		return;
	}

	db.exec('DROP TABLE IF EXISTS debt_records');
	createDebtRecordsTable(db, 'debt_records_compact');
	const rows = db.prepare(`
		SELECT fv.debt_id AS debtId, fv.row_sequence AS rowSequence,
			fd.field_order AS fieldOrder, fv.display_value AS displayValue
		FROM debt_field_values fv
		JOIN debt_field_definitions fd ON fd.id = fv.field_id
		ORDER BY fv.debt_id, fv.row_sequence, fd.field_order
	`).all();
	const insert = db.prepare(`
		INSERT INTO debt_records_compact (
			debt_id, row_sequence, ${DEBT_FIELD_COLUMNS.join(', ')}
		) VALUES (${Array.from({ length: DEBT_FIELD_COLUMNS.length + 2 }, () => '?').join(', ')})
	`);
	db.transaction(() => {
		let currentKey = null;
		let current = null;
		const flush = () => {
			if (current) insert.run(current.debtId, current.rowSequence, ...current.values);
		};
		for (const row of rows) {
			if (row.fieldOrder >= DEBT_FIELD_COLUMNS.length) {
				throw new Error(`Excel 字段序号 ${row.fieldOrder} 超出 ${DEBT_FIELD_COLUMNS.length} 列上限`);
			}
			const key = `${row.debtId}:${row.rowSequence}`;
			if (key !== currentKey) {
				flush();
				currentKey = key;
				current = {
					debtId: row.debtId,
					rowSequence: row.rowSequence,
					values: Array(DEBT_FIELD_COLUMNS.length).fill(null)
				};
			}
			current.values[row.fieldOrder] = row.displayValue;
		}
		flush();
		db.exec(`
			DROP TABLE debt_field_values;
			ALTER TABLE debt_records_compact RENAME TO debt_records;
		`);
		db.prepare('INSERT INTO schema_migrations (version) VALUES (9)').run();
	})();
}

function ensureColumn(db, table, column, definition) {
	const columns = tableColumns(db, table);
	if (!columns.has(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function migrateAuditLogEntityTypes(db) {
	const schema = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'audit_logs'").get()?.sql ?? '';
	if (!schema || schema.includes("'finance_parameter'")) return;
	db.exec(`
		ALTER TABLE audit_logs RENAME TO audit_logs_legacy;
		CREATE TABLE audit_logs (
			id TEXT PRIMARY KEY,
			actor_user_id TEXT REFERENCES auth_users(id) ON DELETE SET NULL,
			actor_username TEXT,
			action TEXT NOT NULL,
			entity_type TEXT NOT NULL CHECK (entity_type IN ('project', 'sop', 'person', 'reminder_rule', 'auth', 'finance_parameter', 'debt_limit')),
			entity_id TEXT,
			summary TEXT NOT NULL,
			before_json TEXT,
			after_json TEXT,
			request_ip TEXT,
			user_agent TEXT,
			created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		);
		INSERT INTO audit_logs SELECT * FROM audit_logs_legacy;
		DROP TABLE audit_logs_legacy;
	`);
}

function migrateIdentityModel(db) {
	const authSchema = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'auth_users'").get()?.sql ?? '';
	if (!authSchema || (authSchema.includes('person_id') && authSchema.includes("'handler'") && authSchema.includes("'reviewer'"))) return;

	db.pragma('foreign_keys = OFF');
	try {
		db.transaction(() => {
			db.exec(`
				ALTER TABLE audit_logs RENAME TO audit_logs_identity_legacy;
				ALTER TABLE auth_sessions RENAME TO auth_sessions_identity_legacy;
				ALTER TABLE auth_users RENAME TO auth_users_identity_legacy;

				UPDATE people
				SET role = CASE
					WHEN lower(trim(COALESCE(role, ''))) = 'admin' OR trim(COALESCE(role, '')) = '管理员' THEN 'admin'
					WHEN lower(trim(COALESCE(role, ''))) IN ('reviewer', 'viewer')
						OR trim(COALESCE(role, '')) IN ('复核', '风险合规') THEN 'reviewer'
					ELSE 'handler'
				END,
				updated_at = CURRENT_TIMESTAMP;

				UPDATE sop_nodes
				SET default_owner_role = CASE
					WHEN lower(trim(COALESCE(default_owner_role, ''))) IN ('reviewer', 'viewer')
						OR trim(COALESCE(default_owner_role, '')) IN ('复核', '风险合规') THEN 'reviewer'
					ELSE 'handler'
				END,
				updated_at = CURRENT_TIMESTAMP
				WHERE default_owner_role IS NOT NULL AND trim(default_owner_role) != '';

				INSERT INTO people (id, name, email, role, active)
				SELECT 'person-auth-' || u.id, u.username, NULL,
					CASE WHEN u.role = 'admin' THEN 'admin' ELSE 'reviewer' END,
					u.active
				FROM auth_users_identity_legacy u
				WHERE NOT EXISTS (
					SELECT 1 FROM people p WHERE lower(p.name) = lower(u.username)
				);

				CREATE TABLE auth_users (
					id TEXT PRIMARY KEY,
					person_id TEXT NOT NULL UNIQUE REFERENCES people(id) ON DELETE CASCADE,
					username TEXT NOT NULL UNIQUE COLLATE NOCASE,
					password_hash TEXT NOT NULL,
					role TEXT NOT NULL CHECK (role IN ('admin', 'handler', 'reviewer')),
					active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
					failed_login_count INTEGER NOT NULL DEFAULT 0,
					locked_until TEXT,
					last_login_at TEXT,
					created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
					updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
				);

				INSERT INTO auth_users (
					id, person_id, username, password_hash, role, active,
					failed_login_count, locked_until, last_login_at, created_at, updated_at
				)
				SELECT u.id,
					COALESCE(
						(SELECT p.id FROM people p WHERE lower(p.name) = lower(u.username) ORDER BY p.created_at LIMIT 1),
						'person-auth-' || u.id
					),
					u.username, u.password_hash,
					CASE WHEN u.role = 'admin' THEN 'admin' ELSE 'reviewer' END,
					u.active, u.failed_login_count, u.locked_until, u.last_login_at, u.created_at, u.updated_at
				FROM auth_users_identity_legacy u;

				UPDATE people
				SET role = (
					SELECT u.role FROM auth_users u WHERE u.person_id = people.id
				),
				active = (
					SELECT u.active FROM auth_users u WHERE u.person_id = people.id
				),
				updated_at = CURRENT_TIMESTAMP
				WHERE EXISTS (SELECT 1 FROM auth_users u WHERE u.person_id = people.id);

				CREATE TABLE auth_sessions (
					id TEXT PRIMARY KEY,
					token_hash TEXT NOT NULL UNIQUE,
					user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
					expires_at TEXT NOT NULL,
					created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
					last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
				);
				INSERT INTO auth_sessions SELECT * FROM auth_sessions_identity_legacy;

				CREATE TABLE audit_logs (
					id TEXT PRIMARY KEY,
					actor_user_id TEXT REFERENCES auth_users(id) ON DELETE SET NULL,
					actor_username TEXT,
					action TEXT NOT NULL,
					entity_type TEXT NOT NULL CHECK (entity_type IN ('project', 'sop', 'person', 'reminder_rule', 'auth', 'finance_parameter', 'debt_limit')),
					entity_id TEXT,
					summary TEXT NOT NULL,
					before_json TEXT,
					after_json TEXT,
					request_ip TEXT,
					user_agent TEXT,
					created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
				);
				INSERT INTO audit_logs SELECT * FROM audit_logs_identity_legacy;

				DROP TABLE audit_logs_identity_legacy;
				DROP TABLE auth_sessions_identity_legacy;
				DROP TABLE auth_users_identity_legacy;
			`);
		})();
	} finally {
		db.pragma('foreign_keys = ON');
	}
}

export function createSchema(db) {
	db.exec(`
		PRAGMA foreign_keys = ON;
		PRAGMA journal_mode = WAL;

		CREATE TABLE IF NOT EXISTS schema_migrations (
			version INTEGER PRIMARY KEY,
			applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		);

		CREATE TABLE IF NOT EXISTS auth_users (
			id TEXT PRIMARY KEY,
			person_id TEXT NOT NULL UNIQUE REFERENCES people(id) ON DELETE CASCADE,
			username TEXT NOT NULL UNIQUE COLLATE NOCASE,
			password_hash TEXT NOT NULL,
			role TEXT NOT NULL CHECK (role IN ('admin', 'handler', 'reviewer')),
			active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
			failed_login_count INTEGER NOT NULL DEFAULT 0,
			locked_until TEXT,
			last_login_at TEXT,
			avatar_data_url TEXT,
			created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		);

		CREATE TABLE IF NOT EXISTS auth_sessions (
			id TEXT PRIMARY KEY,
			token_hash TEXT NOT NULL UNIQUE,
			user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
			expires_at TEXT NOT NULL,
			created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		);

		CREATE TABLE IF NOT EXISTS audit_logs (
			id TEXT PRIMARY KEY,
			actor_user_id TEXT REFERENCES auth_users(id) ON DELETE SET NULL,
			actor_username TEXT,
			action TEXT NOT NULL,
			entity_type TEXT NOT NULL CHECK (entity_type IN ('project', 'sop', 'person', 'reminder_rule', 'auth', 'finance_parameter', 'debt_limit')),
			entity_id TEXT,
			summary TEXT NOT NULL,
			before_json TEXT,
			after_json TEXT,
			request_ip TEXT,
			user_agent TEXT,
			created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		);

		CREATE TABLE IF NOT EXISTS people (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			email TEXT,
			role TEXT,
			active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
			created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(name)
		);

		CREATE TABLE IF NOT EXISTS sop_templates (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			debt_type TEXT NOT NULL,
			description TEXT,
			is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
			created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(name, debt_type)
		);

		CREATE TABLE IF NOT EXISTS sop_nodes (
			id TEXT PRIMARY KEY,
			template_id TEXT NOT NULL REFERENCES sop_templates(id) ON DELETE CASCADE,
			name TEXT NOT NULL,
			description TEXT,
			sort_order INTEGER NOT NULL,
			default_offset_days INTEGER NOT NULL DEFAULT 0,
			default_owner_role TEXT,
			created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(template_id, sort_order)
		);

		CREATE TABLE IF NOT EXISTS projects (
			id TEXT PRIMARY KEY,
			code TEXT NOT NULL UNIQUE,
			name TEXT NOT NULL,
			debt_type TEXT NOT NULL,
			borrower TEXT,
			amount REAL,
			currency TEXT NOT NULL DEFAULT 'CNY',
			status TEXT NOT NULL DEFAULT 'planning' CHECK (status IN ('planning', 'in_progress', 'at_risk', 'completed', 'cancelled')),
			planned_start_date TEXT,
			planned_issue_date TEXT,
			planned_maturity_date TEXT,
			sop_template_id TEXT REFERENCES sop_templates(id) ON DELETE SET NULL,
			owner_id TEXT REFERENCES people(id) ON DELETE SET NULL,
			notes TEXT,
			created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		);

		CREATE TABLE IF NOT EXISTS project_tasks (
			id TEXT PRIMARY KEY,
			project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
			sop_node_id TEXT REFERENCES sop_nodes(id) ON DELETE SET NULL,
			name TEXT NOT NULL,
			status TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started', 'in_progress', 'blocked', 'completed')),
			assignee_id TEXT REFERENCES people(id) ON DELETE SET NULL,
			planned_start_date TEXT,
			due_date TEXT,
			completed_at TEXT,
			sort_order INTEGER NOT NULL DEFAULT 0,
			notes TEXT,
			created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		);

		CREATE TABLE IF NOT EXISTS debts (
			id TEXT PRIMARY KEY,
			external_key TEXT NOT NULL UNIQUE,
			project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
			debt_type TEXT NOT NULL,
			category_level_1 TEXT,
			category_level_2 TEXT,
			instrument_name TEXT,
			instrument_code TEXT,
			borrower TEXT,
			counterparty TEXT,
			principal_amount REAL,
			outstanding_amount REAL,
			currency TEXT NOT NULL DEFAULT 'CNY',
			annual_rate REAL,
			issue_date TEXT,
			maturity_date TEXT,
			status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'matured', 'planned', 'closed')),
			import_marker TEXT,
			imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		);

		CREATE TABLE IF NOT EXISTS debt_balance_daily (
			as_of_date TEXT NOT NULL,
			debt_type TEXT NOT NULL,
			balance_yi REAL NOT NULL,
			created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (as_of_date, debt_type)
		);

		CREATE TABLE IF NOT EXISTS debt_cashflow_events (
			event_key TEXT PRIMARY KEY,
			debt_id TEXT NOT NULL REFERENCES debts(id) ON DELETE CASCADE,
			event_type TEXT NOT NULL CHECK (event_type IN ('interest', 'principal')),
			event_date TEXT NOT NULL,
			amount REAL,
			sequence INTEGER NOT NULL DEFAULT 0,
			created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		);

		CREATE TABLE IF NOT EXISTS reminder_rules (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			target_type TEXT NOT NULL DEFAULT 'project_task' CHECK (target_type IN ('project_task', 'project', 'debt')),
			debt_type TEXT,
			trigger_field TEXT NOT NULL,
			offset_days INTEGER NOT NULL DEFAULT 1,
			frequency TEXT NOT NULL DEFAULT 'once' CHECK (frequency IN ('once', 'daily', 'weekly')),
			channel TEXT NOT NULL DEFAULT 'email' CHECK (channel IN ('email')),
			recipient_mode TEXT NOT NULL DEFAULT 'assignee' CHECK (recipient_mode IN ('assignee', 'owner', 'custom')),
			recipients TEXT,
			is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
			created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		);

		CREATE TABLE IF NOT EXISTS reminder_deliveries (
			id TEXT PRIMARY KEY,
			rule_id TEXT NOT NULL REFERENCES reminder_rules(id) ON DELETE CASCADE,
			target_type TEXT NOT NULL,
			target_id TEXT NOT NULL,
			delivery_date TEXT NOT NULL,
			recipients TEXT NOT NULL,
			status TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'failed')),
			provider_message_id TEXT,
			error_message TEXT,
			created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			sent_at TEXT,
			UNIQUE(rule_id, target_id, delivery_date)
		);

		CREATE TABLE IF NOT EXISTS data_import_state (
			id INTEGER PRIMARY KEY CHECK (id = 1),
			workbook_name TEXT NOT NULL,
			workbook_hash TEXT NOT NULL,
			as_of_date TEXT NOT NULL,
			status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
			started_at TEXT NOT NULL,
			finished_at TEXT,
			inserted_count INTEGER NOT NULL DEFAULT 0,
			updated_count INTEGER NOT NULL DEFAULT 0,
			deleted_count INTEGER NOT NULL DEFAULT 0,
			debt_count INTEGER NOT NULL DEFAULT 0,
			field_value_count INTEGER NOT NULL DEFAULT 0,
			cashflow_count INTEGER NOT NULL DEFAULT 0,
			history_date_count INTEGER NOT NULL DEFAULT 0,
			excluded_future_count INTEGER NOT NULL DEFAULT 0,
			error_message TEXT
		);

		CREATE TABLE IF NOT EXISTS debt_type_catalog (
			code TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			parent_code TEXT REFERENCES debt_type_catalog(code) ON DELETE RESTRICT,
			compact_name TEXT,
			display_name TEXT NOT NULL,
			sort_order INTEGER NOT NULL DEFAULT 0,
			is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
			created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(parent_code, name)
		);

		CREATE TABLE IF NOT EXISTS finance_parameters (
			code TEXT PRIMARY KEY,
			label TEXT NOT NULL,
			value_yi REAL,
			period_end TEXT,
			notes TEXT,
			created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		);

		CREATE TABLE IF NOT EXISTS debt_limit_configs (
			debt_type TEXT PRIMARY KEY,
			limit_yi REAL NOT NULL CHECK (limit_yi >= 0),
			usage_basis TEXT NOT NULL DEFAULT 'outstanding' CHECK (usage_basis IN ('outstanding', 'since_approval')),
			approved_date TEXT,
			expiry_date TEXT,
			calculation_mode TEXT NOT NULL DEFAULT 'manual' CHECK (calculation_mode IN ('manual', 'net_capital_60')),
			sort_order INTEGER NOT NULL DEFAULT 0,
			created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		);

		CREATE INDEX IF NOT EXISTS idx_projects_status_type ON projects(status, debt_type);
		CREATE INDEX IF NOT EXISTS idx_project_tasks_project_due ON project_tasks(project_id, due_date);
		CREATE INDEX IF NOT EXISTS idx_reminder_rules_active ON reminder_rules(is_active, target_type);
		CREATE INDEX IF NOT EXISTS idx_reminder_deliveries_status ON reminder_deliveries(status, delivery_date);
		CREATE INDEX IF NOT EXISTS idx_auth_sessions_expiry ON auth_sessions(expires_at);
		CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id, created_at);
		CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor_user_id, created_at);
	`);

	migrateCompactImportedData(db);
	migrateStableDebtKeys(db);
	migrateWideDebtFields(db);
	migrateTypedDebtDetails(db);
	ensureColumn(db, 'debts', 'category_level_1', 'TEXT');
	ensureColumn(db, 'debts', 'category_level_2', 'TEXT');
	ensureColumn(db, 'debts', 'import_marker', 'TEXT');
	migrateIdentityModel(db);
	ensureColumn(db, 'auth_users', 'avatar_data_url', 'TEXT');
	migrateAuditLogEntityTypes(db);
	db.exec(`
		CREATE INDEX IF NOT EXISTS idx_debts_type_status ON debts(debt_type, status);
		CREATE INDEX IF NOT EXISTS idx_debts_maturity ON debts(maturity_date);
		CREATE INDEX IF NOT EXISTS idx_debt_balance_daily_date ON debt_balance_daily(as_of_date);
		CREATE INDEX IF NOT EXISTS idx_debt_cashflow_events_date ON debt_cashflow_events(event_date, event_type);
		CREATE INDEX IF NOT EXISTS idx_debt_cashflow_events_debt ON debt_cashflow_events(debt_id, event_date);
		CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id, created_at);
		CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor_user_id, created_at);
		CREATE INDEX IF NOT EXISTS idx_debts_categories ON debts(category_level_1, category_level_2, status);
		CREATE INDEX IF NOT EXISTS idx_auth_users_person ON auth_users(person_id);
	`);

	db.prepare('INSERT OR IGNORE INTO schema_migrations (version) VALUES (?)').run(schemaVersion);
}
