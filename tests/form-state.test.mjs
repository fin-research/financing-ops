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

const snapshotContracts = [
	{
		name: 'people',
		server: 'src/routes/people/+page.server.ts',
		client: 'src/routes/people/+page.svelte',
		response: /peopleAccess:\s*await getPeopleAccessData\(\)/,
		apply: /result\.data\?\.peopleAccess\?\.people/
	},
	{
		name: 'projects',
		server: 'src/routes/projects/+page.server.ts',
		client: 'src/routes/projects/+page.svelte',
		response: /const refreshed = await getProjectPageData/,
		apply: /result\.data\?\.projects/
	},
	{
		name: 'project detail',
		server: 'src/routes/projects/[id]/+page.server.ts',
		client: 'src/routes/projects/[id]/+page.svelte',
		response: /detail:\s*await loadProject/,
		apply: /result\.data\?\.detail/
	},
	{
		name: 'SOP management',
		server: 'src/routes/sop/+page.server.ts',
		client: 'src/routes/sop/+page.svelte',
		response: /settings:\s*await getWorkflowSettingsData\(\)/,
		apply: /result\.data\?\.settings/
	},
	{
		name: 'profile settings',
		server: 'src/routes/settings/+page.server.ts',
		client: 'src/routes/settings/+page.svelte',
		response: /profile:\s*publicProfile\(/,
		apply: /result\.data\?\.profile/
	}
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

test('mutation pages explicitly choose form reset and invalidation behavior', async () => {
	for (const file of mutationPages) {
		const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
		assert.match(source, /update\(\{\s*reset:/, `${file} must choose reset behavior explicitly`);
	}
});

test('aggregate mutation pages return and apply server-confirmed view data', async () => {
	for (const contract of snapshotContracts) {
		const [serverSource, clientSource] = await Promise.all([
			readFile(new URL(`../${contract.server}`, import.meta.url), 'utf8'),
			readFile(new URL(`../${contract.client}`, import.meta.url), 'utf8')
		]);
		assert.match(serverSource, contract.response, `${contract.name} action must return refreshed view data`);
		assert.match(clientSource, contract.apply, `${contract.name} page must apply action response data immediately`);
	}
});

test('granular mutation pages merge confirmed entities around global invalidation', async () => {
	const source = await readFile(new URL('../src/routes/sop/[id]/+page.svelte', import.meta.url), 'utf8');
	assert.match(
		source,
		/if \(responseIsCurrent\) applyActionData\(result\.data\);\s*await update\(\{ reset: false, invalidateAll: responseIsCurrent \}\);\s*if \(responseIsCurrent\) applyActionData\(result\.data\);/
	);
});

test('project and SOP edit forms auto-save without per-item save buttons', async () => {
	const [projects, projectDetail, sopDetail, autoSave] = await Promise.all([
		readFile(new URL('../src/routes/projects/+page.svelte', import.meta.url), 'utf8'),
		readFile(new URL('../src/routes/projects/[id]/+page.svelte', import.meta.url), 'utf8'),
		readFile(new URL('../src/routes/sop/[id]/+page.svelte', import.meta.url), 'utf8'),
		readFile(new URL('../src/lib/auto-save.ts', import.meta.url), 'utf8')
	]);

	assert.match(projects, /action="\?\/updateProject" use:autoSave use:enhance=/);
	assert.match(projectDetail, /action="\?\/updateTask"[\s\S]*?use:autoSave=/);
	assert.match(projectDetail, /action="\?\/updateProject"[\s\S]*?use:autoSave=/);
	assert.match(sopDetail, /action="\?\/updateNode"[\s\S]*?use:autoSave/);
	assert.match(sopDetail, /action="\?\/updateTemplate" use:autoSave use:enhance=/);
	assert.doesNotMatch(projectDetail, /保存基本信息|>保存</);
	assert.doesNotMatch(sopDetail, /保存模板信息|class="save-button"/);
	assert.match(autoSave, /let inFlight = false/);
	assert.match(autoSave, /revisionOf\(form\) > submittedRevision/);
	assert.match(autoSave, /form\.requestSubmit\(\)/);
});

test('new financing projects use one bookbuilding date anchored to SOP issue day', async () => {
	const [page, server] = await Promise.all([
		readFile(new URL('../src/routes/projects/+page.svelte', import.meta.url), 'utf8'),
		readFile(new URL('../src/routes/projects/+page.server.ts', import.meta.url), 'utf8')
	]);

	assert.doesNotMatch(page, /name="borrower"|name="startDate"|name="endDate"/);
	assert.match(page, /<span>计划簿记<\/span>\s*<input name="plannedBookbuildingDate" type="date"/);
	assert.match(server, /const plannedBookbuildingDate = projectBookbuildingDate\(data\)/);
	assert.match(server, /planned_start_date, planned_issue_date/);
	assert.match(server, /offsetDate\(plannedBookbuildingDate, Number\(node\.offsetDays\)\)/);
	assert.match(server, /default_offset_days = 0/);
});

test('Data API mutations request returned rows and merge them without a reload', async () => {
	const [apiSource, tableSource] = await Promise.all([
		readFile(new URL('../src/lib/neon-data-api.ts', import.meta.url), 'utf8'),
		readFile(new URL('../src/lib/DataAdminTable.svelte', import.meta.url), 'utf8')
	]);
	assert.ok((apiSource.match(/Prefer: 'return=representation'/g) ?? []).length >= 3);
	assert.match(tableSource, /rows = sortCurrentRows\(\[savedRows\[0\], \.\.\.rows\]\)/);
	assert.match(tableSource, /rows = sortCurrentRows\(rows\.map\(/);
	assert.match(tableSource, /rows = rows\.filter\(/);
});
