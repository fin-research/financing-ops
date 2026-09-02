// @ts-nocheck

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
 * Comparable issuance data is queried only from the explicit report-generation
 * action. Market-rate EDB series are not requested here: the shared dashboard
 * scheduler owns their incremental refresh into public.edb.
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
	const ctrRequest = {
		reportName: CTR_REPORT,
		indicators: CTR_INDICATORS,
		options: ctrOptions(startDate, asOfDate)
	};
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
		window: { startDate, endDate: asOfDate },
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
