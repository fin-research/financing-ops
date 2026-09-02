// @ts-nocheck
import { randomUUID } from 'node:crypto';
import { getLiabilityWeeklyReportData } from './queries.js';
import { prepareAudit } from './audit.js';
import { fetchManualChoiceSources } from './liability-choice.js';

const SOURCE_FILES = {
	market: [
		'底稿/【每周五替换】利率看板底稿/AAA-券商与国债信用利差(1年）.xlsx',
		'底稿/【每周五替换】利率看板底稿/AAA-券商与国债信用利差(3年）.xlsx',
		'底稿/【每周五替换】利率看板底稿/AAA-券商与国债信用利差(5年）.xlsx',
		'底稿/【每周五替换】利率看板底稿/国有行存单发行利率.xlsx',
		'底稿/【每周五替换】利率看板底稿/中债证券公司债到期收益率(AAA-).xlsx'
	],
	peer: '底稿/【每周五替换】可比券商底稿/债券发行明细.xlsx',
	registration: '底稿/【每周五替换】可比券商底稿/项目注册进程2026-08-28.xlsx',
	parameters: [
		'底稿/【每月初替换】负债测算/净资本数据.xlsx',
		'底稿/【每月初替换】负债测算/负债测算2026.7.xlsx',
		'安装包 skill/liability-weekly-report-win/SKILL.md'
	]
};

const CALIBER = {
	balance: '主动负债余额与结构使用 financing.balance_snapshot；明细台账仅用于实时指标和勾稽提示。',
	activeDebt: '统计日以前已起息且未到期、未关闭的 financing.debt；无到期日记录保留并标记勾稽缺口。',
	cumulativeBorrowing: '月末累计新增借款按已导入余额快照差额计算，并剔除互换便利。',
	projects: '推进中融资计划只读 financing.projects 的 planning/in_progress/at_risk，项目字段缺失不隐藏。',
	choice: '每次手动生成最多各请求一次 Choice EDB 与 CTR；失败不重试。',
	parameters: '净资本、净资产和资产负债率沿用安装包报告期；月末字段按自然月末日期记录。'
};

function hex(buffer) {
	return [...new Uint8Array(buffer)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function sha256(value) {
	return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}


export async function getLiabilityWeeklyReportSourceStatus(db, asOfDate, choice = {
	edb: { status: 'missing', error: '本次尚未手动拉取 Choice EDB。' },
	ctr: { status: 'missing', error: '本次尚未手动拉取 Choice CTR。' }
}) {
	const counts = await db.prepare(`
		WITH required_parameters(code) AS (
			VALUES
				('prior_month_net_capital'), ('securities_prior_year_net_assets'),
				('group_prior_year_net_assets'), ('total_assets'),
				('total_liabilities'), ('agency_brokerage_funds'),
				('asset_liability_ratio'), ('adjusted_asset_liability_ratio')
		)
		SELECT
			(SELECT COUNT(*) FROM liability_market_observations WHERE observation_date <= ?::date) AS market_count,
			(SELECT COUNT(*) FROM liability_peer_issuances WHERE issue_date IS NULL OR issue_date <= ?::date) AS peer_count,
			(SELECT COUNT(*) FROM liability_registration_progress WHERE update_date <= ?::date) AS registration_count,
			(SELECT COUNT(*) FROM finance_parameters WHERE code IN (SELECT code FROM required_parameters) AND value_yi IS NOT NULL) AS parameter_count,
			(SELECT string_agg(required.code, ', ' ORDER BY required.code)
				FROM required_parameters required
				WHERE NOT EXISTS (
					SELECT 1 FROM finance_parameters parameter
					WHERE parameter.code = required.code AND parameter.value_yi IS NOT NULL
				)) AS missing_parameter_codes,
			(SELECT COUNT(*) FROM projects WHERE status IN ('planning', 'in_progress', 'at_risk') AND
				(expected_rate_min IS NULL OR expected_rate_max IS NULL OR funding_cost_rate IS NULL
					OR tenor_description IS NULL OR amount_description IS NULL)) AS incomplete_project_count
	`).get(asOfDate, asOfDate, asOfDate);
	const missingModules = [];
	if (Number(counts.market_count ?? 0) === 0 && choice.edb.status !== 'available') {
		missingModules.push({ code: 'market_rates', title: '市场利率与信用利差', detail: '底稿与本次 Choice EDB 均未返回可用观测。' });
	}
	if (Number(counts.peer_count ?? 0) === 0 && choice.ctr.status !== 'available') {
		missingModules.push({ code: 'peer_issuance', title: '可比券商发行明细', detail: '底稿与本次 Choice CTR 均未返回可用发行明细。' });
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
	if (Number(counts.incomplete_project_count ?? 0) > 0) {
		missingModules.push({ code: 'project_fields', title: '推进中项目字段', detail: `${counts.incomplete_project_count} 个推进中项目缺少预计利率、资金成本、期限描述或规模说明中的一项。` });
	}
	if (choice.edb.status !== 'available') {
		missingModules.push({ code: 'choice_edb', title: '本次 Choice EDB', detail: choice.edb.error });
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
		version: 1,
		generatedAt,
		asOfDate,
		report: baseReport,
		choice,
		provenance: {
			generation: 'manual',
			choiceQuota: { edbRequests: 1, ctrRequests: 1, automaticRequests: 0 },
			sourceFiles: SOURCE_FILES,
			caliber: CALIBER,
			sourceCounts: sources.counts,
			missingModules: sources.missingModules
		}
	};
	const content = JSON.stringify(snapshot);
	const contentSha256 = await sha256(content);
	const id = randomUUID();
	const r2Key = `debt-report/${asOfDate}/${id}.json`;
	await database.transaction(async (transaction) => {
		await transaction.prepare(`
			INSERT INTO liability_weekly_report_runs (
				id, as_of_date, generated_by_person_id, r2_key, content_sha256, status,
				source_manifest, missing_modules
			) VALUES (?, ?, ?, ?, ?, 'pending', ?::jsonb, ?::jsonb)
		`).run(id, asOfDate, actor?.personId ?? null, r2Key, contentSha256,
			JSON.stringify(snapshot.provenance), JSON.stringify(sources.missingModules));
		await prepareAudit({
			db: transaction,
			actor,
			action: 'liability_weekly_report.generate',
			entityType: 'liability_weekly_report',
			entityId: id,
			summary: `手动生成负债周报：${asOfDate}`,
			after: { id, asOfDate, r2Key, contentSha256, provenance: snapshot.provenance }
		}).run();
	});
	try {
		await bucket.put(r2Key, content, {
			httpMetadata: { contentType: 'application/json; charset=utf-8', cacheControl: 'public, max-age=31536000, immutable' },
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
