// @ts-nocheck
const schemaVersion = 6;

function ensureColumn(db, table, column, definition) {
	const columns = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((item) => item.name));
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
			source_sheet TEXT NOT NULL,
			source_row INTEGER NOT NULL,
			source_file TEXT NOT NULL,
			raw_data TEXT NOT NULL,
			imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(source_sheet, source_row)
		);

		CREATE TABLE IF NOT EXISTS debt_balance_daily (
			as_of_date TEXT NOT NULL,
			debt_type TEXT NOT NULL,
			balance_yi REAL NOT NULL,
			source_sheet TEXT NOT NULL,
			source_cell TEXT NOT NULL,
			source_file TEXT,
			created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(as_of_date, debt_type)
		);

		CREATE TABLE IF NOT EXISTS debt_balance_history (
			id TEXT PRIMARY KEY,
			source_file TEXT NOT NULL,
			as_of_date TEXT NOT NULL,
			debt_type TEXT NOT NULL,
			balance_yi REAL NOT NULL,
			source_sheet TEXT NOT NULL,
			source_cell TEXT NOT NULL,
			source_sequence INTEGER NOT NULL,
			created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(source_file, source_sheet, source_cell)
		);

		CREATE TABLE IF NOT EXISTS debt_source_rows (
			id TEXT PRIMARY KEY,
			source_file TEXT NOT NULL,
			source_sheet TEXT NOT NULL,
			source_row INTEGER NOT NULL,
			record_kind TEXT NOT NULL CHECK (record_kind IN ('detail', 'continuation', 'summary')),
			parent_external_key TEXT,
			row_data TEXT NOT NULL,
			created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(source_file, source_sheet, source_row)
		);

		CREATE TABLE IF NOT EXISTS debt_cashflow_events (
			id TEXT PRIMARY KEY,
			event_key TEXT NOT NULL UNIQUE,
			debt_external_key TEXT,
			event_type TEXT NOT NULL CHECK (event_type IN ('interest', 'principal')),
			event_date TEXT NOT NULL,
			amount REAL,
			source_file TEXT NOT NULL,
			source_sheet TEXT NOT NULL,
			source_row INTEGER NOT NULL,
			source_date_cell TEXT NOT NULL,
			source_amount_cell TEXT,
			raw_data TEXT NOT NULL,
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

		CREATE TABLE IF NOT EXISTS import_runs (
			id TEXT PRIMARY KEY,
			source_file TEXT NOT NULL,
			file_hash TEXT NOT NULL,
			status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
			started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			finished_at TEXT,
			inserted_count INTEGER NOT NULL DEFAULT 0,
			updated_count INTEGER NOT NULL DEFAULT 0,
			skipped_count INTEGER NOT NULL DEFAULT 0,
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

		CREATE INDEX IF NOT EXISTS idx_debts_type_status ON debts(debt_type, status);
		CREATE INDEX IF NOT EXISTS idx_debts_maturity ON debts(maturity_date);
		CREATE INDEX IF NOT EXISTS idx_debt_balance_daily_date ON debt_balance_daily(as_of_date);
		CREATE INDEX IF NOT EXISTS idx_debt_balance_history_date ON debt_balance_history(as_of_date, source_sequence);
		CREATE INDEX IF NOT EXISTS idx_debt_source_rows_source ON debt_source_rows(source_file, source_sheet, source_row);
		CREATE INDEX IF NOT EXISTS idx_debt_cashflow_events_date ON debt_cashflow_events(event_date, event_type);
		CREATE INDEX IF NOT EXISTS idx_debt_cashflow_events_debt ON debt_cashflow_events(debt_external_key);
		CREATE INDEX IF NOT EXISTS idx_projects_status_type ON projects(status, debt_type);
		CREATE INDEX IF NOT EXISTS idx_project_tasks_project_due ON project_tasks(project_id, due_date);
		CREATE INDEX IF NOT EXISTS idx_reminder_rules_active ON reminder_rules(is_active, target_type);
		CREATE INDEX IF NOT EXISTS idx_reminder_deliveries_status ON reminder_deliveries(status, delivery_date);
		CREATE INDEX IF NOT EXISTS idx_auth_sessions_expiry ON auth_sessions(expires_at);
		CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id, created_at);
		CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor_user_id, created_at);
	`);

	ensureColumn(db, 'debt_balance_daily', 'source_file', 'TEXT');
	ensureColumn(db, 'debts', 'category_level_1', 'TEXT');
	ensureColumn(db, 'debts', 'category_level_2', 'TEXT');
	migrateIdentityModel(db);
	ensureColumn(db, 'auth_users', 'avatar_data_url', 'TEXT');
	migrateAuditLogEntityTypes(db);
	db.exec(`
		CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id, created_at);
		CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor_user_id, created_at);
		CREATE INDEX IF NOT EXISTS idx_debts_categories ON debts(category_level_1, category_level_2, status);
		CREATE INDEX IF NOT EXISTS idx_auth_users_person ON auth_users(person_id);
	`);

	db.prepare('INSERT OR IGNORE INTO schema_migrations (version) VALUES (?)').run(schemaVersion);
}
