import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('page data preloading waits for an intentional tap instead of link hover', async () => {
	const source = await readFile(new URL('../src/app.html', import.meta.url), 'utf8');
	assert.match(source, /data-sveltekit-preload-data="tap"/);
	assert.doesNotMatch(source, /data-sveltekit-preload-data="hover"/);
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
