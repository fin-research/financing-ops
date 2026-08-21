<script lang="ts">
	import { enhance } from '$app/forms';
	import {
		ArrowDown,
		ArrowLeft,
		ArrowUp,
		CheckCircle2,
		CircleAlert,
		GitBranch,
		Plus,
		Save,
		Trash2
	} from '@lucide/svelte';
	import { withBase } from '$lib/app-paths';

	let { data, form } = $props();
	let pendingAction = $state('');

	function enhanceForm(label: string) {
		return () => {
			pendingAction = label;
			return async ({ update }: { update: () => Promise<void> }) => {
				await update();
				pendingAction = '';
			};
		};
	}
</script>

<svelte:head>
	<title>{data.template.name} · SOP 配置</title>
</svelte:head>

<div class="back-nav detail-toolbar">
	<a href={withBase('/sop')}><ArrowLeft size={18} /> 返回 SOP 管理</a>
	<form method="post" action="?/toggleTemplate" use:enhance={enhanceForm('toggle')}>
		<button class:active={data.template.isActive} class="toggle-button" type="submit" disabled={pendingAction === 'toggle'}>
			{pendingAction === 'toggle' ? '更新中…' : data.template.isActive ? '已启用 · 点击停用' : '已停用 · 点击启用'}
		</button>
	</form>
</div>

