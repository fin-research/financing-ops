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
export const REGISTRATION_FIELDS = [
	'projectName', 'issuerName', 'status', 'variety', 'amountYi', 'region', 'industry',
	'leadUnderwriter', 'noticeNumber', 'venue', 'registrationOrFiling', 'updateDate'
];

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

function previousCompleteWeek(asOfDate) {
	const value = new Date(`${asOfDate}T00:00:00Z`);
	const daysSinceMonday = (value.getUTCDay() + 6) % 7;
	const startDate = dateShift(asOfDate, -(daysSinceMonday + 7));
	return { startDate, endDate: dateShift(startDate, 4) };
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

export function buildManualLiabilityRequests(asOfDate) {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(String(asOfDate ?? ''))) throw new Error('负债周报数据日期无效');
	const startDate = dateShift(asOfDate, -7);
	return {
		window: { startDate, endDate: asOfDate },
		registrationWindow: previousCompleteWeek(asOfDate),
		ctrRequest: {
			reportName: CTR_REPORT,
			indicators: CTR_INDICATORS,
			options: ctrOptions(startDate, asOfDate)
		},
		registrationRequest: { pageSize: 50, fields: REGISTRATION_FIELDS.join(',') }
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

async function fetchRegistrationPage(base, params, fetchImpl = fetch, {
	maxAttempts = 3,
	retryDelayMs = 250
} = {}) {
	const url = choiceUrl(base, '/broker-bond-registrations', params);
	const attempts = Math.max(1, Number(maxAttempts) || 1);
	const delayMs = Math.max(0, Number(retryDelayMs) || 0);
	let lastError;
	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		try {
			const response = await fetchImpl(url, { headers: { Accept: 'application/json' }, cache: 'no-store' });
			if (!response.ok) throw new Error(`DM 券商债券申报请求失败（HTTP ${response.status}）`);
			const page = await response.json();
			if (!page || typeof page.hasNextPage !== 'boolean' || !Array.isArray(page.rows)) {
				throw new Error('DM 券商债券申报返回结构无效');
			}
			return page;
		} catch (error) {
			lastError = error;
			if (attempt < attempts) await wait(delayMs * (2 ** (attempt - 1)));
		}
	}
	throw lastError;
}

async function fetchBrokerBondRegistrations(base, registrationWindow, registrationRequest, fetchImpl, options) {
	const rows = [];
	const maximumPages = 20;
	for (let pageNum = 1; pageNum <= maximumPages; pageNum += 1) {
		const page = await fetchRegistrationPage(base, {
			...registrationWindow,
			...registrationRequest,
			pageNum: String(pageNum),
			pageSize: String(registrationRequest.pageSize)
		}, fetchImpl, options);
		rows.push(...page.rows);
		if (!page.hasNextPage) return { rows, pageCount: pageNum };
	}
	throw new Error(`DM 券商债券申报超过 ${maximumPages} 页，未保存不完整结果`);
}

/**
 * Comparable issuance and registration data are queried only after the user
 * clicks the report button. This module is browser-safe so both requests go
 * straight to the public data Worker instead of nesting subrequests inside
 * financing.
 */
export async function fetchManualLiabilitySources({
	dataApiUrl,
	asOfDate,
	fetchImpl = fetch,
	maxAttempts = 3,
	retryDelayMs = 250
}) {
	if (!dataApiUrl) throw new Error('未配置统一数据 API 地址');
	const { window, registrationWindow, ctrRequest, registrationRequest } = buildManualLiabilityRequests(asOfDate);
	const options = { maxAttempts, retryDelayMs };
	const [ctr, registration] = await Promise.all([Promise.resolve(fetchChoiceTable(
		dataApiUrl,
		'/choice/ctr',
		ctrRequest,
		fetchImpl,
		options
	)).then(
		(value) => ({ status: 'fulfilled', value }),
		(reason) => ({ status: 'rejected', reason })
	), Promise.resolve(fetchBrokerBondRegistrations(
		dataApiUrl,
		registrationWindow,
		registrationRequest,
		fetchImpl,
		options
	)).then(
		(value) => ({ status: 'fulfilled', value }),
		(reason) => ({ status: 'rejected', reason })
	)]);
	return {
		window,
		registrationWindow,
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
			},
		registration: registration.status === 'fulfilled'
			? {
				status: 'available', path: '/broker-bond-registrations',
				request: registrationRequest, fields: REGISTRATION_FIELDS,
				pageCount: registration.value.pageCount, rows: registration.value.rows
			}
			: {
				status: 'missing', path: '/broker-bond-registrations',
				request: registrationRequest,
				error: String(registration.reason?.message ?? registration.reason)
			}
	};
}

