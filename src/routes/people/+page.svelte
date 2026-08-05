<script lang="ts">
	import '../management.css';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import {
		CheckCircle2,
		KeyRound,
		LoaderCircle,
		MoreHorizontal,
		Plus,
		Save,
		ShieldCheck,
		UserRound,
		Users
	} from '@lucide/svelte';

	let { data } = $props();
	let personDialog: HTMLDialogElement;
	let editingPerson = $state<any>(null);
	let actionState = $state<{
		key: string;
		status: 'idle' | 'pending' | 'success' | 'error';
		message: string;
	}>({ key: '', status: 'idle', message: '' });

	const fallback = { people: [], accounts: [] };
	const peopleAccess = $derived(data?.peopleAccess ?? fallback);

	const enhanceAction = (key: string): SubmitFunction => {
		return () => {
			actionState = { key, status: 'pending', message: '正在保存，请稍候…' };
			return async ({ result, update }) => {
				if (result.type === 'success') {
					await update({ reset: false, invalidateAll: true });
					actionState = {
						key,
						status: 'success',
						message: String(result.data?.message ?? '人员信息已保存')
					};
					if (key === 'person') personDialog?.close();
					return;
				}
				await update({ reset: false, invalidateAll: false });
				actionState = {
					key,
					status: 'error',
					message:
						result.type === 'failure'
							? String(result.data?.message ?? '保存失败，请检查后重试')
							: '保存失败，请稍后重试'
				};
			};
		};
	};

	function openPerson(person: any = null) {
		editingPerson = person;
		personDialog.showModal();
	}
</script>

<svelte:head>
	<title>人员与权限 · 融资工作台</title>
</svelte:head>

