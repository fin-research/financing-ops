<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import {
		ArrowRight,
		BellRing,
		CheckCircle2,
		Clock3,
		FileSpreadsheet,
		GitBranch,
		LoaderCircle,
		Mail,
		MoreHorizontal,
		Plus,
		RefreshCw,
		Save,
		ShieldCheck,
		Upload,
		UserRound,
		Users,
		Workflow
	} from '@lucide/svelte';

	let { data } = $props();
	let reminderDialog: HTMLDialogElement;
	let sopDialog: HTMLDialogElement;
	let personDialog: HTMLDialogElement;
	let importExpanded = $state(false);
	let reminderRecipientMode = $state('assignee');
	let editingPerson = $state<(typeof fallback.people)[number] | null>(null);
	let actionState = $state<{
		key: string;
		status: 'idle' | 'pending' | 'success' | 'error';
		message: string;
	}>({ key: '', status: 'idle', message: '' });

	const fallback = {
		people: [
			{ id: '1', name: '陈语桐', email: 'yutong.chen@example.com', role: '融资管理岗', active: true },
			{ id: '2', name: '王岚', email: 'lan.wang@example.com', role: '项目负责人', active: true },
			{ id: '3', name: '周明远', email: 'mingyuan.zhou@example.com', role: '资金运营岗', active: true }
		],
		sopTemplates: [
			{
				id: '1',
				name: '债券发行标准 SOP',
				debtType: '公司债/次级债',
				description: '覆盖立项、选聘中介、申报、发行与存续管理',
				nodeCount: 8,
				isActive: true
			},
			{
				id: '2',
				name: '短期融资券发行 SOP',
				debtType: '短期融资券',
				description: '覆盖额度准备、发行备案、簿记与缴款',
				nodeCount: 6,
				isActive: true
			}
		],
		reminderRules: [
			{
				id: '1',
				name: '任务到期前 3 天提醒',
				targetType: 'project_task',
				debtType: null,
				triggerField: 'due_date',
				offsetDays: 3,
				frequency: 'once',
				channel: 'email',
				recipientMode: 'assignee',
				isActive: true
			}
		],
		lastImport: {
			sourceFile: '东方财富证券借入资金汇总表20260727.xlsx',
			status: 'completed',
			startedAt: '2026-07-28 14:36:18',
			finishedAt: '2026-07-28 14:36:22',
			insertedCount: 9595,
			updatedCount: 0,
			skippedCount: 17
		},
		importStats: {
			debtCount: 9595,
			sourceRowCount: 9922,
			cashflowEventCount: 9805,
			historyBalanceRowCount: 23580,
			historyDateCount: 2357,
			historySpan: { startDate: '2016-11-17', endDate: '2026-07-27' }
		}
	};

	const settings = $derived(data?.settings ?? fallback);

	const enhanceAction = (key: string, successMessage: string): SubmitFunction => {
		return () => {
			actionState = { key, status: 'pending', message: '正在提交，请稍候…' };
			return async ({ result, update }) => {
				if (result.type === 'success') {
					await update({ reset: false, invalidateAll: true });
					const payload = result.data as { message?: string } | undefined;
					actionState = {
						key,
						status: 'success',
						message: payload?.message ?? successMessage
					};
					if (key === 'person') personDialog?.close();
					if (key === 'reminder') reminderDialog?.close();
					if (key === 'sop') sopDialog?.close();
					return;
				}
				await update({ reset: false, invalidateAll: false });
				const payload = result.type === 'failure'
					? result.data as { message?: string }
					: undefined;
				actionState = {
					key,
					status: 'error',
					message: payload?.message ?? (result.type === 'error' ? result.error.message : '提交失败，请检查后重试')
				};
			};
		};
	};

	function openPerson(person: (typeof fallback.people)[number] | null = null) {
		editingPerson = person;
		personDialog.showModal();
	}
</script>

<svelte:head>
	<title>SOP 与提醒 · 融资工作台</title>
</svelte:head>

