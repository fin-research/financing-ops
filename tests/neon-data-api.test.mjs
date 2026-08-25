import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function loadNeonDataApi() {
	const source = await readFile(new URL('../src/lib/neon-data-api.ts', import.meta.url), 'utf8');
	const isolated = source.replace(
		"import { withBase } from './app-paths';",
		"const withBase = (path) => `/financing${path}`;"
	);
	const output = ts.transpileModule(isolated, {
		compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
	}).outputText;
	return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}#${Date.now()}`);
}

const entity = {
	tableName: 'debt',
	fields: [{ key: 'id' }],
	primaryKeys: ['id'],
	searchFields: []
};

const listOptions = {
	page: 0,
	pageSize: 50,
	sortKey: 'id',
	sortDirection: 'asc',
	search: ''
};

test('data client obtains and reuses the token and HTTPS endpoint together', async () => {
	const { NeonDataApi } = await loadNeonDataApi();
	const originalFetch = globalThis.fetch;
	const calls = [];
	globalThis.fetch = async (input, init = {}) => {
		const url = String(input);
		calls.push({ url, headers: new Headers(init.headers) });
		if (url === '/financing/data/token') {
			return Response.json({ token: 'token-one', dataApiUrl: 'https://data.example.test/' });
		}
		return new Response(JSON.stringify([{ id: 1 }]), {
			headers: { 'content-type': 'application/json', 'content-range': '0-0/1' }
		});
	};

	try {
		const api = new NeonDataApi();
		assert.deepEqual(await api.list(entity, listOptions), { rows: [{ id: 1 }], total: 1 });
		assert.deepEqual(await api.list(entity, listOptions), { rows: [{ id: 1 }], total: 1 });
		assert.equal(calls.filter((call) => call.url === '/financing/data/token').length, 1);
		assert.match(calls[1].url, /^https:\/\/data\.example\.test\/debt\?/);
		assert.equal(calls[1].headers.get('authorization'), 'Bearer token-one');
		assert.equal(calls[1].headers.get('accept-profile'), 'financing');
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test('data client refreshes both token and endpoint once after a 401', async () => {
	const { NeonDataApi } = await loadNeonDataApi();
	const originalFetch = globalThis.fetch;
	const apiCalls = [];
	let tokenCalls = 0;
	globalThis.fetch = async (input, init = {}) => {
		const url = String(input);
		if (url === '/financing/data/token') {
			tokenCalls += 1;
			return Response.json({
				token: `token-${tokenCalls}`,
				dataApiUrl: `https://data-${tokenCalls}.example.test`
			});
		}
		apiCalls.push({ url, authorization: new Headers(init.headers).get('authorization') });
		if (apiCalls.length === 1) return new Response('{}', { status: 401 });
		return new Response(JSON.stringify([{ id: 2 }]), {
			headers: { 'content-type': 'application/json', 'content-range': '0-0/1' }
		});
	};

	try {
		const api = new NeonDataApi();
		assert.deepEqual(await api.list(entity, listOptions), { rows: [{ id: 2 }], total: 1 });
		assert.equal(tokenCalls, 2);
		assert.deepEqual(apiCalls, [
			{ url: apiCalls[0].url, authorization: 'Bearer token-1' },
			{ url: apiCalls[1].url, authorization: 'Bearer token-2' }
		]);
		assert.match(apiCalls[0].url, /^https:\/\/data-1\.example\.test\/debt\?/);
		assert.match(apiCalls[1].url, /^https:\/\/data-2\.example\.test\/debt\?/);
	} finally {
		globalThis.fetch = originalFetch;
	}
});