{#if form?.message}
	<div class:success={form.success} class="feedback" role={form.success ? 'status' : 'alert'} aria-live="polite">
		{#if form.success}<CheckCircle2 size={18} />{:else}<CircleAlert size={18} />{/if}
		{form.message}
	</div>
{/if}

<div class="editor-grid">
	<main>
		<section class="panel">
			<header>
				<div>
					<h2>流程节点</h2>
					<p>节点顺序会直接用于新建项目的任务生成</p>
				</div>
				<GitBranch size={20} />
			</header>
			<div class="node-list">
				{#each data.nodes as node, index}
					<article class="node-card">
						<div class="node-order">
							<strong>{index + 1}</strong>
							<div>
								<form method="post" action="?/moveNode" use:enhance={enhanceForm(`up-${node.id}`)}>
									<input type="hidden" name="nodeId" value={node.id} />
									<input type="hidden" name="direction" value="up" />
									<button type="submit" aria-label={`上移 ${node.name}`} disabled={index === 0 || pendingAction === `up-${node.id}`}>
										<ArrowUp size={16} />
									</button>
								</form>
								<form method="post" action="?/moveNode" use:enhance={enhanceForm(`down-${node.id}`)}>
									<input type="hidden" name="nodeId" value={node.id} />
									<input type="hidden" name="direction" value="down" />
									<button type="submit" aria-label={`下移 ${node.name}`} disabled={index === data.nodes.length - 1 || pendingAction === `down-${node.id}`}>
										<ArrowDown size={16} />
									</button>
								</form>
							</div>
						</div>
						<form method="post" action="?/updateNode" use:enhance={enhanceForm(`node-${node.id}`)} class="node-form">
							<input type="hidden" name="nodeId" value={node.id} />
							<label class="node-name">
								<span>节点名称</span>
								<input name="name" maxlength="120" required value={node.name} />
							</label>
							<label>
								<span>相对发行日</span>
								<div class="offset-input">
									<input name="offsetDays" type="number" min="-3650" max="3650" step="1" required value={node.offsetDays} />
									<small>天</small>
								</div>
							</label>
							<label>
								<span>默认角色</span>
								<select name="ownerRole" value={node.ownerRole ?? ''}>
									<option value="">不指定</option>
									{#each data.roles as role}<option value={role.code}>{role.label}</option>{/each}
								</select>
							</label>
							<label class="node-description">
								<span>节点说明</span>
								<input name="description" value={node.description ?? ''} placeholder="可选：说明交付物或控制要求" />
							</label>
							<button class="save-button" type="submit" disabled={pendingAction === `node-${node.id}`}>
								<Save size={16} />
								{pendingAction === `node-${node.id}` ? '保存中…' : '保存'}
							</button>
						</form>
						<form method="post" action="?/deleteNode" use:enhance={enhanceForm(`delete-${node.id}`)} class="delete-form">
							<input type="hidden" name="nodeId" value={node.id} />
							<button type="submit" aria-label={`删除 ${node.name}`} disabled={pendingAction === `delete-${node.id}`}>
								<Trash2 size={16} />
							</button>
						</form>
					</article>
				{:else}
					<p class="empty-state">尚未配置流程节点，请在下方添加。</p>
				{/each}
			</div>
			<form method="post" action="?/addNode" use:enhance={enhanceForm('add-node')} class="add-node">
				<div>
					<h3>添加流程节点</h3>
					<p>新节点将添加到流程末尾，可保存后上移调整顺序。</p>
				</div>
				<label>
					<span>节点名称</span>
					<input name="name" maxlength="120" required placeholder="例如：发行结果确认" />
				</label>
				<label>
					<span>相对发行日</span>
					<input name="offsetDays" type="number" min="-3650" max="3650" step="1" required value="0" />
				</label>
				<label>
					<span>默认角色</span>
					<select name="ownerRole">
						<option value="">不指定</option>
						{#each data.roles as role}<option value={role.code}>{role.label}</option>{/each}
					</select>
				</label>
				<label>
					<span>节点说明</span>
					<input name="description" placeholder="可选" />
				</label>
				<button type="submit" disabled={pendingAction === 'add-node'}>
					<Plus size={16} />
					{pendingAction === 'add-node' ? '添加中…' : '添加节点'}
				</button>
			</form>
		</section>
	</main>

	<aside>
		<section class="panel">
			<header>
				<div>
					<h2>模板信息</h2>
					<p>适用范围和用途说明</p>
				</div>
			</header>
			<form method="post" action="?/updateTemplate" use:enhance={enhanceForm('template')} class="template-form">
				<label>
					<span>SOP 名称</span>
					<input name="name" maxlength="120" required value={data.template.name} />
				</label>
				<label>
					<span>负债品种</span>
					<input name="debtType" maxlength="80" required value={data.template.debtType} />
				</label>
				<label>
					<span>模板说明</span>
					<textarea name="description" rows="6" placeholder="说明适用范围和关键控制要求">{data.template.description ?? ''}</textarea>
				</label>
				<button type="submit" disabled={pendingAction === 'template'}>
					<Save size={16} />
					{pendingAction === 'template' ? '保存中…' : '保存模板信息'}
				</button>
			</form>
		</section>

		<section class="guidance panel">
			<h2>相对日期规则</h2>
			<ul>
				<li><strong>负数</strong>：计划发行日前，例如 -30 表示提前 30 天。</li>
				<li><strong>0</strong>：计划发行当日。</li>
				<li><strong>正数</strong>：计划发行日后，例如 5 表示发行后 5 天。</li>
			</ul>
		</section>
	</aside>
</div>

<style>
	.back-nav {
		margin-bottom: 1rem;
	}
	.detail-toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}
	.back-nav a {
		display: inline-flex;
		min-height: 2.75rem;
		align-items: center;
		gap: 0.5rem;
		font-size: 1rem;
		font-weight: 600;
		color: var(--blue);
	}
	.toggle-button {
		min-height: 2.75rem;
		padding: 0 1rem;
		border: 1px solid #d0d5dd;
		border-radius: 0.5rem;
		font-size: 1rem;
		font-weight: 700;
		color: #475467;
		background: #fff;
	}
	.toggle-button.active {
		border-color: #a6f4c5;
		color: #067647;
		background: #ecfdf3;
	}
	.feedback {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 1rem;
		padding: 0.75rem 1rem;
		border: 1px solid #fda29b;
		border-radius: 0.625rem;
		font-size: 1rem;
		color: #b42318;
		background: #fef3f2;
	}
	.feedback.success {
		border-color: #a6f4c5;
		color: #067647;
		background: #ecfdf3;
	}
	.editor-grid {
		display: grid;
		grid-template-columns: minmax(0, 1.75fr) minmax(18rem, 0.65fr);
		gap: 1rem;
		align-items: start;
	}
	main,
	aside {
		display: grid;
		min-width: 0;
		gap: 1rem;
	}
	.panel {
		overflow: hidden;
		border: 1px solid var(--line);
		border-radius: 0.75rem;
		background: var(--surface);
		box-shadow: var(--shadow);
	}
	.panel > header {
		display: flex;
		min-height: 4.5rem;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.875rem 1rem;
		border-bottom: 1px solid var(--line);
	}
	h2,
	h3 {
		margin: 0;
		font-size: 1.125rem;
		color: #1d2939;
	}
	.panel header p,
	.add-node p {
		margin: 0.2rem 0 0;
		font-size: 0.75rem;
		color: var(--subtle);
	}
	.node-card {
		display: grid;
		grid-template-columns: 3.25rem minmax(0, 1fr) 2.75rem;
		gap: 0.75rem;
		padding: 1rem;
		border-bottom: 1px solid var(--line);
	}
	.node-order {
		display: grid;
		align-content: start;
		justify-items: center;
		gap: 0.4rem;
	}
	.node-order > strong {
		display: grid;
		width: 2.25rem;
		height: 2.25rem;
		place-items: center;
		border-radius: 999rem;
		font-size: 1rem;
		color: #175cd3;
		background: #edf4ff;
	}
	.node-order > div {
		display: flex;
		gap: 0.25rem;
	}
	.node-order button,
	.delete-form button {
		display: grid;
		width: 2rem;
		height: 2rem;
		place-items: center;
		border: 1px solid #d0d5dd;
		border-radius: 0.4rem;
		color: #667085;
		background: #fff;
	}
	.node-order button:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}
	.node-form {
		display: grid;
		grid-template-columns: minmax(12rem, 1.3fr) minmax(8rem, 0.55fr) minmax(10rem, 0.75fr) auto;
		gap: 0.75rem;
		align-items: end;
	}
	.node-description {
		grid-column: 1 / -2;
	}
	label {
		display: grid;
		gap: 0.3rem;
	}
	label span {
		font-size: 0.75rem;
		font-weight: 650;
		color: var(--muted);
	}
	input,
	textarea {
		width: 100%;
		min-height: 2.75rem;
		padding: 0.55rem 0.7rem;
		border: 1px solid #d0d5dd;
		border-radius: 0.5rem;
		font-size: 1rem;
		color: #344054;
		background: #fff;
	}
	textarea {
		resize: vertical;
	}
	.offset-input {
		position: relative;
	}
	.offset-input input {
		padding-right: 2.5rem;
	}
	.offset-input small {
		position: absolute;
		top: 50%;
		right: 0.75rem;
		font-size: 0.75rem;
		color: var(--subtle);
		transform: translateY(-50%);
	}
	.save-button,
	.add-node button,
	.template-form button {
		display: inline-flex;
		min-height: 2.75rem;
		align-items: center;
		justify-content: center;
		gap: 0.4rem;
		padding: 0 0.75rem;
		border: 1px solid var(--blue);
		border-radius: 0.5rem;
		font-size: 1rem;
		font-weight: 650;
		color: #fff;
		background: var(--blue);
	}
	button:disabled {
		cursor: wait;
		opacity: 0.6;
	}
	.delete-form {
		align-self: end;
		margin-bottom: 0.1rem;
	}
	.delete-form button {
		width: 2.75rem;
		height: 2.75rem;
		color: #b42318;
	}
	.add-node {
		display: grid;
		grid-template-columns: minmax(11rem, 1fr) minmax(12rem, 1fr) minmax(8rem, 0.6fr) minmax(10rem, 0.8fr) minmax(10rem, 1fr) auto;
		align-items: end;
		gap: 0.75rem;
		padding: 1rem;
		background: #f8fafc;
	}
	.template-form {
		display: grid;
		gap: 0.875rem;
		padding: 1rem;
	}
	.guidance {
		padding: 1rem;
	}
	.guidance ul {
		display: grid;
		gap: 0.65rem;
		margin: 0.75rem 0 0;
		padding-left: 1.25rem;
	}
	.guidance li {
		font-size: 1rem;
		line-height: 1.55;
		color: var(--muted);
	}
	.empty-state {
		margin: 0;
		padding: 1.25rem;
		font-size: 1rem;
		color: var(--muted);
		text-align: center;
	}
	@media (max-width: 75rem) {
		.editor-grid {
			grid-template-columns: 1fr;
		}
	}
	@media (max-width: 64rem) {
		.node-form {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.node-description {
			grid-column: 1 / -1;
		}
		.add-node {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.add-node > div,
		.add-node button {
			grid-column: 1 / -1;
		}
	}
	@media (max-width: 51.25rem) {
		.detail-toolbar {
			align-items: flex-start;
			flex-direction: column;
		}
		.node-card {
			grid-template-columns: 2.75rem minmax(0, 1fr);
		}
		.node-form,
		.add-node {
			grid-template-columns: 1fr;
		}
		.node-description,
		.add-node > div,
		.add-node button {
			grid-column: auto;
		}
		.delete-form {
			grid-column: 2;
			justify-self: end;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		button {
			transition: none;
		}
	}
</style>
