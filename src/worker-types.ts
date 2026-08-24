import type { Fetcher, Hyperdrive } from '@cloudflare/workers-types';

export interface FinancingWorkerEnv {
	HYPERDRIVE: Hyperdrive;
	ASSETS: Fetcher;
	NEON_AUTH_URL: string;
	RESEND_API_KEY?: string;
	FROM_EMAIL?: string;
}
