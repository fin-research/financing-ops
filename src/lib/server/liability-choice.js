// @ts-nocheck

const EDB_SERIES = [
	'E1707781', 'E1707782', 'E1707783', 'E1707785',
	'E1000172', 'E1000174', 'E1000176',
	'E1704281', 'E1704282', 'E1704283', 'E1704284'
];

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

async function fetchChoiceTable(base, pathname, params, fetchImpl = fetch) {
	const url = choiceUrl(base, pathname, params);
	const response = await fetchImpl(url, { headers: { Accept: 'application/json' }, cache: 'no-store' });
	if (!response.ok) throw new Error(`Choice ${pathname} 请求失败（HTTP ${response.status}）`);
	const table = await response.json();
	if (!table || !Array.isArray(table.rows) || !Array.isArray(table.fields)) {
		throw new Error(`Choice ${pathname} 返回结构无效`);
	}
	return table;
}

/**
 * Choice is intentionally queried only from the explicit report-generation action.
 * The two requests are bounded to one short EDB window and one CTR window; page
 * loads never call this function and there is no retry on a quota-limited source.
 */
export async function fetchManualChoiceSources({ dataApiUrl, asOfDate, fetchImpl = fetch }) {
	if (!dataApiUrl) throw new Error('未配置 Choice 数据 API 地址');
	const startDate = dateShift(asOfDate, -7);
	const [edb, ctr] = await Promise.allSettled([
		fetchChoiceTable(dataApiUrl, '/choice/edb', {
			edbIds: EDB_SERIES.join(','), startDate, endDate: asOfDate,
			options: 'IsPublishDate=0'
		}, fetchImpl),
		fetchChoiceTable(dataApiUrl, '/choice/ctr', {
			reportName: 'BondIssueDetail',
			indicators: 'SECUCODE,BOND_NAME_ABBR,ISSUER_NAME,ISSUE_DATE,ACTUAL_ISSUE_SCALE,BOND_EXPIRE_YEAR,ISSUERATE_REFERENCE',
			options: `StartDate=${startDate},EndDate=${asOfDate}`
		}, fetchImpl)
	]);
	return {
		window: { startDate, endDate: asOfDate },
		edb: edb.status === 'fulfilled'
			? {
				status: 'available', path: '/choice/edb',
				request: { edbIds: EDB_SERIES.join(','), startDate, endDate: asOfDate, options: 'IsPublishDate=0' },
				function: edb.value.function, fields: edb.value.fields, rows: edb.value.rows
			}
			: {
				status: 'missing', path: '/choice/edb',
				request: { edbIds: EDB_SERIES.join(','), startDate, endDate: asOfDate, options: 'IsPublishDate=0' },
				error: String(edb.reason?.message ?? edb.reason)
			},
		ctr: ctr.status === 'fulfilled'
			? {
				status: 'available', path: '/choice/ctr',
				request: {
					reportName: 'BondIssueDetail',
					indicators: 'SECUCODE,BOND_NAME_ABBR,ISSUER_NAME,ISSUE_DATE,ACTUAL_ISSUE_SCALE,BOND_EXPIRE_YEAR,ISSUERATE_REFERENCE',
					options: `StartDate=${startDate},EndDate=${asOfDate}`
				},
				function: ctr.value.function, fields: ctr.value.fields, rows: ctr.value.rows
			}
			: {
				status: 'missing', path: '/choice/ctr',
				request: {
					reportName: 'BondIssueDetail',
					indicators: 'SECUCODE,BOND_NAME_ABBR,ISSUER_NAME,ISSUE_DATE,ACTUAL_ISSUE_SCALE,BOND_EXPIRE_YEAR,ISSUERATE_REFERENCE',
					options: `StartDate=${startDate},EndDate=${asOfDate}`
				},
				error: String(ctr.reason?.message ?? ctr.reason)
			}
	};
}
