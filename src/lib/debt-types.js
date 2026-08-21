export const DEBT_TYPES = Object.freeze([
	{ type: '收益凭证', subtype: '浮动收益凭证', label: '浮动收益凭证' },
	{ type: '收益凭证', subtype: '固定收益凭证', label: '固定收益凭证' },
	{ type: '债券', subtype: '小公募', label: '小公募' },
	{ type: '债券', subtype: '次级债', label: '次级债' },
	{ type: '债券', subtype: '私募债', label: '私募债' },
	{ type: '债券', subtype: '科创债', label: '科创债' },
	{ type: '债券', subtype: '短期融资券', label: '短期融资券' },
	{ type: '转融资', subtype: null, label: '转融资' },
	{ type: '集团借款', subtype: null, label: '集团借款' },
	{ type: '同业拆借', subtype: null, label: '同业拆借' },
	{ type: '收益权转让', subtype: null, label: '收益权转让' },
	{ type: '互换便利', subtype: null, label: '互换便利' }
]);

export const REPORTING_DEBT_TYPES = Object.freeze(DEBT_TYPES.map((item) => item.label));

/** @param {string} label */
export function debtTypeParts(label) {
	const configured = DEBT_TYPES.find((item) => item.label === label);
	return configured ? { debtType: configured.type, subtype: configured.subtype } : { debtType: label, subtype: null };
}
