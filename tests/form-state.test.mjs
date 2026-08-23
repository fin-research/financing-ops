import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const mutationPages = [
	'src/routes/people/+page.svelte',
	'src/routes/projects/+page.svelte',
	'src/routes/projects/[id]/+page.svelte',
	'src/routes/settings/+page.svelte',
	'src/routes/sop/+page.svelte',
	'src/routes/sop/[id]/+page.svelte'
];

test('route forms never use SvelteKit default form reset outside login', async () => {
	const routesDirectory = new URL('../src/routes/', import.meta.url);
	const routeFiles = (await readdir(routesDirectory, { recursive: true }))
		.map(String)
		.filter((file) => file.endsWith('+page.svelte') && file !== 'login/+page.svelte');
	for (const file of routeFiles) {
		const source = await readFile(new URL(file, routesDirectory), 'utf8');
		assert.doesNotMatch(
			source,
			/await\s+update\(\s*\)\s*;/,
			`src/routes/${file} must explicitly preserve form state instead of calling bare update()`
		);
	}
});

test('SOP and project detail edit forms explicitly preserve their controls', async () => {
	for (const file of [
		'src/routes/projects/[id]/+page.svelte',
		'src/routes/sop/[id]/+page.svelte'
	]) {
		const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
		assert.match(source, /update\(\{\s*reset:\s*false,/);
	}
});
