// @ts-nocheck

const EDB_SERIES = [
	'E1707781', 'E1707782', 'E1707783', 'E1707785',
	'E1000172', 'E1000174', 'E1000176',
	'E1704281', 'E1704282', 'E1704283', 'E1704284'
];

const CTR_REPORT = 'BondIssueDetail';
const CTR_INDICATORS = [
	'SECUCODE', 'BOND_NAME_ABBR', 'BOND_TYPE', 'ISSUE_DATE',
	'ACTUAL_ISSUE_SCALE', 'BOND_EXPIRE_YEAR', 'ISSUERATE_REFERENCE',
	'PAYPERYEAR', 'TOMRTY_YEAR', 'DEC_TOMRTYYEAR1', 'ISSUER_RATING',
	'BOND_RATING', 'IS_OEB', 'IS_GUARANTEE', 'PI_RATE_TYPE',
	'ISSUER_NAME', 'ORGFORM'
].join(',');

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
	const url = new URL(pathname, `${base.replace(/\/$/, '')}/`);
	for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
	return url;
}

function wait(milliseconds) {
	return milliseconds > 0 ? new Promise((resolve) => setTimeout(resolve, milliseconds)) : Promise.resolve();
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
			if (attempt < attempts) {
				await wait(delayMs * (2 ** (attempt - 1)));
			}
		}
	}
	throw lastError;
}

/**
 * Choice is intentionally queried only from the explicit report-generation action.
 * The two logical requests are bounded to one short EDB window and one CTR
 * window; page loads never call this function. Failed requests can be retried
 * because the Choice gateway does not consume quota for failed upstream calls.
 */
export async function fetchManualChoiceSources({
	dataApiUrl,
	asOfDate,
	fetchImpl = fetch,
	maxAttempts = 3,
	retryDelayMs = 250
}) {
	if (!dataApiUrl) throw new Error('未配置 Choice 数据 API 地址');
	const startDate = dateShift(asOfDate, -7);
	const edbRequest = {
		edbIds: EDB_SERIES.join(','), startDate, endDate: asOfDate,
		options: 'IsPublishDate=0'
	};
	const ctrRequest = {
		reportName: CTR_REPORT,
		indicators: CTR_INDICATORS,
		options: ctrOptions(startDate, asOfDate)
	};
	const [edb, ctr] = await Promise.allSettled([
		fetchChoiceTable(dataApiUrl, '/choice/edb', edbRequest, fetchImpl, { maxAttempts, retryDelayMs }),
		fetchChoiceTable(dataApiUrl, '/choice/ctr', ctrRequest, fetchImpl, { maxAttempts, retryDelayMs })
	]);
	return {
		window: { startDate, endDate: asOfDate },
		edb: edb.status === 'fulfilled'
			? {
				status: 'available', path: '/choice/edb',
				request: edbRequest,
				function: edb.value.function, fields: edb.value.fields, rows: edb.value.rows
			}
			: {
				status: 'missing', path: '/choice/edb',
				request: edbRequest,
				error: String(edb.reason?.message ?? edb.reason)
			},
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
