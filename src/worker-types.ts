import type { Fetcher, Hyperdrive, R2Bucket, Workflow } from '@cloudflare/workers-types';
import type { DebtImportWorkflowParams } from './workflows/debt-import.js';

export interface FinancingWorkerEnv {
	HYPERDRIVE: Hyperdrive;
	ASSETS: Fetcher;
	LIABILITY_REPORT_SNAPSHOTS: R2Bucket;
	DEBT_IMPORT_WORKFLOW: Workflow<DebtImportWorkflowParams>;
	NEON_AUTH_URL: string;
	CHOICE_DATA_API_URL?: string;
	RESEND_API_KEY?: string;
	FROM_EMAIL?: string;
}
