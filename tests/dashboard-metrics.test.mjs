import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import {
	SHORT_DEBT_MAX_ORIGINAL_TERM_DAYS,
	currentYearBorrowingPredicateSql,
	reportingTypeSql,
	shortDebtPredicateSql
} from '../src/lib/server/dashboard-metrics.js';

test('short debt uses original issuance term and only the three business instrument groups', async (t) => {
	const db = new PGlite();
	t.after(() => db.close());
	await db.exec(`
		CREATE TABLE debt (
			debt_type text NOT NULL,
			subtype text,
			amount numeric NOT NULL,
			issue_date date,
			maturity_date date,
			term_days integer
		);
		INSERT INTO debt VALUES
			('收益凭证', '浮动收益凭证', 10, '2025-08-22', '2026-08-22', 365),
			('收益凭证', '浮动收益凭证', 20, '2025-08-21', '2026-08-22', 366),
			('收益凭证', '固定收益凭证', 30, '2025-08-22', '2026-08-22', 365),
			('收益凭证', '固定收益凭证', 40, '2025-08-21', '2026-08-23', 367),
			('债券', '短期融资券', 50, '2024-01-01', NULL, NULL),
			('同业拆借', NULL, 70, '2026-08-01', NULL, NULL),
			('债券', '小公募', 60, '2023-01-01', '2026-12-31', 1460),
			('集团借款', NULL, 80, '2026-01-01', '2026-12-31', 364),
			('收益凭证', '固定收益凭证', 90, '2025-08-20', '2026-08-20', 365),
			('同业拆借', NULL, 100, '2026-08-22', '2026-08-23', 1);
	`);
	const result = await db.query(`
		WITH latest(as_of_date) AS (VALUES (DATE '2026-08-21')),
		current_debt AS (
			SELECT d.* FROM debt d CROSS JOIN latest
			WHERE (d.issue_date IS NULL OR d.issue_date <= latest.as_of_date)
				AND (d.maturity_date IS NULL OR d.maturity_date > latest.as_of_date)
		)
		SELECT COALESCE(SUM(d.amount) FILTER (WHERE ${shortDebtPredicateSql('d')}), 0) AS amount
		FROM current_debt d
	`);

	assert.equal(SHORT_DEBT_MAX_ORIGINAL_TERM_DAYS, 365);
	assert.equal(reportingTypeSql('d'), "COALESCE(NULLIF(d.subtype, ''), d.debt_type)");
	assert.equal(Number(result.rows[0].amount), 160);
});

test('largest new borrowing only considers issues from the as-of calendar year', async (t) => {
	const db = new PGlite();
	t.after(() => db.close());
	await db.exec(`
		CREATE TABLE debt (amount numeric NOT NULL, issue_date date);
		INSERT INTO debt VALUES
			(57.8, '2025-12-31'),
			(30, '2026-01-01'),
			(40, '2026-08-20'),
			(100, '2026-08-22'),
			(200, NULL);
	`);
	const result = await db.query(`
		WITH latest(as_of_date) AS (VALUES (DATE '2026-08-21'))
		SELECT COALESCE(MAX(d.amount) FILTER (
			WHERE ${currentYearBorrowingPredicateSql('d', 'latest.as_of_date')}
		), 0) AS amount
		FROM debt d CROSS JOIN latest
	`);

	assert.equal(Number(result.rows[0].amount), 40);
});
