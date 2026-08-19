CREATE TABLE debt_import_upload (
			id INTEGER PRIMARY KEY CHECK (id = 1),
			upload_token TEXT NOT NULL,
			workbook_name TEXT NOT NULL,
			workbook_hash TEXT NOT NULL,
			as_of_date TEXT NOT NULL,
			debt_count INTEGER NOT NULL,
			field_value_count INTEGER NOT NULL,
			cashflow_count INTEGER NOT NULL,
			history_date_count INTEGER NOT NULL,
			excluded_future_count INTEGER NOT NULL,
			started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		) STRICT;
CREATE TABLE debt_import_staging (
			external_key TEXT PRIMARY KEY,
			debt_type TEXT NOT NULL,
			category_level_1 TEXT,
			category_level_2 TEXT,
			instrument_name TEXT,
			instrument_code TEXT,
			borrower TEXT,
			counterparty TEXT,
			principal_amount REAL,
			outstanding_amount REAL,
			currency TEXT NOT NULL,
			annual_rate REAL,
			issue_date TEXT,
			maturity_date TEXT,
			status TEXT NOT NULL
		) STRICT;
CREATE TABLE bond_details_staging (
			external_key TEXT PRIMARY KEY, short_name TEXT, issuance_method TEXT,
			bookbuilding_date TEXT, issuance_start_date TEXT, term_days INTEGER,
			interest_basis TEXT, issuance_target TEXT, market TEXT, receiving_account TEXT,
			trustee TEXT, bookrunner TEXT, stated_interest_amount REAL,
			stated_redemption_amount REAL, remaining_principal_amount REAL
		) STRICT;
CREATE TABLE bond_schedules_staging (
			external_key TEXT NOT NULL, sequence INTEGER NOT NULL, payment_date TEXT,
			principal_amount REAL, interest_amount REAL, redemption_amount REAL,
			remaining_principal_amount REAL, PRIMARY KEY (external_key, sequence)
		) STRICT;
CREATE TABLE income_certificate_staging (
			external_key TEXT PRIMARY KEY, issuance_status TEXT, liquidation_submission_status TEXT,
			liquidation_registration_status TEXT, series_name TEXT, term_label TEXT, return_type TEXT,
			investor_type TEXT, term_days INTEGER, interest_amount REAL, liquidation_amount REAL,
			subscription_date TEXT, redemption_date TEXT, receiving_account TEXT, is_early_maturity TEXT
		) STRICT;
CREATE TABLE income_right_staging (
			external_key TEXT PRIMARY KEY, period_label TEXT, term_days INTEGER,
			interest_basis_days INTEGER, stated_interest_amount REAL
		) STRICT;
CREATE TABLE income_right_schedules_staging (
			external_key TEXT NOT NULL, sequence INTEGER NOT NULL, payment_date TEXT,
			interest_amount REAL, PRIMARY KEY (external_key, sequence)
		) STRICT;
CREATE TABLE interbank_staging (
			external_key TEXT PRIMARY KEY, term_days INTEGER, interest_amount REAL, repayment_amount REAL
		) STRICT;
CREATE TABLE refinancing_staging (
			external_key TEXT PRIMARY KEY, term_days INTEGER, interest_basis_days INTEGER,
			interest_amount REAL, repayment_amount REAL, market TEXT, is_extended TEXT,
			receiving_account TEXT, repayment_account TEXT
		) STRICT;
CREATE TABLE group_loan_staging (
			external_key TEXT PRIMARY KEY, lender_name TEXT
		) STRICT;
CREATE TABLE group_loan_schedules_staging (
			external_key TEXT NOT NULL, sequence INTEGER NOT NULL, accrual_end_date TEXT,
			accrued_interest_amount REAL, payment_date TEXT, paid_interest_amount REAL,
			principal_repayment_amount REAL, remaining_principal_amount REAL,
			supplemental_date TEXT, supplemental_note TEXT, supplemental_amount REAL,
			PRIMARY KEY (external_key, sequence)
		) STRICT;
CREATE TABLE swap_staging (
			external_key TEXT PRIMARY KEY, sequence_number INTEGER, first_repo_date TEXT,
			average_repo_balance_description TEXT, repo_weighted_average_rate REAL,
			comprehensive_financing_rate REAL
		) STRICT;
CREATE TABLE cashflow_staging (
			event_key TEXT PRIMARY KEY, external_key TEXT NOT NULL, event_type TEXT NOT NULL,
			event_date TEXT NOT NULL, amount REAL, sequence INTEGER NOT NULL
		) STRICT;
CREATE TABLE balance_staging (
			as_of_date TEXT NOT NULL, debt_type TEXT NOT NULL, balance_yi REAL NOT NULL,
			PRIMARY KEY (as_of_date, debt_type)
		) STRICT;
CREATE TABLE workbook_notes_staging (
			sheet_name TEXT PRIMARY KEY, content TEXT NOT NULL
		) STRICT;
