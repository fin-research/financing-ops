// @ts-nocheck

export const CTR_REPORT = 'BondIssueDetail';
export const CTR_INDICATOR_LIST = [
	'SECUCODE', 'BOND_NAME_ABBR', 'BOND_TYPE', 'ISSUE_DATE',
	'ACTUAL_ISSUE_SCALE', 'BOND_EXPIRE_YEAR', 'ISSUERATE_REFERENCE',
	'PAYPERYEAR', 'TOMRTY_YEAR', 'DEC_TOMRTYYEAR1', 'ISSUER_RATING',
	'BOND_RATING', 'IS_OEB', 'IS_GUARANTEE', 'PI_RATE_TYPE',
	'ISSUER_NAME', 'ORGFORM'
];
export const CTR_INDICATORS = CTR_INDICATOR_LIST.join(',');

// Keep this identical to quant/data/choice_bond_data.py. The CTR report
// silently returns no rows when its report-specific filters are omitted.
function ctrOptions(startDate, endDate) {
	return [
		`StartDate=${startDate}`,
		`EndDate=${endDate}`,
		'Bond_Type=646003',
		'Frequency=1',
		'Issuer_Rating=-',
		'Bond_Rating=-',
		'Issue_Date_Type=2',
		'Tenor=-',
		'Company_Type=-'
	].join(',');
}

function dateShift(date, days) {
	const value = new Date(`${date}T00:00:00Z`);
	value.setUTCDate(value.getUTCDate() + days);
	return value.toISOString().slice(0, 10);
}

function choiceUrl(base, pathname, params) {
	const url = new URL(`${base.replace(/\/$/, '')}/${pathname.replace(/^\/+/, '')}`);
	for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
	return url;
}

function wait(milliseconds) {
	return milliseconds > 0 ? new Promise((resolve) => setTimeout(resolve, milliseconds)) : Promise.resolve();
}

function isPrimitive(value) {
	return value == null || ['string', 'number', 'boolean'].includes(typeof value);
}

export function buildManualChoiceRequest(asOfDate) {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(String(asOfDate ?? ''))) throw new Error('负债周报数据日期无效');
	const startDate = dateShift(asOfDate, -7);
	return {
		window: { startDate, endDate: asOfDate },
		ctrRequest: {
			reportName: CTR_REPORT,
			indicators: CTR_INDICATORS,
			options: ctrOptions(startDate, asOfDate)
		}
	};
}

async function fetchChoiceTable(base, pathname, params, fetchImpl = fetch, {
	maxAttempts = 3,
	retryDelayMs = 250
} = {}) {
	const url = choiceUrl(base, pathname, params);
	const attempts = Math.max(1, Number(maxAttempts) || 1);
	const delayMs = Math.max(0, Number(retryDelayMs) || 0);
	let lastError;
	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		try {
			const response = await fetchImpl(url, { headers: { Accept: 'application/json' }, cache: 'no-store' });
			if (!response.ok) throw new Error(`Choice ${pathname} 请求失败（HTTP ${response.status}）`);
			const table = await response.json();
			if (!table || !Array.isArray(table.rows) || !Array.isArray(table.fields)) {
				throw new Error(`Choice ${pathname} 返回结构无效`);
			}
			return table;
		} catch (error) {
			lastError = error;
			if (attempt < attempts) await wait(delayMs * (2 ** (attempt - 1)));
		}
	}
	throw lastError;
}

/**
 * Comparable issuance data is queried only after the user clicks the report
 * button. This module is browser-safe so the request goes straight to the
 * public data Worker instead of nesting a subrequest inside financing.
 */
export async function fetchManualChoiceSources({
	dataApiUrl,
	asOfDate,
	fetchImpl = fetch,
	maxAttempts = 3,
	retryDelayMs = 250
}) {
	if (!dataApiUrl) throw new Error('未配置 Choice 数据 API 地址');
	const { window, ctrRequest } = buildManualChoiceRequest(asOfDate);
	const ctr = await Promise.resolve(fetchChoiceTable(
		dataApiUrl,
		'/choice/ctr',
		ctrRequest,
		fetchImpl,
		{ maxAttempts, retryDelayMs }
	)).then(
		(value) => ({ status: 'fulfilled', value }),
		(reason) => ({ status: 'rejected', reason })
	);
	return {
		window,
		ctr: ctr.status === 'fulfilled'
			? {
				status: 'available', path: '/choice/ctr',
				request: ctrRequest,
				function: ctr.value.function, fields: ctr.value.fields, rows: ctr.value.rows
			}
			: {
				status: 'missing', path: '/choice/ctr',
				request: ctrRequest,
				error: String(ctr.reason?.message ?? ctr.reason)
			}
	};
}

/** Rebuild and validate the browser-supplied CTR payload before persisting it. */
export function normalizeManualChoiceSources(value, asOfDate) {
	const { window, ctrRequest } = buildManualChoiceRequest(asOfDate);
	const ctr = value?.ctr;
	if (!ctr || ctr.status !== 'available') throw new Error('Choice CTR 尚未成功返回，不能保存周报快照');
	if (String(ctr.function ?? '').toUpperCase() !== 'CTR') throw new Error('Choice CTR 返回函数类型无效');
	if (!Array.isArray(ctr.fields) || ctr.fields.length > 64) throw new Error('Choice CTR 字段列表无效');
	const allowedFields = new Set(CTR_INDICATOR_LIST);
	const fields = ctr.fields.map((field) => String(field));
	if (new Set(fields).size !== fields.length || fields.some((field) => !allowedFields.has(field))) {
		throw new Error('Choice CTR 返回了未请求的字段');
	}
	if (!Array.isArray(ctr.rows) || ctr.rows.length > 10_000) throw new Error('Choice CTR 数据行数无效');
	const rows = ctr.rows.map((row) => {
		if (!row || Array.isArray(row) || typeof row !== 'object') throw new Error('Choice CTR 数据行结构无效');
		const normalized = {};
		for (const field of fields) {
			if (!(field in row)) continue;
			if (!isPrimitive(row[field])) throw new Error(`Choice CTR 字段 ${field} 的值无效`);
			normalized[field] = row[field];
		}
		return normalized;
	});
	return {
		window,
		ctr: {
			status: 'available', path: '/choice/ctr', request: ctrRequest,
			function: 'CTR', fields, rows
		}
	};
}
