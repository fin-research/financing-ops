// @ts-nocheck
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Client } from 'pg';
import * as XLSX from 'xlsx/xlsx.mjs';

const DEFAULT_ROOT = path.resolve('../eastmoney/负债周报自动化安装包_20260901/底稿');
const root = path.resolve(process.argv.find((value) => value.startsWith('--root='))?.slice(7) ?? DEFAULT_ROOT);
const dryRun = process.argv.includes('--dry-run');
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl && !dryRun) throw new Error('缺少 DATABASE_URL；生产数据导入必须从本地直连 Neon');

const files = {
	credit1: '【每周五替换】利率看板底稿/AAA-券商与国债信用利差(1年）.xlsx',
	credit3: '【每周五替换】利率看板底稿/AAA-券商与国债信用利差(3年）.xlsx',
	credit5: '【每周五替换】利率看板底稿/AAA-券商与国债信用利差(5年）.xlsx',
	ncd: '【每周五替换】利率看板底稿/国有行存单发行利率.xlsx',
	chinaBond: '【每周五替换】利率看板底稿/中债证券公司债到期收益率(AAA-).xlsx',
	peer: '【每周五替换】可比券商底稿/债券发行明细.xlsx',
	registration: '【每周五替换】可比券商底稿/项目注册进程2026-08-28.xlsx',
	netCapital: '【每月初替换】负债测算/净资本数据.xlsx',
	liability: '【每月初替换】负债测算/负债测算2026.7.xlsx'
};

function full(relative) { return path.join(root, relative); }
function text(value) {
	if (value === null || value === undefined) return null;
	const result = String(value).trim();
	return result && !['-', '—', 'null', 'undefined'].includes(result) ? result : null;
}
function number(value) {
	if (typeof value === 'number') return Number.isFinite(value) ? value : null;
	const result = Number(text(value)?.replace(/[,%，％\s]/g, ''));
	return Number.isFinite(result) ? result : null;
}
function date(value) {
	if (value instanceof Date) return value.toISOString().slice(0, 10);
	const raw = text(value);
	if (!raw) return null;
	const match = raw.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
	if (!match) return null;
	return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
}
function sha(value) { return createHash('sha256').update(value).digest('hex'); }
function readRows(relative, sheetName) {
	const workbook = XLSX.read(fs.readFileSync(full(relative)), { type: 'buffer', cellDates: true });
	const sheet = workbook.Sheets[sheetName ?? workbook.SheetNames[0]];
	if (!sheet) throw new Error(`找不到工作表：${relative} / ${sheetName}`);
	return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });
}

function parseMarketFile(relative, category) {
	const rows = readRows(relative, '指标');
	const ids = rows[2] ?? [];
	const names = rows[1] ?? rows[0] ?? [];
	const observations = [];
	for (let rowIndex = 10; rowIndex < rows.length; rowIndex += 1) {
		const observationDate = date(rows[rowIndex]?.[1]);
		if (!observationDate) continue;
		for (let column = 2; column < ids.length; column += 1) {
			const value = number(rows[rowIndex]?.[column]);
			const seriesId = text(ids[column]);
			if (!seriesId || value === null) continue;
			observations.push({
				seriesId, seriesName: text(names[column]) ?? seriesId, category,
				tenor: text(names[column])?.match(/(\d+年|\d+个月|\d+月)/)?.[1] ?? null,
				observationDate, value, source: relative, sourceReference: `${relative}!${rowIndex + 1}`
			});
		}
	}
	return observations;
}

