import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('page data preloading uses tap globally and hover only for fixed navigation', async () => {
	const [app, layout] = await Promise.all([
		readFile(new URL('../src/app.html', import.meta.url), 'utf8'),
		readFile(new URL('../src/routes/+layout.svelte', import.meta.url), 'utf8')
	]);
	assert.match(app, /data-sveltekit-preload-data="tap"/);
	assert.doesNotMatch(app, /data-sveltekit-preload-data="hover"/);
	assert.equal((layout.match(/data-sveltekit-preload-data="hover"/g) ?? []).length, 2);
	assert.equal((layout.match(/data-sveltekit-preload-code="viewport"/g) ?? []).length, 2);
	assert.match(layout, /preloadData\(withBase\(href\)\)/);
	assert.match(layout, /onfocus=\{\(\) => preloadNavigation\(item\.href\)\}/);
});

test('slow navigations expose pending and accessible loading states', async () => {
	const [layout, styles] = await Promise.all([
		readFile(new URL('../src/routes/+layout.svelte', import.meta.url), 'utf8'),
		readFile(new URL('../src/routes/layout.css', import.meta.url), 'utf8')
	]);
	assert.match(layout, /import \{ navigating, page \} from '\$app\/state'/);
	assert.match(layout, /setTimeout\(\(\) => \(navigationSlow = true\), 300\)/);
	assert.match(layout, /class:pending=\{isPending\(item\.href\)\}/);
	assert.match(layout, /role="progressbar" aria-label="页面加载中"/);
	assert.match(layout, /aria-busy=\{Boolean\(navigating\.to\)\}/);
	assert.match(styles, /\.navigation-progress::after/);
	assert.match(styles, /@keyframes navigation-progress/);
});

