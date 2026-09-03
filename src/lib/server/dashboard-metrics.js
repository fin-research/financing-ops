export const SHORT_DEBT_MAX_ORIGINAL_TERM_DAYS = 365;

export function reportingTypeSql(alias = 'd') {
	return `COALESCE(NULLIF(${alias}.subtype, ''), ${alias}.debt_type)`;
}

export function selectedDebtTypePredicateSql(alias = 'd', selectedTypesExpression = 'args.selected_types') {
	return `(cardinality(${selectedTypesExpression}) = 0
		OR ${reportingTypeSql(alias)} = ANY(${selectedTypesExpression}))`;
}

/**
 * @param {{ debtType: string, amountYi?: number | null }[]} projects
 * @param {string[]} [selectedTypes]
 */
export function projectAmountYiForTypes(projects, selectedTypes = []) {
	const selected = new Set(selectedTypes);
	return projects.reduce((sum, project) => (
		selected.size === 0 || selected.has(project.debtType)
			? sum + Number(project.amountYi ?? 0)
			: sum
	), 0);
}

export function currentYearBorrowingPredicateSql(alias = 'd', asOfExpression = 'latest.as_of_date') {
	return `${alias}.issue_date >= date_trunc('year', ${asOfExpression})::date
		AND ${alias}.issue_date <= ${asOfExpression}`;
}

export function shortDebtPredicateSql(alias = 'd') {
	return `COALESCE(${alias}.term_days, ${alias}.maturity_date - ${alias}.issue_date) <= ${SHORT_DEBT_MAX_ORIGINAL_TERM_DAYS}`;
}
