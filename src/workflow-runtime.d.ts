declare module 'cloudflare:workers' {
	export type WorkflowEvent<T> = {
		payload: Readonly<T>;
		timestamp: Date;
		instanceId: string;
		workflowName: string;
	};

	export type WorkflowStepConfig = {
		retries?: {
			limit: number;
			delay: number | `${number} ${string}`;
			backoff?: 'constant' | 'linear' | 'exponential';
		};
		timeout?: number | `${number} ${string}`;
	};

	export abstract class WorkflowStep {
		do<T>(name: string, callback: () => Promise<T>): Promise<T>;
		do<T>(name: string, config: WorkflowStepConfig, callback: () => Promise<T>): Promise<T>;
	}

	export abstract class WorkflowEntrypoint<Env = unknown, Params = unknown> {
		protected env: Env;
		constructor(ctx: ExecutionContext, env: Env);
		abstract run(event: WorkflowEvent<Params>, step: WorkflowStep): Promise<unknown>;
	}
}

declare module 'cloudflare:workflows' {
	export class NonRetryableError extends Error {
		constructor(message: string, name?: string);
	}
}
