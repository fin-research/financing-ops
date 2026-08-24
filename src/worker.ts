import type { ExportedHandler } from '@cloudflare/workers-types';
import svelteKitWorker from 'sveltekit-worker';
import { runScheduledReminderCheck } from './lib/server/reminder-scheduler.js';
import type { FinancingWorkerEnv } from './worker-types.js';

const worker = {
	fetch(request, env, ctx) {
		if (typeof svelteKitWorker.fetch !== 'function') {
			throw new Error('SvelteKit Worker fetch handler is unavailable');
		}
		return svelteKitWorker.fetch(request, env, ctx);
	},
	async scheduled(controller, env) {
		const summary = await runScheduledReminderCheck({
			scheduledTime: controller.scheduledTime,
			env
		});
		console.log(JSON.stringify(summary));
	}
} satisfies ExportedHandler<FinancingWorkerEnv>;

export default worker;
