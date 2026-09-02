// @ts-nocheck
import { randomUUID } from 'node:crypto';
import { getLiabilityWeeklyReportData } from './queries.js';
import { prepareAudit } from './audit.js';
import { fetchManualChoiceSources } from './liability-choice.js';

const SOURCE_FILES = {
	peer: '底稿/【每周五替换】可比券商底稿/债券发行明细.xlsx',
	registration: '底稿/【每周五替换】可比券商底稿/项目注册进程2026-08-28.xlsx',
	parameters: [
		'底稿/【每月初替换】负债测算/净资本数据.xlsx',
		'底稿/【每月初替换】负债测算/负债测算2026.7.xlsx',
		'安装包 skill/liability-weekly-report-win/SKILL.md'
	]
};

const LIABILITY_REPORT_EDB_CODES = [
	'E1707781', 'E1707782', 'E1707783', 'E1707785',
	'E1000172', 'E1000174', 'E1000176',
	'E1704281', 'E1704282', 'E1704283', 'E1704284'
];

const CALIBER = {
	balance: '主动负债余额与结构使用 financing.balance_snapshot；明细台账仅用于实时指标和勾稽提示。',
	activeDebt: '统计日以前已起息且未到期、未关闭的 financing.debt；无到期日记录保留并标记勾稽缺口。',
	cumulativeBorrowing: '月末累计新增借款按已导入余额快照差额计算，并剔除互换便利。',
	projects: '推进中融资计划只读 financing.projects 的 planning/in_progress/at_risk，项目字段缺失不隐藏。',
	dynamics: '近期动态只含实际发行、到期和付息；收益凭证发行日优先取认购日，融资计划不计入动态金额。',
	market: '利率走势只读 Neon public.edb；Choice EDB 由 dashboard 每日定时增量更新，页面访问和手动生成都不调用 EDB。',
	choice: '每次手动生成只发起一次 Choice CTR 逻辑请求；可比发行与申报表按上一完整周的周一至周五及券商品种过滤，失败请求可有限重试。',
	due30: '未来30天与年内到期核心指标统计全量已安排负债并纳入尚未发行记录；仅未来30天到期明细排除同业拆借和浮动收益凭证，独立付息现金流不计作负债到期。',
	parameters: '净资本、净资产和资产负债率沿用安装包报告期；月末字段按自然月末日期记录。'
};