<section class="page-heading">
	<div>
		<p class="eyebrow">WORKFLOW CONFIGURATION</p>
		<h1>SOP 与提醒</h1>
		<p>配置不同负债品种的标准流程、人员分工和节点提醒</p>
	</div>
	<button class="primary-action" type="button" onclick={() => sopDialog.showModal()}>
		<Plus size={16} />
		新建 SOP
	</button>
</section>

{#if actionState.status !== 'idle'}
	<div
		class={`action-feedback ${actionState.status}`}
		role={actionState.status === 'error' ? 'alert' : 'status'}
		aria-live="polite"
	>
		{#if actionState.status === 'pending'}
			<LoaderCircle size={17} class="feedback-spinner" />
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

<section class="settings-grid">
	<article class="section-card import-card" id="import">
		<div class="card-header">
			<div class="header-icon excel"><FileSpreadsheet size={19} /></div>
			<div>
				<h2>负债数据导入</h2>
				<p>将借入资金汇总表中的明细及汇总余额导入 SQLite</p>
			</div>
			<span class="status-badge success"><CheckCircle2 size={13} /> 已完成</span>
		</div>
		<div class="import-summary">
			<div class="file-block">
				<span class="file-icon">XLSX</span>
				<div>
					<strong>{settings.lastImport?.sourceFile ?? '尚未导入'}</strong>
					<p>数据截至 2026-07-27 · 11 个工作表</p>
				</div>
			</div>
			<div class="reconcile-block">
				<div>
					<span>存续余额对账</span>
					<strong>1,180.7206 亿元</strong>
				</div>
				<span class="reconcile-status"><ShieldCheck size={14} /> 与汇总表一致</span>
			</div>
			<div class="import-actions">
				<button class="secondary-action" type="button" onclick={() => (importExpanded = !importExpanded)}>
					{importExpanded ? '收起详情' : '导入详情'}
				</button>
				<form method="post" action="?/reimport" use:enhance={enhanceAction('import', 'Excel 已重新导入并完成核对')}>
					<button class="primary-action compact" type="submit" disabled={actionState.status === 'pending'}>
						{#if actionState.status === 'pending' && actionState.key === 'import'}
							<LoaderCircle size={14} class="feedback-spinner" />
						{:else}
							<RefreshCw size={14} />
						{/if}
						重新导入
					</button>
				</form>
			</div>
		</div>
		{#if importExpanded}
			<div class="import-detail">
				<div><span>结构化债务</span><strong>{settings.importStats.debtCount.toLocaleString('zh-CN')} 条</strong></div>
				<div><span>完整来源行</span><strong>{settings.importStats.sourceRowCount.toLocaleString('zh-CN')} 条</strong></div>
				<div><span>历史余额</span><strong>{settings.importStats.historyBalanceRowCount.toLocaleString('zh-CN')} 条</strong></div>
				<div><span>付息/还本事件</span><strong>{settings.importStats.cashflowEventCount.toLocaleString('zh-CN')} 条</strong></div>
				<div><span>导入方式</span><strong>幂等更新</strong></div>
				<div><span>历史范围</span><strong>{settings.importStats.historySpan.startDate} — {settings.importStats.historySpan.endDate}</strong></div>
				<div><span>质量提示</span><strong class="warning-text">未来列与 1 条历史公式异常已隔离</strong></div>
			</div>
			<form
				class="upload-zone"
				method="post"
				action="?/upload"
				enctype="multipart/form-data"
				use:enhance={enhanceAction('upload', 'Excel 已上传、校验并导入')}
			>
				<Upload size={20} />
				<div>
					<strong>上传新的借入资金汇总表</strong>
					<p>支持 .xlsx，导入前自动校验字段、日期和汇总余额</p>
				</div>
				<label>
					<span>选择文件</span>
					<input name="workbook" type="file" accept=".xlsx" required />
				</label>
				<button type="submit" disabled={actionState.status === 'pending'}>上传并校验</button>
			</form>
		{/if}
	</article>

	<article class="section-card sop-card">
		<div class="card-header">
			<div class="header-icon blue"><Workflow size={19} /></div>
			<div>
				<h2>负债品种 SOP</h2>
				<p>新建项目时自动生成任务节点和默认时间</p>
			</div>
			<button class="link-button" type="button" onclick={() => sopDialog.showModal()}>
				<Plus size={14} /> 新建
			</button>
		</div>
		<div class="sop-list">
			{#each settings.sopTemplates as sop}
				<a class="sop-item" href={`/settings/sop/${sop.id}`}>
					<span class="sop-type">{sop.debtType.slice(0, 2)}</span>
					<div class="sop-copy">
						<div>
							<strong>{sop.name}</strong>
							<span class="status-badge success">{sop.isActive ? '启用' : '停用'}</span>
						</div>
						<p>{sop.description}</p>
						<div class="sop-meta">
							<span><GitBranch size={13} /> {sop.nodeCount} 个节点</span>
							<span><Users size={13} /> 3 个角色</span>
						</div>
					</div>
					<ArrowRight size={15} />
				</a>
			{/each}
		</div>
	</article>

	<article class="section-card reminder-card">
		<div class="card-header">
			<div class="header-icon orange"><BellRing size={19} /></div>
			<div>
				<h2>提醒规则</h2>
				<p>通过 Resend API 发送邮件提醒</p>
			</div>
			<div class="header-actions">
				<a class="link-button" href="/settings/reminders">发送历史</a>
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
							<span class="status-badge success">{rule.isActive ? '启用' : '停用'}</span>
						</div>
						<p>
							节点到期前 <b>{rule.offsetDays} 天</b> ·
							{rule.frequency === 'once'
								? '发送一次'
								: rule.frequency === 'daily'
									? '每天发送'
									: '每周发送'}
						</p>
						<span class="recipient"><UserRound size={12} /> 发送给任务负责人</span>
					</div>
					<button type="button" aria-label={`更多设置：${rule.name}`}><MoreHorizontal size={17} /></button>
				</div>
			{/each}
			<button class="add-rule" type="button" onclick={() => reminderDialog.showModal()}>
				<Plus size={15} />
				添加提醒规则
			</button>
		</div>
	</article>

	<article class="section-card people-card" id="members">
		<div class="card-header">
			<div class="header-icon violet"><Users size={19} /></div>
			<div>
				<h2>人员与分工</h2>
				<p>项目负责人、任务执行人与通知邮箱</p>
			</div>
			<button class="link-button" type="button" onclick={() => openPerson()}><Plus size={14} /> 添加</button>
		</div>
		<div class="people-list">
			{#each settings.people as person, index}
				<div class="person-item">
					<span class={`avatar-color color-${(index % 4) + 1}`}>{person.name.slice(0, 1)}</span>
					<div>
						<strong>{person.name}</strong>
						<p>{person.role}</p>
					</div>
					<span class="person-email">{person.email}</span>
					<span class="status-badge success">{person.active ? '在职' : '停用'}</span>
					<div class="person-actions">
						<button type="button" aria-label={`编辑 ${person.name}`} onclick={() => openPerson(person)}>
							<MoreHorizontal size={17} />
						</button>
						<form
							method="post"
							action="?/togglePerson"
							use:enhance={enhanceAction(`toggle-${person.id}`, person.active ? '人员已停用' : '人员已启用')}
						>
							<input type="hidden" name="id" value={person.id} />
							<input type="hidden" name="active" value={person.active ? '0' : '1'} />
							<button type="submit" class="text-toggle" disabled={actionState.status === 'pending'}>
								{person.active ? '停用' : '启用'}
							</button>
						</form>
					</div>
				</div>
			{/each}
		</div>
	</article>
</section>

<dialog class="config-modal" bind:this={reminderDialog}>
	<form method="post" action="?/createReminder" use:enhance={enhanceAction('reminder', '提醒规则已保存')}>
		<div class="modal-header">
			<div>
				<p class="eyebrow">REMINDER RULE</p>
				<h2>配置邮件提醒</h2>
				<p>在指定节点前按设定频率通过 Resend 发送提醒。</p>
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
					<option value="">全部品种</option>
					<option>小公募</option>
					<option>次级债</option>
					<option>短期融资券</option>
					<option>转融资</option>
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
		<div class="integration-note">
			<Mail size={15} />
			<div>
				<strong>Resend 邮件通道</strong>
				<span>部署环境配置 RESEND_API_KEY 后即可发送；本地未配置时仅记录待发队列。</span>
			</div>
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
				<p>先创建模板，保存后再编排节点、默认负责人和相对日期。</p>
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
					<option>小公募</option>
					<option>次级债</option>
					<option>短期融资券</option>
					<option>转融资</option>
					<option>同业拆借</option>
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

<dialog class="config-modal" bind:this={personDialog}>
	<form
		method="post"
		action={editingPerson ? '?/updatePerson' : '?/createPerson'}
		use:enhance={enhanceAction('person', editingPerson ? '人员信息已更新' : '人员已添加')}
	>
		<div class="modal-header">
			<div>
				<p class="eyebrow">TEAM MEMBER</p>
				<h2>{editingPerson ? '编辑人员信息' : '添加人员'}</h2>
				<p>邮箱用于任务和到期提醒，请填写可接收通知的工作邮箱。</p>
			</div>
			<button type="button" aria-label="关闭" onclick={() => personDialog.close()}>×</button>
		</div>
		{#if editingPerson}
			<input type="hidden" name="id" value={editingPerson.id} />
		{/if}
		<div class="form-grid">
			<label class="wide">
				<span>姓名</span>
				<input name="name" required value={editingPerson?.name ?? ''} autocomplete="name" />
			</label>
			<label class="wide">
				<span>工作邮箱</span>
				<input
					name="email"
					type="email"
					required
					value={editingPerson?.email ?? ''}
					autocomplete="email"
				/>
			</label>
			<label class="wide">
				<span>岗位/角色</span>
				<input name="role" required value={editingPerson?.role ?? ''} placeholder="例如：资金管理" />
			</label>
		</div>
		<div class="modal-actions">
			<button type="button" onclick={() => personDialog.close()}>取消</button>
			<button class="primary-action" type="submit" disabled={actionState.status === 'pending'}>
				<Save size={15} />
				{actionState.status === 'pending' && actionState.key === 'person' ? '保存中…' : '保存'}
			</button>
		</div>
	</form>
</dialog>

<style>
	.page-heading {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 1.25rem;
		margin-bottom: 1.125rem;
	}

	.eyebrow {
		margin: 0 0 0.25rem;
		font-size: 0.75rem !important;
		font-weight: 800;
		letter-spacing: 0.16em;
		color: #2f6fed !important;
	}

	.page-heading h1 {
		margin: 0;
		font-size: clamp(1.5rem, 2vw, 1.875rem);
		font-weight: 730;
		letter-spacing: -0.035em;
		color: #101828;
	}

	.page-heading p {
		margin: 0.3125rem 0 0;
		font-size: 1rem;
		color: #667085;
	}

	.primary-action,
	.secondary-action {
		display: inline-flex;
		min-height: 2.375rem;
		align-items: center;
		justify-content: center;
		gap: 0.4375rem;
		padding: 0 0.8125rem;
		border-radius: 0.5rem;
		font-size: 0.75rem;
		font-weight: 650;
		cursor: pointer;
		transition:
			background 180ms ease,
			border-color 180ms ease;
	}

	.primary-action {
		border: 1px solid #2f6fed;
		color: #fff;
		background: #2f6fed;
	}

	.primary-action:hover {
		background: #245fd3;
	}

	.primary-action.compact {
		min-height: 2.125rem;
		padding: 0 0.625rem;
	}

	.secondary-action {
		border: 1px solid #d0d5dd;
		color: #475467;
		background: #fff;
	}

	.secondary-action:hover {
		border-color: #98a2b3;
		background: #f9fafb;
	}

	.action-feedback {
		display: flex;
		min-height: 2.75rem;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 1rem;
		padding: 0.625rem 0.875rem;
		border: 1px solid #b2ddff;
		border-radius: 0.625rem;
		font-size: 1rem;
		color: #175cd3;
		background: #eff8ff;
	}

	.action-feedback.success {
		border-color: #abefc6;
		color: #067647;
		background: #ecfdf3;
	}

	.action-feedback.error {
		border-color: #fecdca;
		color: #b42318;
		background: #fef3f2;
	}

	.action-feedback > button {
		display: grid;
		width: 2rem;
		height: 2rem;
		margin-left: auto;
		place-items: center;
		border: 0;
		border-radius: 0.375rem;
		font-size: 1.25rem;
		color: currentColor;
		background: transparent;
	}

	.feedback-spinner {
		animation: feedback-spin 700ms linear infinite;
	}

	@keyframes feedback-spin {
		to {
			transform: rotate(1turn);
		}
	}

	.settings-grid {
		display: grid;
		grid-template-columns: minmax(0, 1.08fr) minmax(0, 0.92fr);
		gap: 0.75rem;
		align-items: start;
	}

	.section-card {
		scroll-margin-top: 4.875rem;
		overflow: hidden;
		border: 1px solid #e4e7ec;
		border-radius: 0.6875rem;
		background: #fff;
		box-shadow: 0 1px 2px rgb(16 24 40 / 4%);
	}

	.import-card,
	.people-card {
		grid-column: 1 / -1;
	}

	.card-header {
		display: flex;
		min-height: 4.1875rem;
		align-items: center;
		gap: 0.6875rem;
		padding: 0.8125rem 1rem;
		border-bottom: 1px solid #eaecf0;
	}

	.header-icon {
		display: grid;
		width: 2.375rem;
		height: 2.375rem;
		flex: 0 0 auto;
		place-items: center;
		border-radius: 0.5625rem;
	}

	.header-icon.excel {
		color: #067647;
		background: #ecfdf3;
	}

	.header-icon.blue {
		color: #2f6fed;
		background: #edf4ff;
	}

	.header-icon.orange {
		color: #dc6803;
		background: #fff4e8;
	}

	.header-icon.violet {
		color: #6941c6;
		background: #f4f3ff;
	}

	.card-header h2 {
		margin: 0;
		font-size: 1rem;
		color: #1d2939;
	}

	.card-header p {
		margin: 0.1875rem 0 0;
		font-size: 0.75rem;
		color: #98a2b3;
	}

	.status-badge {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		margin-left: auto;
		padding: 0.1875rem 0.375rem;
		border-radius: 0.3125rem;
		font-size: 0.75rem;
		font-weight: 700;
	}

	.status-badge.success {
		color: #067647;
		background: #ecfdf3;
	}

	.link-button {
		display: inline-flex;
		min-height: 2.125rem;
		align-items: center;
		gap: 0.25rem;
		margin-left: auto;
		padding: 0 0.4375rem;
		border: 0;
		font-size: 0.75rem;
		font-weight: 700;
		color: #2f6fed;
		background: transparent;
		cursor: pointer;
	}

	.header-actions {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		margin-left: auto;
	}

	.header-actions .link-button {
		margin-left: 0;
	}

	.import-summary {
		display: grid;
		grid-template-columns: minmax(18.75rem, 1.2fr) minmax(16.25rem, 1fr) auto;
		align-items: center;
		gap: 1.375rem;
		padding: 1.0625rem 1.125rem;
	}

	.file-block {
		display: flex;
		align-items: center;
		gap: 0.6875rem;
		min-width: 0;
	}

	.file-icon {
		display: grid;
		width: 2.6875rem;
		height: 2.6875rem;
		flex: 0 0 auto;
		place-items: center;
		border: 1px solid #a6f4c5;
		border-radius: 0.5rem;
		font-size: 0.75rem;
		font-weight: 800;
		color: #067647;
		background: #f6fef9;
	}

	.file-block div {
		min-width: 0;
	}

	.file-block strong {
		display: block;
		overflow: hidden;
		font-size: 0.75rem;
		color: #344054;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.file-block p {
		margin: 0.25rem 0 0;
		font-size: 0.75rem;
		color: #98a2b3;
	}

	.reconcile-block {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.625rem 0.75rem;
		border: 1px solid #d1fadf;
		border-radius: 0.5rem;
		background: #f6fef9;
	}

	.reconcile-block > div {
		display: grid;
		gap: 0.1875rem;
	}

	.reconcile-block span {
		font-size: 0.75rem;
		color: #667085;
	}

	.reconcile-block strong {
		font-family: 'SFMono-Regular', Consolas, monospace;
		font-size: 1rem;
		color: #05603a;
	}

	.reconcile-status {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		font-weight: 650;
		color: #067647 !important;
		white-space: nowrap;
	}

	.import-actions {
		display: flex;
		gap: 0.4375rem;
	}

	.import-detail {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		border-top: 1px solid #eaecf0;
		border-bottom: 1px solid #eaecf0;
		background: #f9fafb;
	}

	.import-detail > div {
		display: grid;
		gap: 0.25rem;
		padding: 0.75rem 1rem;
		border-right: 1px solid #eaecf0;
	}

	.import-detail > div:last-child {
		border-right: 0;
	}

	.import-detail span {
		font-size: 0.75rem;
		color: #98a2b3;
	}

	.import-detail strong {
		font-size: 0.75rem;
		color: #344054;
	}

	.warning-text {
		color: #b54708 !important;
	}

	.upload-zone {
		display: grid;
		grid-template-columns: auto 1fr auto auto;
		align-items: center;
		gap: 0.75rem;
		margin: 0.875rem 1rem;
		padding: 0.875rem;
		border: 1px dashed #b8c7e0;
		border-radius: 0.5625rem;
		color: #2f6fed;
		background: #f8faff;
	}

	.upload-zone strong {
		display: block;
		font-size: 0.75rem;
		color: #344054;
	}

	.upload-zone p {
		margin: 0.1875rem 0 0;
		font-size: 0.75rem;
		color: #98a2b3;
	}

	.upload-zone label span,
	.upload-zone > button {
		display: inline-flex;
		min-height: 2rem;
		align-items: center;
		padding: 0 0.625rem;
		border: 1px solid #d0d5dd;
		border-radius: 0.375rem;
		font-size: 0.75rem;
		font-weight: 650;
		color: #475467;
		background: #fff;
		cursor: pointer;
	}

	.upload-zone input {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
	}

	.upload-zone > button {
		border-color: #2f6fed;
		color: #fff;
		background: #2f6fed;
	}

	.sop-list,
	.reminder-list {
		padding: 0.3125rem 0.8125rem;
	}

	.sop-item {
		display: grid;
		grid-template-columns: 2.25rem minmax(0, 1fr) 0.9375rem;
		align-items: center;
		gap: 0.625rem;
		padding: 0.8125rem 0.1875rem;
		border-bottom: 1px solid #eaecf0;
		transition: background 180ms ease;
	}

	.sop-item:last-child {
		border-bottom: 0;
	}

	.sop-item:hover {
		background: #f9fafb;
	}

	.sop-type {
		display: grid;
		width: 2.25rem;
		height: 2.25rem;
		place-items: center;
		border-radius: 0.5rem;
		font-size: 0.75rem;
		font-weight: 800;
		color: #175cd3;
		background: #edf4ff;
	}

	.sop-copy {
		min-width: 0;
	}

	.sop-copy > div:first-child,
	.rule-title {
		display: flex;
		align-items: center;
		gap: 0.4375rem;
	}

	.sop-copy .status-badge,
	.rule-title .status-badge {
		margin-left: 0;
	}

	.sop-copy strong,
	.rule-title strong {
		font-size: 0.75rem;
		color: #344054;
	}

	.sop-copy p {
		margin: 0.25rem 0;
		overflow: hidden;
		font-size: 0.75rem;
		color: #98a2b3;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.sop-meta {
		display: flex;
		gap: 0.75rem;
	}

	.sop-meta span,
	.recipient {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		font-size: 0.75rem;
		color: #667085;
	}

	.sop-item > :global(svg) {
		color: #c0c6cf;
	}

	.reminder-item {
		display: grid;
		grid-template-columns: 2.125rem minmax(0, 1fr) 1.75rem;
		align-items: center;
		gap: 0.625rem;
		padding: 0.8125rem 0.1875rem;
		border-bottom: 1px solid #eaecf0;
	}

	.channel-icon {
		display: grid;
		width: 2.125rem;
		height: 2.125rem;
		place-items: center;
		border-radius: 0.5rem;
		color: #dc6803;
		background: #fff4e8;
	}

	.reminder-item p {
		margin: 0.25rem 0;
		font-size: 0.75rem;
		color: #667085;
	}

	.reminder-item button,
	.person-item button {
		display: grid;
		width: 1.75rem;
		height: 1.75rem;
		place-items: center;
		border: 0;
		border-radius: 0.375rem;
		color: #98a2b3;
		background: transparent;
		cursor: pointer;
	}

	.reminder-item button:hover,
	.person-item button:hover {
		color: #475467;
		background: #f2f4f7;
	}

	.add-rule {
		display: flex;
		width: 100%;
		min-height: 2.625rem;
		align-items: center;
		justify-content: center;
		gap: 0.3125rem;
		border: 0;
		font-size: 0.75rem;
		font-weight: 650;
		color: #2f6fed;
		background: transparent;
		cursor: pointer;
	}

	.people-list {
		padding: 0.1875rem 0.8125rem;
	}

	.person-item {
		display: grid;
		grid-template-columns: 2.125rem minmax(8.125rem, 0.7fr) minmax(11.25rem, 1fr) auto minmax(5.5rem, auto);
		align-items: center;
		gap: 0.6875rem;
		min-height: 3.625rem;
		padding: 0.5rem 0.1875rem;
		border-bottom: 1px solid #eaecf0;
	}

	.person-item:last-child {
		border-bottom: 0;
	}

	.avatar-color {
		display: grid;
		width: 2rem;
		height: 2rem;
		place-items: center;
		border-radius: 0.5rem;
		font-size: 0.75rem;
		font-weight: 800;
		color: #175cd3;
		background: #edf4ff;
	}

	.avatar-color.color-2 {
		color: #067647;
		background: #ecfdf3;
	}

	.avatar-color.color-3 {
		color: #5925dc;
		background: #f4f3ff;
	}

	.person-item strong {
		font-size: 0.75rem;
		color: #344054;
	}

	.person-item p {
		margin: 0.1875rem 0 0;
		font-size: 0.75rem;
		color: #98a2b3;
	}

	.person-email {
		font-size: 0.75rem;
		color: #667085;
	}

	.person-actions {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 0.25rem;
	}

	.person-actions .text-toggle {
		width: auto;
		min-width: 2.75rem;
		height: 2rem;
		padding-inline: 0.5rem;
		font-size: 0.75rem;
		color: #475467;
	}

	button:disabled {
		cursor: not-allowed;
		opacity: 0.55;
	}

	.config-modal {
		width: min(35rem, calc(100vw - 2rem));
		padding: 0;
		border: 0;
		border-radius: 0.8125rem;
		color: #1d2939;
		background: #fff;
		box-shadow: 0 1.5rem 3rem rgb(16 24 40 / 22%);
	}

	.config-modal::backdrop {
		background: rgb(10 18 31 / 55%);
		backdrop-filter: blur(2px);
	}

	.config-modal form {
		padding: 1.25rem;
	}

	.modal-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		padding-bottom: 0.9375rem;
		border-bottom: 1px solid #eaecf0;
	}

	.modal-header h2 {
		margin: 0;
		font-size: 1.125rem;
	}

	.modal-header p:not(.eyebrow) {
		margin: 0.3125rem 0 0;
		font-size: 0.75rem;
		color: #667085;
	}

	.modal-header button {
		display: grid;
		width: 2.125rem;
		height: 2.125rem;
		place-items: center;
		border: 0;
		border-radius: 0.375rem;
		font-size: 1.375rem;
		color: #667085;
		background: #f2f4f7;
		cursor: pointer;
	}

	.form-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.8125rem;
		padding: 1.0625rem 0;
	}

	.form-grid label {
		display: grid;
		gap: 0.3125rem;
	}

	.form-grid label.wide {
		grid-column: 1 / -1;
	}

	.form-grid label span {
		font-size: 0.75rem;
		font-weight: 650;
		color: #475467;
	}

	.form-grid input,
	.form-grid select,
	.form-grid textarea {
		width: 100%;
		min-height: 2.375rem;
		padding: 0 0.625rem;
		border: 1px solid #d0d5dd;
		border-radius: 0.4375rem;
		font-size: 0.75rem;
		color: #344054;
		background: #fff;
	}

	.form-grid textarea {
		padding-top: 0.5625rem;
		resize: vertical;
	}

	.integration-note {
		display: flex;
		gap: 0.5rem;
		padding: 0.625rem;
		border: 1px solid #dbe6fb;
		border-radius: 0.4375rem;
		color: #175cd3;
		background: #eff4ff;
	}

	.integration-note div {
		display: grid;
		gap: 2px;
	}

	.integration-note strong {
		font-size: 0.75rem;
	}

	.integration-note span {
		font-size: 0.75rem;
		color: #4672c5;
	}

	.modal-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
		padding-top: 1rem;
	}

	.modal-actions > button:first-child {
		min-height: 2.375rem;
		padding: 0 0.8125rem;
		border: 1px solid #d0d5dd;
		border-radius: 0.5rem;
		font-size: 0.75rem;
		color: #475467;
		background: #fff;
		cursor: pointer;
	}

	@media (max-width: 62.5rem) {
		.import-summary {
			grid-template-columns: 1fr 1fr;
		}

		.import-actions {
			grid-column: 1 / -1;
			justify-content: flex-end;
		}
	}

	@media (max-width: 47.5rem) {
		.settings-grid {
			grid-template-columns: 1fr;
		}

		.import-card,
		.people-card {
			grid-column: auto;
		}

		.import-summary {
			grid-template-columns: 1fr;
			gap: 0.75rem;
		}

		.import-actions {
			grid-column: auto;
			justify-content: flex-start;
		}

		.import-detail {
			grid-template-columns: 1fr 1fr;
		}

		.import-detail > div:nth-child(2) {
			border-right: 0;
		}

		.upload-zone {
			grid-template-columns: auto 1fr;
		}

		.upload-zone label,
		.upload-zone > button {
			grid-column: auto;
		}

		.person-item {
			grid-template-columns: 2.125rem 1fr auto 1.75rem;
		}

		.person-email {
			display: none;
		}
	}

	@media (max-width: 32.5rem) {
		.page-heading {
			align-items: flex-start;
		}

		.page-heading .primary-action {
			padding: 0 0.625rem;
			font-size: 0;
		}

		.import-detail {
			grid-template-columns: 1fr;
		}

		.import-detail > div {
			border-right: 0;
			border-bottom: 1px solid #eaecf0;
		}

		.upload-zone {
			display: flex;
			flex-wrap: wrap;
		}

		.upload-zone > div {
			width: calc(100% - 2.5rem);
		}

		.form-grid {
			grid-template-columns: 1fr;
		}

		.form-grid label.wide {
			grid-column: auto;
		}
	}
</style>
