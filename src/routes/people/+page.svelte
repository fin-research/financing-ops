<script lang="ts">
	import '../management.css';
	import { enhance } from '$app/forms';
	import { invalidate } from '$app/navigation';
	import { untrack } from 'svelte';
	import type { SubmitFunction } from '@sveltejs/kit';
	import {
		BadgeCheck,
		BriefcaseBusiness,
		CheckCircle2,
		Eye,
		KeyRound,
		LoaderCircle,
		Pencil,
		Plus,
		Save,
		ShieldCheck,
		Trash2,
		UserX,
		Users
	} from '@lucide/svelte';
	import { ROLE_DEFINITIONS, roleLabel } from '$lib/roles';
	import { MIN_PASSWORD_LENGTH } from '$lib/password-policy';

	let { data } = $props();
	let personDialog: HTMLDialogElement;
	let editingPerson = $state<any>(null);
	let accountEnabled = $state(true);
	let actionState = $state<{
		key: string;
		status: 'idle' | 'pending' | 'success' | 'error';
		message: string;
	}>({ key: '', status: 'idle', message: '' });

	const fallback = { people: [] };
	let displayedPeople = $state<any[]>(untrack(() => [...(data?.peopleAccess?.people ?? fallback.people)]));
	const peopleAccess = $derived({ people: displayedPeople });
	const roleCount = (role: string) =>
		displayedPeople.filter((person: any) => person.role === role).length;
	const canManage = $derived(data?.user?.role === 'admin');

	const enhanceAction = (key: string, closeDialog = false): SubmitFunction => {
		return () => {
			actionState = { key, status: 'pending', message: '正在保存，请稍候…' };
			return async ({ result, update }) => {
				if (result.type === 'success') {
					const returnedPerson = result.data?.person ?? null;
					if (returnedPerson) {
						const exists = displayedPeople.some((person: any) => person.id === returnedPerson.id);
						displayedPeople = exists
							? displayedPeople.map((person: any) => person.id === returnedPerson.id ? returnedPerson : person)
							: [...displayedPeople, returnedPerson];
					}
					const deletedPersonId = String(result.data?.deletedPersonId ?? '');
					if (deletedPersonId) {
						displayedPeople = displayedPeople.filter((person: any) => person.id !== deletedPersonId);
					}
					await update({ reset: false, invalidateAll: false });
					if (result.data?.refreshIdentity) {
						await invalidate('financing:identity');
					}
					if (returnedPerson && editingPerson?.id === returnedPerson.id) editingPerson = returnedPerson;
					actionState = {
						key,
						status: 'success',
						message: String(result.data?.message ?? '人员与账号信息已保存')
					};
					if (closeDialog) personDialog?.close();
					return;
				}
				await update({ reset: false, invalidateAll: false });
				actionState = {
					key,
					status: 'error',
					message:
						result.type === 'failure'
							? String(result.data?.message ?? '保存失败，请检查后重试')
							: result.type === 'error' && result.error?.message
								? result.error.message
								: '保存失败，请稍后重试'
				};
			};
		};
	};

	function openPerson(person: any = null) {
		editingPerson = person;
		accountEnabled = person ? Boolean(person.accountId) : true;
		personDialog.showModal();
	}
</script>

<svelte:head>
	<title>人员与权限 · 融资工作台</title>
</svelte:head>

