ALTER TABLE data_import_state ADD COLUMN snapshot_total_yi REAL;
ALTER TABLE data_import_state ADD COLUMN history_start_date TEXT;
ALTER TABLE data_import_state ADD COLUMN history_end_date TEXT;
ALTER TABLE data_import_state ADD COLUMN stats_refreshed_at TEXT;

CREATE INDEX IF NOT EXISTS idx_debts_issue_date_status
	ON debts(issue_date, status, debt_type, principal_amount);
