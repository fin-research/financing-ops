import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { NonRetryableError } from 'cloudflare:workflows';
import { createPostgresDatabase } from '../lib/postgres.js';
import {
	completeDebtImportRun,
	failDebtImportRun,
	getDebtImportPayload,
	updateDebtImportStage
} from '../lib/server/debt-import-runs.js';
import {
	importDebtWorkbook,
	refreshDebtImportDerivatives
} from '../lib/server/debt-importer.js';
import type { FinancingWorkerEnv } from '../worker-types.js';

export interface DebtImportWorkflowParams {
	runId: string;
}

async function withDatabase<T>(
	env: FinancingWorkerEnv,
	applicationName: string,
	callback: (database: ReturnType<typeof createPostgresDatabase>) => Promise<T>
) {
	const database = createPostgresDatabase(env.HYPERDRIVE.connectionString, applicationName);
	try {
		return await callback(database);
	} finally {
		await database.close();
	}
}

function userFacingWorkflowError(error: unknown, stage: string) {
	const message = error instanceof Error ? error.message : String(error);
	if (/^(余额核对失败|已有负债的继承类型与工作簿不一致)/u.test(message)) {
		return message;
	}
	if (stage === 'refreshing') return '负债数据已写入，但衍生指标刷新失败；请重新上传或联系管理员';
	if (stage === 'importing') return '线上数据库更新失败；Workflow 已重试，请联系管理员查看运行日志';
	return '导入任务执行失败，请联系管理员查看 Workflow 运行日志';
}

export class DebtImportWorkflow extends WorkflowEntrypoint<FinancingWorkerEnv, DebtImportWorkflowParams> {
	async run(event: WorkflowEvent<DebtImportWorkflowParams>, step: WorkflowStep) {
		const { runId } = event.payload;
		let activeStage = 'importing';
		try {
			const importResult = await step.do('import validated debt ledger', {
				retries: { limit: 3, delay: '10 seconds', backoff: 'exponential' },
				timeout: '20 minutes'
			}, async () => withDatabase(
				this.env,
				'eastmoney-financing-debt-import',
				async (database) => {
					await updateDebtImportStage(database, runId, {
						stage: 'importing',
						progress: 65,
						message: '正在原子更新负债、现金流与余额历史'
					});
					const payload = await getDebtImportPayload(database, runId);
					if (!payload) throw new NonRetryableError('导入临时数据不存在或已被清理');
					return importDebtWorkbook(database, payload);
				}
			));

			activeStage = 'refreshing';
			const derivativeResult = await step.do('refresh debt derivatives', {
				retries: { limit: 3, delay: '10 seconds', backoff: 'exponential' },
				timeout: '20 minutes'
			}, async () => withDatabase(
				this.env,
				'eastmoney-financing-debt-derivatives',
				async (database) => {
					await updateDebtImportStage(database, runId, {
						stage: 'refreshing',
						progress: 88,
						message: '正在重算月度融资衍生指标'
					});
					return refreshDebtImportDerivatives(database, importResult.asOfDate);
				}
			));

			activeStage = 'finalizing';
			return await step.do('finalize debt import', {
				retries: { limit: 3, delay: '5 seconds', backoff: 'exponential' }
			}, async () => withDatabase(
				this.env,
				'eastmoney-financing-debt-import-finalize',
				async (database) => {
					await updateDebtImportStage(database, runId, {
						stage: 'finalizing',
						progress: 96,
						message: '正在保存核对结果并清理临时数据'
					});
					return completeDebtImportRun(database, runId, importResult, derivativeResult);
				}
			));
		} catch (error) {
			const safeMessage = userFacingWorkflowError(error, activeStage);
			try {
				await step.do('mark debt import failed', {
					retries: { limit: 3, delay: '5 seconds', backoff: 'exponential' }
				}, async () => withDatabase(
					this.env,
					'eastmoney-financing-debt-import-failed',
					(database) => failDebtImportRun(database, runId, safeMessage)
				));
			} catch (statusError) {
				console.error('Failed to persist debt import failure status', statusError);
			}
			throw error;
		}
	}
}
