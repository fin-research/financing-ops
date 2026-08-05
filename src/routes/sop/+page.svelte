<script lang="ts">
	import '../management.css';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import {
		ArrowRight,
		BellRing,
		CheckCircle2,
		GitBranch,
		LoaderCircle,
		Mail,
		Plus,
		UserRound,
		Users,
		Workflow
	} from '@lucide/svelte';

	let { data } = $props();
	let reminderDialog: HTMLDialogElement;
	let sopDialog: HTMLDialogElement;
	let reminderRecipientMode = $state('assignee');
	let actionState = $state<{
		key: string;
		status: 'idle' | 'pending' | 'success' | 'error';
		message: string;
	}>({ key: '', status: 'idle', message: '' });

	const fallback = {
		sopTemplates: [],
		reminderRules: []
	};
	const settings = $derived(data?.settings ?? fallback);
	const activeSopTemplates = $derived(
		settings.sopTemplates.filter((sop: { isActive: boolean }) => sop.isActive)
	);

	const enhanceAction = (key: string, successMessage: string): SubmitFunction => {
		return () => {
			actionState = { key, status: 'pending', message: '正在提交，请稍候…' };
			return async ({ result, update }) => {
				if (result.type === 'success') {
					await update({ reset: false, invalidateAll: true });
					actionState = {
						key,
						status: 'success',
						message: String(result.data?.message ?? successMessage)
					};
					if (key === 'reminder') reminderDialog?.close();
					if (key === 'sop') sopDialog?.close();
					return;
				}
				await update({ reset: false, invalidateAll: false });
				actionState = {
					key,
					status: 'error',
					message:
						result.type === 'failure'
							? String(result.data?.message ?? '提交失败，请检查后重试')
							: '提交失败，请稍后重试'
				};
			};
		};
	};
</script>

<svelte:head>
	<title>SOP 管理 · 融资工作台</title>
</svelte:head>

