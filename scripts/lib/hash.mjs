// Local workbook-maintenance helper; never imported by the Worker bundle.
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

const encoder = new TextEncoder();

export function sha256Hex(value) {
	const bytes = typeof value === 'string'
		? encoder.encode(value)
		: value instanceof Uint8Array
			? value
			: new Uint8Array(value);
	return bytesToHex(sha256(bytes));
}