test('authenticated page loads do not transfer the base64 avatar through locals', async () => {
	const [auth, layout, avatar] = await Promise.all([
		readFile(new URL('../src/lib/server/auth.js', import.meta.url), 'utf8'),
		readFile(new URL('../src/routes/+layout.svelte', import.meta.url), 'utf8'),
		readFile(new URL('../src/routes/avatar/+server.ts', import.meta.url), 'utf8')
	]);
	assert.doesNotMatch(auth, /avatar_data_url AS avatarDataUrl/);
	assert.match(auth, /avatar_data_url IS NOT NULL AS hasAvatar/);
	assert.match(layout, /withBase\('\/avatar'\)/);
	assert.match(avatar, /Cache-Control': 'private, max-age=31536000, immutable'/);
});

test('reminder history is cursor-paginated in bounded batches', async () => {
	const [page, endpoint, query] = await Promise.all([
		readFile(new URL('../src/routes/sop/reminders/+page.server.ts', import.meta.url), 'utf8'),
		readFile(new URL('../src/routes/sop/reminders/more/+server.ts', import.meta.url), 'utf8'),
		readFile(new URL('../src/lib/server/queries.js', import.meta.url), 'utf8')
	]);
	assert.match(page, /limit: 50/);
	assert.match(endpoint, /includeSummary: false/);
	assert.match(query, /nextCursor/);
	assert.match(query, /safeLimit \+ 1/);
});

test('authenticated GET navigation reuses a bounded server-side session decision', async () => {
	const [hooks, auth, cache] = await Promise.all([
		readFile(new URL('../src/hooks.server.ts', import.meta.url), 'utf8'),
		readFile(new URL('../src/lib/server/auth.js', import.meta.url), 'utf8'),
		readFile(new URL('../src/lib/server/auth-cache.js', import.meta.url), 'utf8')
	]);
	assert.match(hooks, /useSessionCache: safeRequest && routeId !== '\/data\/token'/);
	assert.match(hooks, /!safeRequest\) await invalidateCachedSession/);
	assert.match(auth, /readCachedSessionUser/);
	assert.match(cache, /CACHE_TTL_SECONDS = 60/);
	assert.match(cache, /crypto\.subtle\.digest\('SHA-256'/);
	assert.doesNotMatch(cache, /Map\s*\(/);
	assert.match(hooks, /queryCount/);
});

test('page loads defer form-only options and remove duplicate identity queries', async () => {
	const [projectsPage, projectOptions, projectComponent, settingsPage, settingsComponent, sopDetail] = await Promise.all([
		readFile(new URL('../src/routes/projects/+page.server.ts', import.meta.url), 'utf8'),
		readFile(new URL('../src/routes/projects/options/+server.ts', import.meta.url), 'utf8'),
		readFile(new URL('../src/routes/projects/+page.svelte', import.meta.url), 'utf8'),
		readFile(new URL('../src/routes/settings/+page.server.ts', import.meta.url), 'utf8'),
		readFile(new URL('../src/routes/settings/+page.svelte', import.meta.url), 'utf8'),
		readFile(new URL('../src/routes/sop/[id]/+page.server.ts', import.meta.url), 'utf8')
	]);
	assert.doesNotMatch(projectsPage, /getProjectFormOptions|getActiveProjectSopOptions/);
	assert.match(projectOptions, /getProjectFormOptions/);
	assert.match(projectComponent, /fetch\(withBase\('\/projects\/options'\)/);
	assert.doesNotMatch(settingsPage, /export const load/);
	assert.match(settingsComponent, /data\.user\?\.personName/);
	assert.match(sopDetail, /async function loadSopDetail/);
	assert.match(sopDetail, /jsonb_agg\(jsonb_build_object/);
});

test('data administration gets its endpoint with the private token request', async () => {
	const [endpoint, client, page, table, importer] = await Promise.all([
		readFile(new URL('../src/routes/data/token/+server.ts', import.meta.url), 'utf8'),
		readFile(new URL('../src/lib/neon-data-api.ts', import.meta.url), 'utf8'),
		readFile(new URL('../src/routes/data/+page.svelte', import.meta.url), 'utf8'),
		readFile(new URL('../src/lib/DataAdminTable.svelte', import.meta.url), 'utf8'),
		readFile(new URL('../src/lib/DebtImportPanel.svelte', import.meta.url), 'utf8')
	]);
	await assert.rejects(
		readFile(new URL('../src/routes/data/+page.server.ts', import.meta.url), 'utf8'),
		(error) => error?.code === 'ENOENT'
	);
	assert.match(endpoint, /\{ token, dataApiUrl: getDataApiUrl\(\) \}/);
	assert.match(endpoint, /'cache-control': 'no-store, private'/);
	assert.match(endpoint, /vary: 'Cookie'/);
	assert.match(client, /dataApiUrl\?: string/);
	assert.match(client, /parsed\.protocol !== 'https:'/);
	assert.match(page, /<DataAdminTable \/>/);
	assert.match(page, /data\.user\?\.role === 'admin'/);
	assert.match(page, /<DebtImportPanel \/>/);
	assert.match(table, /new NeonDataApi\(\)/);
	assert.doesNotMatch(page, /dataApiUrl/);
	assert.match(importer, /fetch\(withBase\('\/data\/import'\)/);
	assert.match(importer, /function schedulePoll\(runId: string, delay = 1500\)/);
	assert.match(importer, /if \(\['parsing', 'queued', 'running'\]\.includes\(payload\.run\.status\)\)/);
});

test('liability report page reads one snapshot and generation splits business and raw market Data API reads', async () => {
	const [page, service, client, layout] = await Promise.all([
		readFile(new URL('../src/routes/liability-report/+page.server.ts', import.meta.url), 'utf8'),
		readFile(new URL('../src/lib/server/liability-weekly-reports.js', import.meta.url), 'utf8'),
		readFile(new URL('../src/lib/neon-data-api.ts', import.meta.url), 'utf8'),
		readFile(new URL('../src/routes/+layout.svelte', import.meta.url), 'utf8')
	]);
	assert.match(page, /getLiabilityWeeklyReportRunByDate\(database, selectedReportDate\)/);
	assert.match(page, /if \(selectedRun && platform\?\.env\?\.LIABILITY_REPORT_SNAPSHOTS\)/);
	assert.doesNotMatch(page, /getLiabilityWeeklyReportData|fetchManualLiabilitySources|liabilityWeeklyReport\(/);
	assert.equal((service.match(/database\.prepare\(/g) ?? []).length, 3);
	assert.match(service, /WHERE as_of_date = \? AND status = 'complete'[\s\S]*updated_at <= CURRENT_TIMESTAMP/);
	assert.match(client, /#request\('rpc\/liability_weekly_report_data'/);
	assert.match(client, /#request\(`liability_market_rate_observations\?\$\{params\}`\)/);
	assert.match(layout, /const neonDataApi = new NeonDataApi\(\)/);
	assert.match(layout, /const marketRatesRequest = neonDataApi\.liabilityMarketRates\(asOfDate\)\.then\(/);
	assert.match(layout, /Promise\.all\(\[[\s\S]*fetchManualLiabilitySources[\s\S]*liabilityWeeklyReportBusiness[\s\S]*marketRatesRequest/);
	assert.match(layout, /attachLiabilityMarketRates\([\s\S]*marketRatesResult\.rows,[\s\S]*marketRatesResult\.error/);
	assert.match(layout, /await update\(\{ reset: false, invalidateAll: false \}\)/);
	assert.match(page, /snapshotVersion: report \? selectedRun\?\.contentSha256 \?\? null : null/);
	assert.match(layout, /await goto\(reportUrl, \{[\s\S]*invalidateAll: true[\s\S]*replaceState: true[\s\S]*noScroll: true/);
	assert.match(layout, /page\.data as any\)\?\.snapshotVersion[\s\S]*window\.location\.replace\(reportUrl\)/);
	assert.match(layout, /sessionStorage\.setItem\(REPORT_NOTICE_KEY/);
});