function requiredText(value, field) {
	const text = String(value ?? '').trim();
	if (!text || text.length > 500) throw new Error(`DM 券商债券申报字段 ${field} 无效`);
	return text;
}

function optionalText(value, field) {
	if (value === null || value === undefined || value === '') return null;
	const text = String(value).trim();
	if (!text || text.length > 1_000) throw new Error(`DM 券商债券申报字段 ${field} 无效`);
	return text;
}

function registrationAmount(value) {
	if (value === null || value === undefined || value === '') return null;
	const result = Number(value);
	if (!Number.isFinite(result) || result < 0) throw new Error('DM 券商债券申报金额无效');
	return result;
}

function normalizeRegistration(value, registrationWindow, registrationRequest) {
	if (!value || value.status !== 'available') {
		return {
			status: 'missing', path: '/broker-bond-registrations', request: registrationRequest,
			error: String(value?.error ?? '本次尚未手动拉取 DM 券商债券申报。').slice(0, 500)
		};
	}
	if (!Array.isArray(value.fields) || value.fields.join(',') !== REGISTRATION_FIELDS.join(',')) {
		throw new Error('DM 券商债券申报字段列表无效');
	}
	if (!Array.isArray(value.rows) || value.rows.length > 10_000) {
		throw new Error('DM 券商债券申报数据行数无效');
	}
	const unique = new Map();
	for (const row of value.rows) {
		if (!row || Array.isArray(row) || typeof row !== 'object') throw new Error('DM 券商债券申报数据行结构无效');
		const updateDate = requiredText(row.updateDate, 'updateDate');
		if (!/^\d{4}-\d{2}-\d{2}$/.test(updateDate) || updateDate < registrationWindow.startDate || updateDate > registrationWindow.endDate) {
			throw new Error('DM 券商债券申报更新日期超出周报区间');
		}
		const normalized = {
			projectName: requiredText(row.projectName, 'projectName'),
			issuerName: requiredText(row.issuerName, 'issuerName'),
			status: requiredText(row.status, 'status'),
			variety: requiredText(row.variety, 'variety'),
			amountYi: registrationAmount(row.amountYi),
			region: optionalText(row.region, 'region'),
			industry: optionalText(row.industry, 'industry'),
			leadUnderwriter: optionalText(row.leadUnderwriter, 'leadUnderwriter'),
			noticeNumber: optionalText(row.noticeNumber, 'noticeNumber'),
			venue: optionalText(row.venue, 'venue'),
			registrationOrFiling: optionalText(row.registrationOrFiling, 'registrationOrFiling'),
			updateDate
		};
		const key = [normalized.projectName, normalized.status, normalized.updateDate, normalized.noticeNumber ?? ''].join('|');
		unique.set(key, normalized);
	}
	return {
		status: 'available', path: '/broker-bond-registrations', request: registrationRequest,
		fields: REGISTRATION_FIELDS, rows: [...unique.values()]
	};
}

/** Rebuild and validate all browser-supplied report sources before persisting them. */
export function normalizeManualLiabilitySources(value, asOfDate) {
	const { window, registrationWindow, ctrRequest, registrationRequest } = buildManualLiabilityRequests(asOfDate);
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
		registrationWindow,
		ctr: {
			status: 'available', path: '/choice/ctr', request: ctrRequest,
			function: 'CTR', fields, rows
		},
		registration: normalizeRegistration(value?.registration, registrationWindow, registrationRequest)
	};
}