function parsePeerFile(relative) {
	const rows = readRows(relative, '债券发行明细');
	const parsed = rows.slice(1).flatMap((row, index) => {
		const code = text(row[1]);
		const bondName = text(row[2]);
		if (!bondName) return [];
		const issueDate = date(row[5]);
		const identity = [code, issueDate, bondName, text(row[3]), index + 2].join('|');
		return [{
			id: sha(identity), securityCode: code, bondName, issuerName: text(row[3]), companyNature: text(row[4]),
			issueDate, paymentDate: date(row[6]), bondType: text(row[7]),
			actualIssueAmountYi: number(row[8]), issueAmountUpperYi: number(row[9]), planIssueAmountYi: number(row[10]),
			issueTenor: text(row[11]), interestStartDate: date(row[12]), issueNoticeDate: date(row[13]),
			issueEndDate: date(row[14]), maturityDate: date(row[15]), listedDate: date(row[16]),
			market: text(row[17]), couponRatePct: number(row[23]), source: relative, sourceRowNumber: index + 2
		}];
	});
	const unique = new Map();
	for (const row of parsed) unique.set([row.securityCode ?? '', row.issueDate ?? '', row.bondName].join('|'), row);
	return [...unique.values()];
}

function parseRegistrationFile(relative) {
	const rows = readRows(relative, '项目注册进程');
	const parsed = rows.slice(1).flatMap((row, index) => {
		const projectName = text(row[0]);
		const updateDate = date(row[10]);
		if (!projectName || !updateDate) return [];
		const values = row.slice(0, 12).map(text);
		return [{
			id: sha([projectName, values[2], updateDate, values[11] ?? '', index + 2].join('|')),
			projectName, issuerName: values[1], status: values[2], variety: values[3], amountYi: number(row[4]),
			region: values[5], industry: values[6], leadUnderwriter: values[7], venue: values[8],
			registrationOrFiling: values[9], updateDate, noticeNumber: values[11], source: relative, sourceRowNumber: index + 2
		}];
	});
	const unique = new Map();
	for (const row of parsed) unique.set([row.projectName, row.status, row.updateDate, row.noticeNumber ?? ''].join('|'), row);
	return [...unique.values()];
}

function findLabelValue(rows, patterns) {
	for (const row of rows) {
		for (let column = 0; column < row.length; column += 1) {
			const label = text(row[column]);
			if (!label || !patterns.some((pattern) => pattern.test(label))) continue;
			for (let next = column + 1; next < row.length; next += 1) {
				const value = number(row[next]);
				if (value !== null) return value;
			}
		}
	}
	return null;
}

function parseParameters() {
	const netCapitalRows = readRows(files.netCapital, 'Sheet1');
	const netCapitalRow = netCapitalRows.find((row) => /20\d{2}年\d{1,2}月末/.test(text(row?.[0]) ?? '')) ?? [];
	const netCapitalPeriod = text(netCapitalRow[0])?.match(/(20\d{2})年(\d{1,2})月末/);
	if (!netCapitalPeriod) throw new Error('净资本数据缺少报告期');
	const netCapitalDate = `${netCapitalPeriod[1]}-${netCapitalPeriod[2].padStart(2, '0')}-01`;
	const periodEnd = new Date(`${netCapitalDate}T00:00:00Z`);
	periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 1, 0);
	const monthEnd = periodEnd.toISOString().slice(0, 10);
	const liabilityRows = readRows(files.liability);
	const assets = findLabelValue(liabilityRows, [/资产合计/, /总资产/]);
	const liabilities = findLabelValue(liabilityRows, [/负债合计/, /总负债/]);
	const brokerage = findLabelValue(liabilityRows, [/代理买卖/, /客户资金/]);
	return [
		{ code: 'prior_month_net_capital', label: '上月末净资本', valueYi: number(netCapitalRow[1]) / 100000000, periodEnd: monthEnd, notes: `来源：${files.netCapital}` },
		{ code: 'securities_prior_year_net_assets', label: '证券上年末净资产', valueYi: 751.64, periodEnd: '2025-12-31', notes: '安装包口径；来源：liability-weekly-report-win SKILL.md' },
		{ code: 'group_prior_year_net_assets', label: '集团上年末净资产', valueYi: 918.75, periodEnd: '2025-12-31', notes: '安装包口径；来源：liability-weekly-report-win SKILL.md' },
		{ code: 'total_assets', label: '总资产', valueYi: assets, periodEnd: monthEnd, notes: `来源：${files.liability}` },
		{ code: 'total_liabilities', label: '总负债', valueYi: liabilities, periodEnd: monthEnd, notes: `来源：${files.liability}` },
		{ code: 'agency_brokerage_funds', label: '代理买卖证券款', valueYi: brokerage, periodEnd: monthEnd, notes: `来源：${files.liability}` }
	];
}