<div class="management-page people-page">
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

	<section class="role-grid" aria-label="系统角色">
		{#each ROLE_DEFINITIONS as role, index}
			<article class={`role-card role-${role.code}`}>
				<span class="role-icon">
					{#if index === 0}<ShieldCheck size={20} />{:else if index === 1}<BriefcaseBusiness size={20} />{:else}<Eye size={20} />{/if}
				</span>
				<div>
					<strong>{role.label}</strong>
					<p>{role.description}</p>
				</div>
				<span class="role-count">{roleCount(role.code)} 人</span>
			</article>
		{/each}
	</section>

	<section class="section-card identity-card">
		<div class="card-header">
			<div class="header-icon violet"><Users size={19} /></div>
			<h2>人员与登录权限</h2>
			<span class="count-badge">{peopleAccess.people.length} 人</span>
		</div>

		<div class="identity-table" role="table" aria-label="人员、角色与登录权限关联">
			<div class="identity-head" role="row">
				<span role="columnheader">人员</span>
				<span role="columnheader">角色</span>
				<span role="columnheader">登录邮箱</span>
				<span role="columnheader">状态</span>
				<span role="columnheader">操作</span>
			</div>
			{#each peopleAccess.people as person, index}
				<div class:inactive-row={!person.active} class="identity-row" role="row">
					<div class="person-cell" role="cell">
						<span class={`avatar-color color-${(index % 4) + 1}`}>{person.name.slice(0, 1)}</span>
						<div>
							<strong>{person.name}</strong>
							<p>{person.email ?? '未填写邮箱'}</p>
						</div>
					</div>
					<div role="cell">
						<span class={`role-badge role-${person.role}`}><BadgeCheck size={14} />{roleLabel(person.role)}</span>
					</div>
					<div class="account-cell" role="cell">
						{#if person.accountId}
							<KeyRound size={16} />
							<div>
								<strong>{person.email ?? '待设置登录邮箱'}</strong>
								<p>{person.lastLoginAt ? `最近登录 ${person.lastLoginAt}` : '尚未登录'}</p>
							</div>
						{:else}
							<span class="no-account"><UserX size={15} /> 未开通</span>
						{/if}
					</div>
					<div role="cell">
						<span class:inactive={!person.active} class="status-badge">
							{person.active ? '启用' : '停用'}
						</span>
					</div>
					<div class="person-actions" role="cell">
						{#if canManage}
							<button type="button" aria-label={`编辑 ${person.name}`} title="编辑" onclick={() => openPerson(person)}>
								<Pencil size={16} />
							</button>
							<form method="post" action="?/togglePerson" use:enhance={enhanceAction(`toggle-${person.id}`)}>
								<input type="hidden" name="id" value={person.id} />
								<input type="hidden" name="active" value={person.active ? '0' : '1'} />
								<button
									type="submit"
									class="text-action"
									disabled={actionState.status === 'pending' || data.user?.personId === person.id}
								>
									{person.active ? '停用' : '启用'}
								</button>
							</form>
							<form
								method="post"
								action="?/deletePerson"
								use:enhance={enhanceAction(`delete-${person.id}`)}
								onsubmit={(event) => {
									if (!confirm(`确定删除 ${person.name} 及其登录权限吗？项目中的负责人关联将被清空。`)) event.preventDefault();
								}}
							>
								<input type="hidden" name="id" value={person.id} />
								<button
									type="submit"
									class="danger-action"
									aria-label={`删除 ${person.name}`}
									title="删除"
									disabled={actionState.status === 'pending' || data.user?.personId === person.id}
								>
									<Trash2 size={16} />
								</button>
							</form>
						{:else}
							<span class="read-only-copy">仅管理员可维护</span>
						{/if}
					</div>
				</div>
			{:else}
				<p class="empty-state">暂无人员，请先添加人员并配置角色与登录权限。</p>
			{/each}
		</div>
	</section>

	{#if canManage}
		<button
			class="floating-create-button"
			type="button"
			onclick={() => openPerson()}
			aria-label="添加人员"
			title="添加人员"
		>
			<Plus size={23} />
		</button>
	{/if}

	<dialog class="config-modal" bind:this={personDialog}>
		<form
			method="post"
			action={editingPerson ? '?/updatePerson' : '?/createPerson'}
			use:enhance={enhanceAction('person', true)}
		>
			<div class="modal-header">
				<div>
					<p class="eyebrow">UNIFIED IDENTITY</p>
					<h2>{editingPerson ? '编辑人员与账号' : '添加人员与账号'}</h2>
					<p>工作邮箱同时作为登录标识，项目责任关系直接使用该人员主档。</p>
				</div>
				<button type="button" aria-label="关闭" onclick={() => personDialog.close()}>×</button>
			</div>
			{#if editingPerson}
				<input type="hidden" name="id" value={editingPerson.id} />
			{/if}
			<div class="form-grid">
				<label>
					<span>姓名</span>
					<input name="name" required value={editingPerson?.name ?? ''} autocomplete="name" />
				</label>
				<label>
					<span>系统角色</span>
					<select name="role" required value={editingPerson?.role ?? 'handler'}>
						{#each ROLE_DEFINITIONS as role}<option value={role.code}>{role.label}</option>{/each}
					</select>
				</label>
				<label class="wide">
					<span>工作邮箱</span>
					<input name="email" type="email" required value={editingPerson?.email ?? ''} autocomplete="email" />
				</label>
				<label class="account-switch wide">
					<input type="checkbox" bind:checked={accountEnabled} />
					<input type="hidden" name="accountEnabled" value={accountEnabled ? '1' : '0'} />
					<span>允许使用邮箱登录</span>
				</label>
				{#if accountEnabled}
					<label class="wide">
						<span>{editingPerson?.accountId ? '重置密码（留空不变）' : '初始密码'}</span>
						<input
							name="password"
							type="password"
							required={!editingPerson?.accountId}
							minlength={MIN_PASSWORD_LENGTH}
							autocomplete="new-password"
						/>
					</label>
				{/if}
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
	.role-grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 1rem;
		margin-bottom: 1rem;
	}

	.role-card {
		display: grid;
		grid-template-columns: 2.75rem minmax(0, 1fr) auto;
		align-items: center;
		gap: 0.75rem;
		padding: 0.875rem 1rem;
		border: 1px solid #dbe3ef;
		border-left-width: 0.25rem;
		border-radius: 0.625rem;
		background: #fff;
		box-shadow: var(--shadow);
	}

	.role-card.role-admin { border-left-color: #5925dc; }
	.role-card.role-handler { border-left-color: #2f6fed; }
	.role-card.role-reviewer { border-left-color: #067647; }

	.role-icon {
		display: grid;
		width: 2.5rem;
		height: 2.5rem;
		place-items: center;
		border-radius: 0.5rem;
		color: #175cd3;
		background: #eff4ff;
	}

	.role-card strong { color: #1d2939; }
	.role-card p {
		margin: 0.1875rem 0 0;
		font-size: 0.75rem;
		color: #667085;
	}

	.role-count,
	.count-badge {
		padding: 0.25rem 0.5rem;
		border-radius: 999rem;
		font-size: 0.75rem;
		font-weight: 650;
		color: #475467;
		background: #f2f4f7;
	}

	.identity-card { margin-bottom: 1rem; }

	.identity-table { border-top: 1px solid var(--line); }

	.identity-head,
	.identity-row {
		display: grid;
		grid-template-columns: minmax(14rem, 1.3fr) minmax(7rem, 0.6fr) minmax(11rem, 0.9fr) 5rem minmax(12rem, auto);
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem 1.125rem;
	}

	.identity-head {
		font-size: 0.75rem;
		font-weight: 700;
		color: #475467;
		background: #f8fafc;
	}

	.identity-row {
		min-height: 4.5rem;
		border-top: 1px solid var(--line);
		transition: background-color 180ms ease;
	}

	.identity-row:hover { background: #f8faff; }
	.identity-row.inactive-row { background: #fcfcfd; }

	.person-cell,
	.account-cell,
	.person-actions,
	.role-badge,
	.no-account {
		display: flex;
		align-items: center;
	}

	.person-cell,
	.account-cell { gap: 0.625rem; min-width: 0; }

	.person-cell p,
	.account-cell p {
		margin: 0.1875rem 0 0;
		font-size: 0.75rem;
		color: #667085;
		overflow-wrap: anywhere;
	}

	.avatar-color {
		display: grid;
		width: 2.25rem;
		height: 2.25rem;
		flex: 0 0 auto;
		place-items: center;
		border-radius: 0.5rem;
		font-weight: 700;
		color: #175cd3;
		background: #eff4ff;
	}

	.color-2 { color: #067647; background: #ecfdf3; }
	.color-3 { color: #b54708; background: #fff7ed; }
	.color-4 { color: #5925dc; background: #f4f3ff; }

	.role-badge {
		width: fit-content;
		gap: 0.25rem;
		padding: 0.25rem 0.5rem;
		border-radius: 999rem;
		font-size: 0.75rem;
		font-weight: 700;
		color: #175cd3;
		background: #eff4ff;
	}

	.role-badge.role-admin { color: #5925dc; background: #f4f3ff; }
	.role-badge.role-reviewer { color: #067647; background: #ecfdf3; }

	.no-account,
	.read-only-copy { gap: 0.3125rem; font-size: 0.75rem; color: #667085; }

	.person-actions { justify-content: flex-end; gap: 0.375rem; }
	.person-actions form { display: contents; }
	.person-actions button {
		min-width: 2.75rem;
		min-height: 2.75rem;
		padding-inline: 0.625rem;
		border: 1px solid #d0d5dd;
		border-radius: 0.4375rem;
		color: #475467;
		background: #fff;
		transition: border-color 180ms ease, background-color 180ms ease, color 180ms ease;
	}

	.person-actions button:hover:not(:disabled) { border-color: #84adff; color: #175cd3; background: #f8faff; }
	.person-actions .text-action { min-width: 3.75rem; font-size: 0.75rem; }
	.person-actions .danger-action { color: #b42318; }
	.person-actions .danger-action:hover:not(:disabled) { border-color: #fda29b; color: #b42318; background: #fef3f2; }

	.account-switch {
		grid-template-columns: 1.25rem minmax(0, 1fr) !important;
		align-items: center;
		padding: 0.625rem 0.75rem;
		border: 1px solid #dbe6fb;
		border-radius: 0.5rem;
		background: #f8faff;
	}

	.account-switch input[type='checkbox'] { width: 1.125rem; min-height: 1.125rem; }

	@media (max-width: 75rem) {
		.identity-head { display: none; }
		.identity-row {
			grid-template-columns: minmax(13rem, 1fr) minmax(7rem, auto) minmax(11rem, 1fr);
		}
		.identity-row > :nth-child(4) { grid-column: 2; }
		.person-actions { grid-column: 3; grid-row: 1 / span 2; }
	}

	@media (max-width: 51.25rem) {
		.role-grid { grid-template-columns: 1fr; }
		.identity-row {
			grid-template-columns: 1fr auto;
			align-items: start;
			padding-right: 4.75rem;
		}
		.person-cell { grid-column: 1 / -1; }
		.account-cell { grid-column: 1 / -1; }
		.identity-row > :nth-child(4) { grid-column: 2; grid-row: 2; }
		.person-actions { grid-column: 1 / -1; grid-row: auto; justify-content: flex-start; }
	}

	@media (prefers-reduced-motion: reduce) {
		.identity-row,
		.person-actions button { transition: none; }
	}
</style>
