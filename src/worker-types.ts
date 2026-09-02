import type { Fetcher, Hyperdrive, R2Bucket } from '@cloudflare/workers-types';

export interface FinancingWorkerEnv {
	HYPERDRIVE: Hyperdrive;
	ASSETS: Fetcher;
	LIABILITY_REPORT_SNAPSHOTS: R2Bucket;
	NEON_AUTH_URL: string;
	CHOICE_DATA_API_URL?: string;
	RESEND_API_KEY?: string;
	FROM_EMAIL?: string;
}