<div class="management-page workflow-page">
	{#if actionState.status !== 'idle'}
		<div
			class={`action-feedback ${actionState.status}`}
			role={actionState.status === 'error' ? 'alert' : 'status'}
			aria-live="polite"
		>
			{#if actionState.status === 'pending'}
				<LoaderCircle size={17} class="spin" />
			{:else if actionState.status === 'success'}
				<CheckCircle2 size={17} />
			{:else}
				<BellRing size={17} />
			{/if}
			<span>{actionState.message}</span>
			{#if actionState.status !== 'pending'}
				<button
					type="button"
					aria-label="关闭反馈"
					onclick={() => (actionState = { key: '', status: 'idle', message: '' })}
				>×</button>
			{/if}
		</div>
	{/if}

	<section class="workflow-grid">
		<article class="section-card">
			<div class="card-header">
				<div class="header-icon blue"><Workflow size={19} /></div>
				<div>
					<h2>负债品种 SOP</h2>
					<p>启用的 SOP 同时决定首页展示哪些品种的项目、到期和付息事件</p>
				</div>
				<button class="link-button" type="button" onclick={() => sopDialog.showModal()}>
					<Plus size={14} /> 新建
				</button>
			</div>
			<div class="sop-list">
				{#each settings.sopTemplates as sop}
					<a class="sop-item" href={`/sop/${sop.id}`}>
						<span class="sop-type">{sop.debtType.slice(0, 2)}</span>
						<div class="sop-copy">
							<div>
								<strong>{sop.name}</strong>
								<span class:inactive={!sop.isActive} class="status-badge">
									{sop.isActive ? '启用' : '停用'}
								</span>
							</div>
							<p>{sop.description}</p>
							<div class="sop-meta">
								<span><GitBranch size={13} /> {sop.nodeCount} 个节点</span>
								<span><Users size={13} /> 按默认角色分工</span>
							</div>
						</div>
						<ArrowRight size={16} />
					</a>
				{:else}
					<p class="empty-state">尚未配置 SOP。未配置品种不会生成首页付息和到期事件。</p>
				{/each}
			</div>
		</article>

		<article class="section-card">
			<div class="card-header">
				<div class="header-icon orange"><BellRing size={19} /></div>
				<div>
					<h2>提醒规则</h2>
					<p>为 SOP 项目节点配置邮件提醒</p>
				</div>
				<div class="header-actions">
					<a class="link-button" href="/sop/reminders">发送历史</a>
					<button class="link-button" type="button" onclick={() => reminderDialog.showModal()}>
						<Plus size={14} /> 新建
					</button>
				</div>
			</div>
			<div class="reminder-list">
				{#each settings.reminderRules as rule}
					<div class="reminder-item">
						<span class="channel-icon"><Mail size={17} /></span>
						<div>
							<div class="rule-title">
								<strong>{rule.name}</strong>
								<span class:inactive={!rule.isActive} class="status-badge">
									{rule.isActive ? '启用' : '停用'}
								</span>
							</div>
							<p>
								节点到期前 <b>{rule.offsetDays} 天</b> ·
								{rule.frequency === 'once'
									? '发送一次'
									: rule.frequency === 'daily'
										? '每天发送'
										: '每周发送'}
							</p>
							<span class="recipient">
								<UserRound size={12} />
								{rule.recipientMode === 'owner'
									? '项目负责人'
									: rule.recipientMode === 'custom'
										? '指定邮箱'
										: '任务负责人'}
							</span>
						</div>
					</div>
				{:else}
					<p class="empty-state">尚未配置提醒规则。</p>
				{/each}
				<button class="add-rule" type="button" onclick={() => reminderDialog.showModal()}>
					<Plus size={15} />
					添加提醒规则
				</button>
			</div>
		</article>
	</section>

	<button
		class="floating-create-button"
		type="button"
		onclick={() => sopDialog.showModal()}
		aria-label="新建 SOP"
		title="新建 SOP"
	>
		<Plus size={23} />
	</button>

	<dialog class="config-modal" bind:this={reminderDialog}>
		<form method="post" action="?/createReminder" use:enhance={enhanceAction('reminder', '提醒规则已保存')}>
			<div class="modal-header">
				<div>
					<p class="eyebrow">REMINDER RULE</p>
					<h2>配置邮件提醒</h2>
					<p>在指定节点前按设定频率发送提醒。</p>
				</div>
				<button type="button" aria-label="关闭" onclick={() => reminderDialog.close()}>×</button>
			</div>
			<div class="form-grid">
				<label class="wide">
					<span>规则名称</span>
					<input name="name" required value="任务到期提醒" />
				</label>
				<label>
					<span>适用负债品种</span>
					<select name="debtType">
						<option value="">全部已启用 SOP</option>
						{#each activeSopTemplates as sop}
							<option value={sop.debtType}>{sop.debtType}</option>
						{/each}
					</select>
				</label>
				<label>
					<span>提醒节点</span>
					<select name="triggerField">
						<option value="due_date">任务截止日</option>
						<option value="planned_issue_date">计划发行日</option>
						<option value="planned_maturity_date">到期日</option>
					</select>
				</label>
				<label>
					<span>提前天数</span>
					<input name="offsetDays" type="number" min="0" max="365" value="3" required />
				</label>
				<label>
					<span>提醒频率</span>
					<select name="frequency">
						<option value="once">仅一次</option>
						<option value="daily">每天</option>
						<option value="weekly">每周</option>
					</select>
				</label>
				<label class="wide">
					<span>收件人</span>
					<select name="recipientMode" bind:value={reminderRecipientMode}>
						<option value="assignee">任务负责人</option>
						<option value="owner">项目负责人</option>
						<option value="custom">指定邮箱</option>
					</select>
				</label>
				{#if reminderRecipientMode === 'custom'}
					<label class="wide">
						<span>指定邮箱</span>
						<input name="recipients" type="text" required placeholder="多个邮箱使用逗号分隔" />
					</label>
				{/if}
			</div>
			<div class="modal-actions">
				<button type="button" onclick={() => reminderDialog.close()}>取消</button>
				<button class="primary-action" type="submit" disabled={actionState.status === 'pending'}>
					{actionState.status === 'pending' && actionState.key === 'reminder' ? '保存中…' : '保存规则'}
				</button>
			</div>
		</form>
	</dialog>

	<dialog class="config-modal" bind:this={sopDialog}>
		<form method="post" action="?/createSop" use:enhance={enhanceAction('sop', 'SOP 模板已创建')}>
			<div class="modal-header">
				<div>
					<p class="eyebrow">SOP TEMPLATE</p>
					<h2>新建负债品种 SOP</h2>
					<p>保存后再编排节点、默认角色和相对日期。</p>
				</div>
				<button type="button" aria-label="关闭" onclick={() => sopDialog.close()}>×</button>
			</div>
			<div class="form-grid">
				<label class="wide">
					<span>SOP 名称</span>
					<input name="name" required placeholder="例如：收益凭证发行 SOP" />
				</label>
				<label class="wide">
					<span>负债品种</span>
					<select name="debtType" required>
						<option value="">请选择</option>
						<option>收益凭证</option>
						<option>公司债</option>
						<option>短期融资券</option>
						<option>转融资</option>
						<option>同业拆借</option>
						<option>集团借款</option>
					</select>
				</label>
				<label class="wide">
					<span>说明</span>
					<textarea name="description" rows="3" placeholder="说明适用范围和关键控制要求"></textarea>
				</label>
			</div>
			<div class="modal-actions">
				<button type="button" onclick={() => sopDialog.close()}>取消</button>
				<button class="primary-action" type="submit" disabled={actionState.status === 'pending'}>
					{actionState.status === 'pending' && actionState.key === 'sop' ? '创建中…' : '创建并配置节点'}
				</button>
			</div>
		</form>
	</dialog>
</div>

<style>
	.workflow-grid {
		display: grid;
		grid-template-columns: minmax(0, 1.2fr) minmax(20rem, 0.8fr);
		gap: 1rem;
	}

	.sop-list,
	.reminder-list {
		display: grid;
	}

	.sop-item {
		display: grid;
		grid-template-columns: 2.75rem minmax(0, 1fr) auto;
		align-items: center;
		gap: 0.875rem;
		padding: 1rem 1.125rem;
		border-top: 1px solid var(--line);
		transition: background 180ms ease;
	}

	.sop-item:hover {
		background: #f8faff;
	}

	.sop-type,
	.channel-icon {
		display: grid;
		width: 2.5rem;
		height: 2.5rem;
		place-items: center;
		border-radius: 0.5rem;
		font-size: 0.75rem;
		font-weight: 750;
		color: #175cd3;
		background: #eff4ff;
	}

	.sop-copy > div:first-child,
	.rule-title {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.sop-copy p,
	.reminder-item p {
		margin: 0.25rem 0;
		color: #667085;
	}

	.sop-meta,
	.recipient {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		font-size: 0.75rem;
		color: #98a2b3;
	}

	.sop-meta span,
	.recipient {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
	}

	.reminder-item {
		display: grid;
		grid-template-columns: 2.75rem minmax(0, 1fr);
		gap: 0.75rem;
		padding: 1rem 1.125rem;
		border-top: 1px solid var(--line);
	}

	.channel-icon {
		color: #b54708;
		background: #fff7ed;
	}

	.add-rule {
		min-height: 3rem;
		margin: 0.75rem;
		border: 1px dashed #b9c5d6;
		border-radius: 0.5rem;
		color: #175cd3;
		background: #f8faff;
	}

	@media (max-width: 64rem) {
		.workflow-grid {
			grid-template-columns: 1fr;
		}
	}

	@media (max-width: 51.25rem) {
		.add-rule {
			margin-right: 4.75rem;
		}
	}
</style>
