const BOND_SUBTYPES = new Set(['小公募', '私募债', '次级债', '短期融资券', '科创债', '公司债']);

function normalise(value) {
	return String(value ?? '').replace(/[\s\r\n（）()【】\[\]：:，,\-—_]/g, '').toLowerCase();
}

function text(value) {
	if (value == null) return null;
	const result = String(value).trim();
	return !result || result === '-' || result === '—' || result === '/' ? null : result;
}

function number(value) {
	const candidate = text(value);
	if (!candidate) return null;
	const result = Number(candidate.replace(/[,，\s元]/g, '').replace(/[％%]/g, ''));
	return Number.isFinite(result) ? result : null;
}

function integer(value) {
	const result = number(value);
	return result == null ? null : Math.trunc(result);
}

function rate(value) {
	const result = number(value);
	if (result == null) return null;
	return /[%％]/.test(String(value)) || result > 1 ? result / 100 : result;
}

function date(value) {
	const candidate = text(value);
	if (!candidate) return null;
	const yearFirst = candidate.match(/^(\d{4})[./年-](\d{1,2})[./月-](\d{1,2})/);
	const monthFirst = candidate.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
	if (!yearFirst && !monthFirst) return null;
	const [, first, second, third] = yearFirst ?? monthFirst;
	const [year, month, day] = yearFirst
		? [first, second, third]
		: [third.length === 2 ? String(2000 + Number(third)) : third, first, second];
	return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

function boolean(value) {
	const candidate = normalise(value);
	if (!candidate) return null;
	if (['是', 'true', 'yes', 'y', '1', '已'].includes(candidate)) return true;
	if (['否', 'false', 'no', 'n', '0', '未'].includes(candidate)) return false;
	return null;
}

function value(fields, ...names) {
	for (const name of names) {
		const result = fields.get(normalise(name));
		if (result != null && String(result).trim() !== '') return result;
	}
	return null;
}

function recordsBySourceKey(parsed) {
	const definitions = new Map();
	for (const [debtType, fieldOrder, fieldName] of parsed.definitions) {
		if (!definitions.has(debtType)) definitions.set(debtType, new Map());
		definitions.get(debtType).set(fieldOrder, fieldName);
	}
	const debtTypes = new Map(parsed.debts.map((row) => [row[1], row[2]]));
	return new Map(parsed.recordGroups.map(([sourceKey, rawRecords]) => {
		const fieldDefinitions = definitions.get(debtTypes.get(sourceKey)) ?? new Map();
		return [sourceKey, rawRecords.map(([sequence, values]) => {
			const fields = new Map();
			const orders = new Map();
			for (const [fieldOrder, fieldName] of fieldDefinitions) {
				if (values[fieldOrder] == null) continue;
				fields.set(normalise(fieldName), values[fieldOrder]);
				orders.set(fieldOrder, values[fieldOrder]);
			}
			return { sequence, fields, orders };
		})];
	}));
}

function displayName({ oldType, instrumentName, instrumentCode, counterparty, issueDate, main }) {
	if (BOND_SUBTYPES.has(oldType)) {
		return text(value(main, '债券简称')) ?? instrumentName ?? instrumentCode ?? `${oldType}·${issueDate ?? '未定期'}`;
	}
	if (oldType === '收益凭证') {
		const raw = text(value(main, '系列')) ?? instrumentName;
		return raw?.replace(/^东方财富证券(?:股份有限公司)?/u, '') || `收益凭证·${issueDate ?? '未定期'}`;
	}
	if (oldType === '收益权转让') {
		return text(value(main, '期数')) ?? instrumentName ?? `收益权·${issueDate ?? '未定期'}`;
	}
	if (oldType === '同业拆借') return `同业拆借·${counterparty ?? '未登记对手'}·${issueDate ?? '未定期'}`;
	if (oldType === '转融资') return `转融资·${counterparty ?? text(value(main, '市场')) ?? '未登记对手'}·${issueDate ?? '未定期'}`;
	if (oldType === '集团借款') return `集团借款·${text(value(main, '借款对象')) ?? counterparty ?? '未登记对手'}·${issueDate ?? '未定期'}`;
	if (oldType === '互换便利') return `互换便利·${issueDate ?? date(value(main, '首次正回购日期')) ?? '未定期'}`;
	return instrumentName ?? instrumentCode ?? `${oldType}·${issueDate ?? '未定期'}`;
}

function commonDebt(row, records) {
	const [
		_sourceId, sourceKey, oldType, categoryLevel1, categoryLevel2, instrumentName,
		instrumentCode, _borrower, oldCounterparty, principalAmount, outstandingAmount,
		_currency, annualRate, oldIssueDate, oldMaturityDate, oldStatus
	] = row;
	const main = records[0]?.fields ?? new Map();
	const isBond = BOND_SUBTYPES.has(oldType);
	const debtType = isBond ? '债券' : oldType;
	const subtype = isBond ? oldType : oldType === '收益凭证' ? (categoryLevel2 ?? '固定收益凭证') : null;
	const counterparty = oldType === '收益凭证'
		? text(value(main, '投资者类型')) ?? text(oldCounterparty)
		: oldType === '集团借款'
			? text(value(main, '借款对象')) ?? text(oldCounterparty)
			: text(oldCounterparty);
	// The online debt contract labels these fields as 起息日/到期日. For
	// income certificates, keep the parser's mapped dates (起息日/到期日)
	// instead of the adjacent 认购日/兑付日 fields, so updates match the
	// existing Neon rows and do not duplicate the historical ledger.
	const issueDate = oldType === '互换便利'
		? date(value(main, '首次正回购日期')) ?? oldIssueDate
		: oldIssueDate;
	const maturityDate = oldMaturityDate;
	const interestPayable = isBond
		? number(value(main, '应付利息（元）'))
		: oldType === '收益凭证' ? number(value(main, '应付利息（元）'))
			: oldType === '收益权转让' ? number(value(main, '应付利息（元）'))
				: oldType === '同业拆借' ? number(value(main, '应付利息（元）'))
					: oldType === '转融资' ? number(value(main, '应付利息（元）')) : null;
	const resolvedRate = oldType === '互换便利'
		? rate(value(main, '综合融资利率')) ?? annualRate
		: annualRate;
	return {
		sourceKey,
		table: isBond ? 'bond'
			: oldType === '收益凭证' ? 'income_certificate'
				: oldType === '收益权转让' ? 'income_right'
					: oldType === '转融资' ? 'refinancing'
						: oldType === '互换便利' ? 'swap_facility' : 'debt',
		debtType,
		subtype,
		name: displayName({ oldType, instrumentName: text(instrumentName), instrumentCode: text(instrumentCode), counterparty, issueDate, main }),
		counterparty,
		amount: Number(outstandingAmount ?? principalAmount ?? 0),
		// Match the existing SQLite-to-Postgres migration contract: negative
		// accrued interest is not payable and is stored as zero.
		interestPayable: Math.max(Number(interestPayable ?? 0), 0),
		annualRate: resolvedRate == null ? null : Number(resolvedRate),
		issueDate: issueDate ?? null,
		maturityDate: maturityDate ?? null,
		activatedAt: oldStatus === 'planned' ? null : (issueDate ?? null),
		settledAt: oldStatus === 'matured' ? (maturityDate ?? issueDate ?? null) : null,
		closedAt: oldStatus === 'closed' ? (maturityDate ?? issueDate ?? null) : null,
		extension: isBond ? {
			issuanceMethod: text(value(main, '发行方式')),
			bookbuildingDate: date(value(main, '簿记日', '簿记/发行日')),
			interestBasis: text(value(main, '年化计息天数(天)', '年化计息天数(月/天)')),
			issuanceTarget: text(value(main, '发行对象')),
			market: text(value(main, '市场')),
			receivingAccount: text(value(main, '收款账户')),
			trustee: text(value(main, '受托管理人')),
			bookrunner: text(value(main, '簿记管理人'))
		} : oldType === '收益凭证' ? {
			liquidationSubmissionStatus: text(value(main, '清盘提交')),
			liquidationRegistrationStatus: text(value(main, '清盘注册')),
			returnType: text(value(main, '收益类型')),
			receivingAccount: text(value(main, '收款账户')),
			earlyMaturity: boolean(value(main, '是否提前到期'))
		} : oldType === '收益权转让' ? {
			interestBasisDays: integer(value(main, '年化计息天数'))
		} : oldType === '转融资' ? {
			interestBasisDays: integer(value(main, '年化计息天数（天）')),
			market: text(value(main, '市场')),
			isExtended: boolean(value(main, '是否展期')),
			receivingAccount: text(value(main, '收款账户')),
			repaymentAccount: text(value(main, '还款账户'))
		} : oldType === '互换便利' ? {
			averageRepoBalanceDescription: text(value(main, '正回购日均余额（元）')),
			repoWeightedAverageRate: rate(value(main, '正回购加权平均利率'))
		} : {}
	};
}

export function transformWorkbook(parsed) {
	const records = recordsBySourceKey(parsed);
	const debts = parsed.debts.map((row) => commonDebt(row, records.get(row[1]) ?? []));
	const cashflows = parsed.cashflows.map(([_eventKey, sourceKey, eventType, eventDate, amount, sourceSequence]) => ({
		sourceKey,
		cashflowType: eventType,
		dueDate: eventDate,
		// Cashflow amounts are unsigned in the financing schema; preserve the
		// historical migration behavior for source rows containing losses.
		amount: amount == null ? null : Math.abs(Number(amount)),
		sourceSequence: Number(sourceSequence ?? 0),
		paidAmount: null,
		paidAt: null,
		accrualStartDate: null,
		accrualEndDate: null,
		note: null
	}));

	for (const debt of debts.filter((item) => item.debtType === '集团借款')) {
		for (const record of records.get(debt.sourceKey) ?? []) {
			const supplementalDate = date(record.orders.get(12));
			const supplementalAmount = number(record.orders.get(15));
			if (!supplementalDate || supplementalAmount == null) continue;
			cashflows.push({
				sourceKey: debt.sourceKey,
				cashflowType: 'supplemental',
				dueDate: supplementalDate,
				amount: supplementalAmount,
				sourceSequence: record.sequence,
				paidAmount: null,
				paidAt: null,
				accrualStartDate: null,
				accrualEndDate: date(record.orders.get(6)),
				note: text(record.orders.get(14))
			});
		}
	}

	const byDebt = new Map();
	for (const flow of cashflows) {
		const values = byDebt.get(flow.sourceKey) ?? [];
		values.push(flow);
		byDebt.set(flow.sourceKey, values);
	}
	for (const values of byDebt.values()) {
		values.sort((left, right) => left.dueDate.localeCompare(right.dueDate)
			|| left.cashflowType.localeCompare(right.cashflowType)
			|| left.sourceSequence - right.sourceSequence);
		values.forEach((flow, index) => { flow.sequence = index + 1; });
	}

	const balances = parsed.balances.map(([asOfDate, oldType, balanceYi]) => ({
		asOfDate,
		debtType: BOND_SUBTYPES.has(oldType) ? '债券' : oldType,
		subtype: BOND_SUBTYPES.has(oldType) ? oldType : '',
		amount: Number(balanceYi) * 100_000_000
	}));
	return { debts, cashflows, balances, snapshot: parsed.snapshot };
}