function hex(buffer) {
	return [...new Uint8Array(buffer)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function sha256(value) {
	return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}


export async function getLiabilityWeeklyReportSourceStatus(db, asOfDate, choice = {
	ctr: { status: 'missing', error: '本次尚未手动拉取 Choice CTR。' }
}) {
	const counts = await db.prepare(`
		WITH args AS (
			SELECT ?::date AS as_of_date
		), report_week AS (
			SELECT date_trunc('week', as_of_date)::date - 7 AS start_date,
				date_trunc('week', as_of_date)::date - 3 AS end_date
			FROM args
		), required_parameters(code) AS (
			VALUES
				('prior_month_net_capital'), ('securities_prior_year_net_assets'),
				('group_prior_year_net_assets'), ('total_assets'),
				('total_liabilities'), ('agency_brokerage_funds'),
				('asset_liability_ratio'), ('adjusted_asset_liability_ratio')
		), required_market_series(code) AS (
			SELECT unnest(?::text[])
		), missing_maturity AS (
			SELECT id, name, counterparty, amount
			FROM debt CROSS JOIN args
			WHERE activated_at IS NOT NULL AND activated_at <= args.as_of_date
				AND maturity_date IS NULL AND closed_at IS NULL
				AND status IN ('active', 'matured')
		)
		SELECT
			(SELECT COUNT(*) FROM required_market_series required
				WHERE EXISTS (
					SELECT 1 FROM public.edb observation CROSS JOIN args
					WHERE observation.indicator_code = required.code
						AND observation.observation_date BETWEEN date_trunc('year', args.as_of_date)::date AND args.as_of_date
				)) AS market_series_count,
			(SELECT string_agg(required.code, ', ' ORDER BY required.code)
				FROM required_market_series required
				WHERE NOT EXISTS (
					SELECT 1 FROM public.edb observation CROSS JOIN args
					WHERE observation.indicator_code = required.code
						AND observation.observation_date BETWEEN date_trunc('year', args.as_of_date)::date AND args.as_of_date
				)) AS missing_market_series,
			(SELECT MAX(observation.synced_at) FROM public.edb observation
				WHERE observation.indicator_code IN (SELECT code FROM required_market_series)) AS market_synced_at,
			(SELECT COUNT(*) FROM liability_peer_issuances peer CROSS JOIN report_week week
				WHERE peer.issue_date BETWEEN week.start_date AND week.end_date
					AND peer.issuer_name LIKE '%证券%'
					AND peer.bond_type IN ('证券公司债', '证券公司次级债', '证券公司短期融资券')) AS peer_count,
			(SELECT COUNT(*) FROM liability_peer_issuances peer CROSS JOIN report_week week
				WHERE peer.issue_date BETWEEN week.start_date AND week.end_date
					AND peer.issuer_name LIKE '%证券%'
					AND peer.bond_type IN ('证券公司债', '证券公司次级债', '证券公司短期融资券')
					AND peer.coupon_rate_pct IS NOT NULL) AS peer_coupon_count,
			(SELECT COUNT(*) FROM liability_registration_progress registration CROSS JOIN report_week week
				WHERE registration.update_date BETWEEN week.start_date AND week.end_date
					AND registration.issuer_name LIKE '%证券%'
					AND registration.variety IN ('小公募', '私募')) AS registration_count,
			(SELECT COUNT(*) FROM finance_parameters WHERE code IN (SELECT code FROM required_parameters) AND value_yi IS NOT NULL) AS parameter_count,
			(SELECT COUNT(*) FROM missing_maturity) AS missing_maturity_count,
			(SELECT COALESCE(SUM(amount), 0) / 100000000 FROM missing_maturity) AS missing_maturity_amount_yi,
			(SELECT string_agg(item.name || ' · ' || COALESCE(item.counterparty, '对手方缺失') || ' · ' || round(item.amount / 100000000, 4)::text || '亿元', '；' ORDER BY item.amount DESC, item.id)
				FROM (SELECT * FROM missing_maturity ORDER BY amount DESC, id LIMIT 5) item) AS missing_maturity_details,
			(SELECT string_agg(required.code, ', ' ORDER BY required.code)
				FROM required_parameters required
				WHERE NOT EXISTS (
					SELECT 1 FROM finance_parameters parameter
					WHERE parameter.code = required.code AND parameter.value_yi IS NOT NULL
				)) AS missing_parameter_codes,
			(SELECT COUNT(*) FROM projects WHERE status IN ('planning', 'in_progress', 'at_risk') AND
				(expected_rate_min IS NULL OR expected_rate_max IS NULL OR funding_cost_rate IS NULL
					OR tenor_description IS NULL OR amount_description IS NULL)) AS incomplete_project_count
	`).get(asOfDate, LIABILITY_REPORT_EDB_CODES);
	const missingModules = [];
	if (Number(counts.market_series_count ?? 0) < LIABILITY_REPORT_EDB_CODES.length) {
		missingModules.push({
			code: 'market_rates',
			title: 'public.edb 市场利率与信用利差',
			detail: `定时同步数据缺少指标：${counts.missing_market_series ?? '未识别'}。`
		});
	}
	if (Number(counts.peer_count ?? 0) === 0 && choice.ctr.status !== 'available') {
		missingModules.push({ code: 'peer_issuance', title: '可比券商发行明细', detail: '底稿与本次 Choice CTR 均未返回可用发行明细。' });
	}
	if (Number(counts.peer_count ?? 0) > Number(counts.peer_coupon_count ?? 0)) {
		missingModules.push({ code: 'peer_coupon_rate', title: '可比券商发行利率', detail: `本周 ${counts.peer_count} 条券商发行中有 ${Number(counts.peer_count) - Number(counts.peer_coupon_count ?? 0)} 条缺少票面利率。` });
	}
	if (Number(counts.registration_count ?? 0) === 0) {
		missingModules.push({ code: 'registration_progress', title: '可比券商注册进程', detail: 'Choice 当前没有已验证的注册进程报表，且生产库没有底稿记录。' });
	}
	// The installation workbook supplies the registration history. Choice's CSS
	// fields are issuer-level attributes, but no verified bulk registration
	// progress report is available, so keep that limitation visible in every run.
	missingModules.push({ code: 'choice_registration', title: 'Choice 注册进程', detail: '尚未验证可批量拉取的 Choice 注册进程报表；当前使用生产库中的底稿历史记录。' });
	if (Number(counts.parameter_count ?? 0) < 8) {
		missingModules.push({ code: 'finance_parameters', title: '净资本、净资产与资产负债规模', detail: `生产库缺少参数：${counts.missing_parameter_codes ?? '未识别'}。` });
	}
	if (Number(counts.missing_maturity_count ?? 0) > 0) {
		missingModules.push({
			code: 'debt_maturity',
			title: '负债到期日字段',
			detail: `${counts.missing_maturity_count} 条负债缺少到期日（合计 ${Number(counts.missing_maturity_amount_yi ?? 0).toFixed(4)} 亿元）：${counts.missing_maturity_details ?? '具体记录未识别'}。请确认后补录。`
		});
	}
	if (Number(counts.incomplete_project_count ?? 0) > 0) {
		missingModules.push({ code: 'project_fields', title: '推进中项目字段', detail: `${counts.incomplete_project_count} 个推进中项目缺少预计利率、资金成本、期限描述或规模说明中的一项。` });
	}
	if (choice.ctr.status !== 'available') {
		missingModules.push({ code: 'choice_ctr', title: '本次 Choice CTR', detail: choice.ctr.error });
	}
	return { counts, missingModules };
}

export async function getLiabilityWeeklyReportHistory(database, limit = 30) {
	const safeLimit = Math.min(Math.max(Number(limit) || 30, 1), 100);
	return database.prepare(`
		SELECT id, as_of_date AS "asOfDate", generated_at AS "generatedAt",
			generated_by_person_id AS "generatedByPersonId", r2_key AS "r2Key",
			content_sha256 AS "contentSha256", status, source_manifest AS "sourceManifest",
			missing_modules AS "missingModules", error_message AS "errorMessage"
		FROM liability_weekly_report_runs
		WHERE status = 'complete'
		ORDER BY generated_at DESC, id DESC
		LIMIT ?
	`).all(safeLimit);
}

export async function readLiabilityWeeklyReportSnapshot(env, run) {
	const bucket = env?.LIABILITY_REPORT_SNAPSHOTS;
	if (!bucket) throw new Error('R2 绑定 LIABILITY_REPORT_SNAPSHOTS 不可用');
	const object = await bucket.get(run.r2Key);
	if (!object) throw new Error(`周报快照不存在：${run.r2Key}`);
	return object.json();
}

export async function generateLiabilityWeeklyReport({ database, env, actor, fetchImpl = fetch }) {
	const bucket = env?.LIABILITY_REPORT_SNAPSHOTS;
	if (!bucket) throw new Error('R2 绑定 LIABILITY_REPORT_SNAPSHOTS 不可用');
	const baseReport = await getLiabilityWeeklyReportData(database);
	const asOfDate = baseReport.asOfDate;
	const dataApiUrl = env.CHOICE_DATA_API_URL || 'https://eastmoney.hasbai.xyz/data';
	const choice = await fetchManualChoiceSources({ dataApiUrl, asOfDate, fetchImpl });
	const sources = await getLiabilityWeeklyReportSourceStatus(database, asOfDate, choice);
	if (!baseReport.quality.liveDerivedReliable) {
		sources.missingModules.push({
			code: 'reconciliation',
			title: '负债明细与余额快照勾稽',
			detail: `明细余额与 ${asOfDate} 快照相差 ${Math.abs(baseReport.quality.reconciliationDeltaYi).toFixed(4)} 亿元；保留明细展示，但金额须核对。`
		});
	}
	const generatedAt = new Date().toISOString();
	const snapshot = {
		version: 2,
		generatedAt,
		asOfDate,
		report: baseReport,
		choice,
		provenance: {
			generation: 'manual',
			choiceQuota: { edbLogicalRequests: 0, ctrLogicalRequests: 1, maxAttemptsPerRequest: 3 },
			databaseSources: { marketRates: 'public.edb', marketRatesSyncedAt: sources.counts.market_synced_at ?? null },
			sourceFiles: SOURCE_FILES,
			caliber: CALIBER,
			sourceCounts: sources.counts,
			missingModules: sources.missingModules
		}
	};
	const content = JSON.stringify(snapshot);
	const contentSha256 = await sha256(content);
	const r2Key = `liability-report/${asOfDate}.json`;
	let id;
	let previousRun = null;
	await database.transaction(async (transaction) => {
		previousRun = await transaction.prepare(`
			SELECT id, as_of_date AS "asOfDate", generated_at AS "generatedAt",
				generated_by_person_id AS "generatedByPersonId", r2_key AS "r2Key",
				content_sha256 AS "contentSha256", status
			FROM liability_weekly_report_runs
			WHERE as_of_date = ?
			FOR UPDATE
		`).get(asOfDate);
		id = previousRun?.id ?? randomUUID();
		if (previousRun) {
			await transaction.prepare(`
			UPDATE liability_weekly_report_runs
				SET generated_at = CURRENT_TIMESTAMP, generated_by_person_id = ?,
					r2_key = ?, content_sha256 = ?, status = 'pending',
					source_manifest = ?::jsonb, missing_modules = ?::jsonb, error_message = NULL,
					updated_at = CURRENT_TIMESTAMP
				WHERE id = ?
			`).run(actor?.personId ?? null, r2Key, contentSha256,
				JSON.stringify(snapshot.provenance), JSON.stringify(sources.missingModules), id);
		} else {
			await transaction.prepare(`
				INSERT INTO liability_weekly_report_runs (
					id, as_of_date, generated_by_person_id, r2_key, content_sha256, status,
					source_manifest, missing_modules
				) VALUES (?, ?, ?, ?, ?, 'pending', ?::jsonb, ?::jsonb)
			`).run(id, asOfDate, actor?.personId ?? null, r2Key, contentSha256,
				JSON.stringify(snapshot.provenance), JSON.stringify(sources.missingModules));
		}
		await prepareAudit({
			db: transaction,
			actor,
			action: 'liability_weekly_report.generate',
			entityType: 'liability_weekly_report',
			entityId: id,
			summary: `手动生成负债周报：${asOfDate}`,
			before: previousRun,
			after: { id, asOfDate, r2Key, contentSha256, provenance: snapshot.provenance, replaces: previousRun?.id ?? null }
		}).run();
	});
	try {
		await bucket.put(r2Key, content, {
			httpMetadata: { contentType: 'application/json; charset=utf-8', cacheControl: 'no-cache' },
			customMetadata: { asOfDate, contentSha256, reportRunId: id }
		});
		await database.prepare(`
			UPDATE liability_weekly_report_runs SET status = 'complete', updated_at = CURRENT_TIMESTAMP WHERE id = ?
		`).run(id);
	} catch (error) {
		await database.prepare(`
			UPDATE liability_weekly_report_runs
			SET status = 'failed', error_message = ?, updated_at = CURRENT_TIMESTAMP
			WHERE id = ?
		`).run(String(error?.message ?? error), id);
		throw error;
	}
	return { id, asOfDate, r2Key, contentSha256, missingModules: sources.missingModules, snapshot };
}