<div class="management-page people-page">
	<section class="page-heading">
		<div>
			<p class="eyebrow">PEOPLE & ACCESS</p>
			<h1>人员与权限</h1>
		</div>
		<button class="primary-action" type="button" onclick={() => openPerson()}>
			<Plus size={16} />
			添加人员
		</button>
	</section>

	{#if actionState.status !== 'idle'}
		<div
			class={`action-feedback ${actionState.status}`}
			role={actionState.status === 'error' ? 'alert' : 'status'}
			aria-live="polite"
		>
			{#if actionState.status === 'pending'}<LoaderCircle size={17} class="spin" />{:else}<CheckCircle2 size={17} />{/if}
			<span>{actionState.message}</span>
		</div>
	{/if}

	<section class="people-grid">
		<article class="section-card">
			<div class="card-header">
				<div class="header-icon violet"><Users size={19} /></div>
				<div>
					<h2>项目人员</h2>
					<p>项目负责人、任务执行人和通知邮箱</p>
				</div>
				<span class="count-badge">{peopleAccess.people.length} 人</span>
			</div>
			<div class="people-list">
				{#each peopleAccess.people as person, index}
					<div class="person-item">
						<span class={`avatar-color color-${(index % 4) + 1}`}>{person.name.slice(0, 1)}</span>
						<div class="person-copy">
							<strong>{person.name}</strong>
							<p>{person.role}</p>
						</div>
						<span class="person-email">{person.email}</span>
						<span class:inactive={!person.active} class="status-badge">
							{person.active ? '在职' : '停用'}
						</span>
						<div class="person-actions">
							<button type="button" aria-label={`编辑 ${person.name}`} onclick={() => openPerson(person)}>
								<MoreHorizontal size={17} />
							</button>
							<form method="post" action="?/togglePerson" use:enhance={enhanceAction(`toggle-${person.id}`)}>
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

		<article class="section-card">
			<div class="card-header">
				<div class="header-icon green"><ShieldCheck size={19} /></div>
				<div>
					<h2>登录权限</h2>
					<p>登录账号与项目人员是两套独立身份</p>
				</div>
			</div>
			<div class="account-list">
				{#each peopleAccess.accounts as account}
					<div class="account-item">
						<span class="account-icon"><KeyRound size={17} /></span>
						<div>
							<strong>{account.username}</strong>
							<p>{account.lastLoginAt ? `最近登录 ${account.lastLoginAt}` : '尚未登录'}</p>
						</div>
						<span class="role-badge">{account.role === 'admin' ? '管理员' : '只读用户'}</span>
						<span class:inactive={!account.active} class="status-badge">
							{account.active ? '启用' : '停用'}
						</span>
					</div>
				{/each}
			</div>
			<p class="permission-note">
				<UserRound size={15} />
				管理员可修改项目、SOP、人员和提醒；只读用户仅可查看。账号密码继续通过环境变量初始化，不在页面展示。
			</p>
		</article>
	</section>

	<dialog class="config-modal" bind:this={personDialog}>
		<form
			method="post"
			action={editingPerson ? '?/updatePerson' : '?/createPerson'}
			use:enhance={enhanceAction('person')}
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
</div>

<style>
	.people-grid {
		display: grid;
		grid-template-columns: minmax(0, 1.25fr) minmax(22rem, 0.75fr);
		gap: 1rem;
	}

	.count-badge,
	.role-badge {
		padding: 0.25rem 0.5rem;
		border-radius: 999rem;
		font-size: 0.75rem;
		font-weight: 650;
		color: #475467;
		background: #f2f4f7;
	}

	.people-list,
	.account-list {
		display: grid;
	}

	.person-item {
		display: grid;
		grid-template-columns: 2.5rem minmax(9rem, 0.7fr) minmax(13rem, 1fr) auto auto;
		align-items: center;
		gap: 0.75rem;
		padding: 0.875rem 1.125rem;
		border-top: 1px solid var(--line);
	}

	.avatar-color {
		display: grid;
		width: 2.25rem;
		height: 2.25rem;
		place-items: center;
		border-radius: 0.5rem;
		font-weight: 700;
		color: #175cd3;
		background: #eff4ff;
	}

	.color-2 {
		color: #067647;
		background: #ecfdf3;
	}

	.color-3 {
		color: #b54708;
		background: #fff7ed;
	}

	.color-4 {
		color: #5925dc;
		background: #f4f3ff;
	}

	.person-copy p,
	.account-item p {
		margin: 0.1875rem 0 0;
		font-size: 0.75rem;
		color: #667085;
	}

	.person-email {
		overflow-wrap: anywhere;
		color: #475467;
	}

	.person-actions {
		display: flex;
		align-items: center;
		gap: 0.375rem;
	}

	.person-actions form {
		display: contents;
	}

	.person-actions button {
		min-width: 2.75rem;
		min-height: 2.75rem;
		border: 1px solid #e4e7ec;
		border-radius: 0.4375rem;
		color: #475467;
		background: #fff;
	}

	.person-actions .text-toggle {
		padding-inline: 0.5rem;
		font-size: 0.75rem;
	}

	.account-item {
		display: grid;
		grid-template-columns: 2.5rem minmax(0, 1fr) auto auto;
		align-items: center;
		gap: 0.625rem;
		padding: 0.875rem 1.125rem;
		border-top: 1px solid var(--line);
	}

	.account-icon {
		display: grid;
		width: 2.25rem;
		height: 2.25rem;
		place-items: center;
		border-radius: 0.5rem;
		color: #067647;
		background: #ecfdf3;
	}

	.permission-note {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
		margin: 0;
		padding: 0.875rem 1.125rem;
		border-top: 1px solid #dbe6fb;
		color: #175cd3;
		background: #f8faff;
	}

	.permission-note :global(svg) {
		flex: 0 0 auto;
		margin-top: 0.25rem;
	}

	@media (max-width: 75rem) {
		.people-grid {
			grid-template-columns: 1fr;
		}
	}

	@media (max-width: 51.25rem) {
		.person-item {
			grid-template-columns: 2.5rem minmax(0, 1fr) auto;
		}

		.person-email {
			grid-column: 2 / -1;
		}

		.person-actions {
			grid-column: 2 / -1;
		}

		.account-item {
			grid-template-columns: 2.5rem minmax(0, 1fr);
		}
	}
</style>