async function main() {
	const market = [
		...parseMarketFile(files.credit1, 'credit_spread_broker_govt_1y'),
		...parseMarketFile(files.credit3, 'credit_spread_broker_govt_3y'),
		...parseMarketFile(files.credit5, 'credit_spread_broker_govt_5y'),
		...parseMarketFile(files.ncd, 'state_owned_bank_ncd'),
		...parseMarketFile(files.chinaBond, 'chinabond_broker_aaa_minus_yield')
	];
	const peer = parsePeerFile(files.peer);
	const registration = parseRegistrationFile(files.registration);
	const parameters = parseParameters();
	const summary = {
		root, dryRun, marketRows: market.length, peerRows: peer.length,
		registrationRows: registration.length, parameters
	};
	if (dryRun) {
		console.log(JSON.stringify(summary, null, 2));
		return;
	}
	const client = new Client({ connectionString: databaseUrl, application_name: 'eastmoney-financing-liability-weekly-import' });
	await client.connect();
	try {
		await client.query('BEGIN');
		await client.query(`
			INSERT INTO financing.liability_market_observations
			(series_id, series_name, category, tenor, observation_date, value, source, source_reference)
			SELECT series_id, series_name, category, tenor, observation_date, value, source, source_reference
			FROM jsonb_to_recordset($1::jsonb) AS source(
				series_id text, series_name text, category text, tenor text, observation_date date,
				value numeric, source text, source_reference text
			)
			ON CONFLICT (series_id, category, observation_date) DO UPDATE SET
			series_name = EXCLUDED.series_name, tenor = EXCLUDED.tenor, value = EXCLUDED.value,
			 source = EXCLUDED.source, source_reference = EXCLUDED.source_reference, updated_at = CURRENT_TIMESTAMP
		`, [JSON.stringify(market.map((row) => ({
			series_id: row.seriesId, series_name: row.seriesName, category: row.category, tenor: row.tenor,
			observation_date: row.observationDate, value: row.value, source: row.source, source_reference: row.sourceReference
		})))]);
		await client.query(`
			INSERT INTO financing.liability_peer_issuances (
				id, security_code, bond_name, issuer_name, company_nature, issue_date, payment_date, bond_type,
				actual_issue_amount_yi, issue_amount_upper_yi, plan_issue_amount_yi, issue_tenor,
				interest_start_date, issue_notice_date, issue_end_date, maturity_date, listed_date, market,
				coupon_rate_pct, source, source_row_number
			)
			SELECT id, security_code, bond_name, issuer_name, company_nature, issue_date, payment_date, bond_type,
				actual_issue_amount_yi, issue_amount_upper_yi, plan_issue_amount_yi, issue_tenor,
				interest_start_date, issue_notice_date, issue_end_date, maturity_date, listed_date, market,
				coupon_rate_pct, source, source_row_number
			FROM jsonb_to_recordset($1::jsonb) AS source(
				id text, security_code text, bond_name text, issuer_name text, company_nature text,
				issue_date date, payment_date date, bond_type text, actual_issue_amount_yi numeric,
				issue_amount_upper_yi numeric, plan_issue_amount_yi numeric, issue_tenor text,
				interest_start_date date, issue_notice_date date, issue_end_date date, maturity_date date,
				listed_date date, market text, coupon_rate_pct numeric, source text, source_row_number integer
			)
			ON CONFLICT (id) DO UPDATE SET bond_name = EXCLUDED.bond_name, issuer_name = EXCLUDED.issuer_name,
				issue_date = EXCLUDED.issue_date, actual_issue_amount_yi = EXCLUDED.actual_issue_amount_yi,
				maturity_date = EXCLUDED.maturity_date, coupon_rate_pct = EXCLUDED.coupon_rate_pct,
				source = EXCLUDED.source, source_row_number = EXCLUDED.source_row_number, updated_at = CURRENT_TIMESTAMP
		`, [JSON.stringify(peer.map((row) => ({
			id: row.id, security_code: row.securityCode, bond_name: row.bondName, issuer_name: row.issuerName,
			company_nature: row.companyNature, issue_date: row.issueDate, payment_date: row.paymentDate, bond_type: row.bondType,
			actual_issue_amount_yi: row.actualIssueAmountYi, issue_amount_upper_yi: row.issueAmountUpperYi,
			plan_issue_amount_yi: row.planIssueAmountYi, issue_tenor: row.issueTenor, interest_start_date: row.interestStartDate,
			issue_notice_date: row.issueNoticeDate, issue_end_date: row.issueEndDate, maturity_date: row.maturityDate,
			listed_date: row.listedDate, market: row.market, coupon_rate_pct: row.couponRatePct, source: row.source,
			source_row_number: row.sourceRowNumber
		})))]);
		await client.query(`
			INSERT INTO financing.liability_registration_progress (
				id, project_name, issuer_name, status, variety, amount_yi, region, industry, lead_underwriter,
				venue, registration_or_filing, update_date, notice_number, source, source_row_number
			)
			SELECT id, project_name, issuer_name, status, variety, amount_yi, region, industry, lead_underwriter,
				venue, registration_or_filing, update_date, notice_number, source, source_row_number
			FROM jsonb_to_recordset($1::jsonb) AS source(
				id text, project_name text, issuer_name text, status text, variety text, amount_yi numeric,
				region text, industry text, lead_underwriter text, venue text, registration_or_filing text,
				update_date date, notice_number text, source text, source_row_number integer
			)
			ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, amount_yi = EXCLUDED.amount_yi,
				lead_underwriter = EXCLUDED.lead_underwriter, venue = EXCLUDED.venue,
				update_date = EXCLUDED.update_date, notice_number = EXCLUDED.notice_number,
				source = EXCLUDED.source, source_row_number = EXCLUDED.source_row_number, updated_at = CURRENT_TIMESTAMP
		`, [JSON.stringify(registration.map((row) => ({
			id: row.id, project_name: row.projectName, issuer_name: row.issuerName, status: row.status,
			variety: row.variety, amount_yi: row.amountYi, region: row.region, industry: row.industry,
			lead_underwriter: row.leadUnderwriter, venue: row.venue, registration_or_filing: row.registrationOrFiling,
			update_date: row.updateDate, notice_number: row.noticeNumber, source: row.source, source_row_number: row.sourceRowNumber
		})))]);
		for (const row of parameters) {
			if (row.valueYi === null) continue;
			await client.query(`
				INSERT INTO financing.finance_parameters (code, label, value_yi, period_end, notes)
				VALUES ($1,$2,$3,$4,$5)
				ON CONFLICT (code) DO UPDATE SET label = EXCLUDED.label, value_yi = EXCLUDED.value_yi,
				 period_end = EXCLUDED.period_end, notes = EXCLUDED.notes, updated_at = CURRENT_TIMESTAMP
			`, [row.code, row.label, row.valueYi, row.periodEnd, row.notes]);
		}
		await client.query('COMMIT');
	} catch (error) {
		await client.query('ROLLBACK');
		throw error;
	} finally {
		await client.end();
	}
	console.log(JSON.stringify(summary, null, 2));
}

await main();
