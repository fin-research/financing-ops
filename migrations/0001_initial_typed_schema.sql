CREATE TABLE schema_migrations (
			version INTEGER PRIMARY KEY,
			applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		);
CREATE TABLE people (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			email TEXT,
			role TEXT,
			active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
			created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(name)
		);
CREATE TABLE sop_templates (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			debt_type TEXT NOT NULL,
			description TEXT,
			is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
			created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(name, debt_type)
		);
CREATE TABLE sop_nodes (
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
CREATE TABLE projects (
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
CREATE TABLE project_tasks (
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
CREATE TABLE reminder_rules (
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
CREATE TABLE reminder_deliveries (
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
CREATE TABLE debt_type_catalog (
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
CREATE TABLE finance_parameters (
			code TEXT PRIMARY KEY,
			label TEXT NOT NULL,
			value_yi REAL,
			period_end TEXT,
			notes TEXT,
			created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		);
CREATE TABLE debt_limit_configs (
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
				, avatar_data_url TEXT);
CREATE TABLE auth_sessions (
					id TEXT PRIMARY KEY,
					token_hash TEXT NOT NULL UNIQUE,
					user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
					expires_at TEXT NOT NULL,
					created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
					last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
				);
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
CREATE TABLE IF NOT EXISTS "debts" (
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
CREATE TABLE IF NOT EXISTS "debt_cashflow_events" (
					event_key TEXT PRIMARY KEY,
					debt_id TEXT NOT NULL REFERENCES "debts"(id) ON DELETE CASCADE,
					event_type TEXT NOT NULL CHECK (event_type IN ('interest', 'principal')),
					event_date TEXT NOT NULL,
					amount REAL,
					sequence INTEGER NOT NULL DEFAULT 0,
					created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
					updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
				);
CREATE TABLE IF NOT EXISTS "debt_balance_daily" (
					as_of_date TEXT NOT NULL,
					debt_type TEXT NOT NULL,
					balance_yi REAL NOT NULL,
					created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
					updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
					PRIMARY KEY (as_of_date, debt_type)
				);
CREATE TABLE IF NOT EXISTS "data_import_state" (
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
CREATE TABLE bond_debt_details (
			debt_id TEXT PRIMARY KEY REFERENCES debts(id) ON DELETE CASCADE,
			short_name TEXT,
			issuance_method TEXT,
			bookbuilding_date TEXT,
			issuance_start_date TEXT,
			term_days INTEGER,
			interest_basis TEXT,
			issuance_target TEXT,
			market TEXT,
			receiving_account TEXT,
			trustee TEXT,
			bookrunner TEXT,
			stated_interest_amount REAL,
			stated_redemption_amount REAL,
			remaining_principal_amount REAL
		) STRICT;
CREATE TABLE bond_payment_schedules (
			debt_id TEXT NOT NULL REFERENCES bond_debt_details(debt_id) ON DELETE CASCADE,
			sequence INTEGER NOT NULL,
			payment_date TEXT,
			principal_amount REAL,
			interest_amount REAL,
			redemption_amount REAL,
			remaining_principal_amount REAL,
			PRIMARY KEY (debt_id, sequence)
		) STRICT;
CREATE TABLE income_certificate_details (
			debt_id TEXT PRIMARY KEY REFERENCES debts(id) ON DELETE CASCADE,
			issuance_status TEXT,
			liquidation_submission_status TEXT,
			liquidation_registration_status TEXT,
			series_name TEXT,
			term_label TEXT,
			return_type TEXT,
			investor_type TEXT,
			term_days INTEGER,
			interest_amount REAL,
			liquidation_amount REAL,
			subscription_date TEXT,
			redemption_date TEXT,
			receiving_account TEXT,
			is_early_maturity TEXT
		) STRICT;
CREATE TABLE income_right_details (
			debt_id TEXT PRIMARY KEY REFERENCES debts(id) ON DELETE CASCADE,
			period_label TEXT,
			term_days INTEGER,
			interest_basis_days INTEGER,
			stated_interest_amount REAL
		) STRICT;
CREATE TABLE income_right_payment_schedules (
			debt_id TEXT NOT NULL REFERENCES income_right_details(debt_id) ON DELETE CASCADE,
			sequence INTEGER NOT NULL,
			payment_date TEXT,
			interest_amount REAL,
			PRIMARY KEY (debt_id, sequence)
		) STRICT;
CREATE TABLE interbank_borrowing_details (
			debt_id TEXT PRIMARY KEY REFERENCES debts(id) ON DELETE CASCADE,
			term_days INTEGER,
			interest_amount REAL,
			repayment_amount REAL
		) STRICT;
CREATE TABLE refinancing_details (
			debt_id TEXT PRIMARY KEY REFERENCES debts(id) ON DELETE CASCADE,
			term_days INTEGER,
			interest_basis_days INTEGER,
			interest_amount REAL,
			repayment_amount REAL,
			market TEXT,
			is_extended TEXT,
			receiving_account TEXT,
			repayment_account TEXT
		) STRICT;
CREATE TABLE group_loan_details (
			debt_id TEXT PRIMARY KEY REFERENCES debts(id) ON DELETE CASCADE,
			lender_name TEXT
		) STRICT;
CREATE TABLE group_loan_schedules (
			debt_id TEXT NOT NULL REFERENCES group_loan_details(debt_id) ON DELETE CASCADE,
			sequence INTEGER NOT NULL,
			accrual_end_date TEXT,
			accrued_interest_amount REAL,
			payment_date TEXT,
			paid_interest_amount REAL,
			principal_repayment_amount REAL,
			remaining_principal_amount REAL,
			supplemental_date TEXT,
			supplemental_note TEXT,
			supplemental_amount REAL,
			PRIMARY KEY (debt_id, sequence)
		) STRICT;
CREATE TABLE swap_facility_details (
			debt_id TEXT PRIMARY KEY REFERENCES debts(id) ON DELETE CASCADE,
			sequence_number INTEGER,
			first_repo_date TEXT,
			average_repo_balance_description TEXT,
			repo_weighted_average_rate REAL,
			comprehensive_financing_rate REAL
		) STRICT;
CREATE TABLE workbook_notes (
			sheet_name TEXT PRIMARY KEY,
			content TEXT NOT NULL
		) STRICT;
CREATE INDEX idx_projects_status_type ON projects(status, debt_type);
CREATE INDEX idx_project_tasks_project_due ON project_tasks(project_id, due_date);
CREATE INDEX idx_reminder_rules_active ON reminder_rules(is_active, target_type);
CREATE INDEX idx_reminder_deliveries_status ON reminder_deliveries(status, delivery_date);
CREATE INDEX idx_audit_logs_entity ON audit_logs(entity_type, entity_id, created_at);
CREATE INDEX idx_audit_logs_actor ON audit_logs(actor_user_id, created_at);
CREATE INDEX idx_auth_users_person ON auth_users(person_id);
CREATE INDEX idx_auth_sessions_expiry ON auth_sessions(expires_at);
CREATE INDEX idx_debts_type_status ON debts(debt_type, status);
CREATE INDEX idx_debts_maturity ON debts(maturity_date);
CREATE INDEX idx_debt_balance_daily_date ON debt_balance_daily(as_of_date);
CREATE INDEX idx_debt_cashflow_events_date ON debt_cashflow_events(event_date, event_type);
CREATE INDEX idx_debt_cashflow_events_debt ON debt_cashflow_events(debt_id, event_date);
CREATE INDEX idx_debts_categories ON debts(category_level_1, category_level_2, status);
CREATE TRIGGER validate_bond_debt_type
		BEFORE INSERT ON bond_debt_details
		WHEN (SELECT debt_type FROM debts WHERE id = NEW.debt_id)
			NOT IN ('小公募', '私募债', '次级债', '短期融资券', '科创债', '公司债')
		BEGIN SELECT RAISE(ABORT, 'bond_debt_details debt_type mismatch'); END;
CREATE TRIGGER validate_income_certificate_debt_type
		BEFORE INSERT ON income_certificate_details
		WHEN (SELECT debt_type FROM debts WHERE id = NEW.debt_id) <> '收益凭证'
		BEGIN SELECT RAISE(ABORT, 'income_certificate_details debt_type mismatch'); END;
CREATE TRIGGER validate_income_right_debt_type
		BEFORE INSERT ON income_right_details
		WHEN (SELECT debt_type FROM debts WHERE id = NEW.debt_id) <> '收益权转让'
		BEGIN SELECT RAISE(ABORT, 'income_right_details debt_type mismatch'); END;
CREATE TRIGGER validate_interbank_debt_type
		BEFORE INSERT ON interbank_borrowing_details
		WHEN (SELECT debt_type FROM debts WHERE id = NEW.debt_id) <> '同业拆借'
		BEGIN SELECT RAISE(ABORT, 'interbank_borrowing_details debt_type mismatch'); END;
CREATE TRIGGER validate_refinancing_debt_type
		BEFORE INSERT ON refinancing_details
		WHEN (SELECT debt_type FROM debts WHERE id = NEW.debt_id) <> '转融资'
		BEGIN SELECT RAISE(ABORT, 'refinancing_details debt_type mismatch'); END;
CREATE TRIGGER validate_group_loan_debt_type
		BEFORE INSERT ON group_loan_details
		WHEN (SELECT debt_type FROM debts WHERE id = NEW.debt_id) <> '集团借款'
		BEGIN SELECT RAISE(ABORT, 'group_loan_details debt_type mismatch'); END;
CREATE TRIGGER validate_swap_facility_debt_type
		BEFORE INSERT ON swap_facility_details
		WHEN (SELECT debt_type FROM debts WHERE id = NEW.debt_id) <> '互换便利'
		BEGIN SELECT RAISE(ABORT, 'swap_facility_details debt_type mismatch'); END;
