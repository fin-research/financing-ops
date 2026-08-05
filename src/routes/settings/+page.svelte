<script lang="ts">
	import './profile.css';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { Camera, CheckCircle2, KeyRound, LoaderCircle, Save, ShieldCheck, UserRound } from '@lucide/svelte';

	let { data, form } = $props();
	let avatarPreview = $state<string | null>(null);
	let avatarTouched = $state(false);
	const displayedAvatar = $derived(avatarTouched ? avatarPreview : data.profile.avatarDataUrl);
	let pendingSection = $state<'profile' | 'password' | null>(null);
	let feedback = $state<{ section: string; success: boolean; message: string } | null>(null);
	const visibleFeedback = $derived(
		feedback ?? (form?.message
			? { section: String(form.section ?? 'profile'), success: Boolean(form.success), message: String(form.message) }
			: null)
	);

	const enhanceSection = (section: 'profile' | 'password'): SubmitFunction => () => {
		pendingSection = section;
		feedback = null;
		return async ({ result, update }) => {
			await update({ reset: result.type === 'success' && section === 'password' });
			pendingSection = null;
			if (result.type === 'success' || result.type === 'failure') {
				feedback = {
					section,
					success: result.type === 'success' && Boolean(result.data?.success),
					message: String(result.data?.message ?? (result.type === 'success' ? '保存成功' : '保存失败'))
				};
			} else {
				feedback = { section, success: false, message: '请求失败，请稍后重试' };
			}
		};
	};

	const previewAvatar = (event: Event) => {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		avatarTouched = true;
		const reader = new FileReader();
		reader.onload = () => (avatarPreview = String(reader.result));
		reader.readAsDataURL(file);
	};
</script>

<svelte:head>
	<title>个人设置 · 融资工作台</title>
</svelte:head>

<div class="profile-page">
	<section class="profile-summary" aria-label="当前账号信息">
		{#if displayedAvatar}
			<img src={displayedAvatar} alt={`${data.profile.name}的头像`} />
		{:else}
			<span class="profile-initial">{data.profile.name.slice(0, 1).toUpperCase()}</span>
		{/if}
		<div>
			<strong>{data.profile.name}</strong>
			<span>@{data.profile.username}</span>
		</div>
		<span class="security-state"><ShieldCheck size={16} /> 账号已启用</span>
	</section>

	<div class="settings-grid">
		<section class="settings-card">
			<header>
				<span class="card-icon blue"><UserRound size={20} /></span>
				<div>
					<h2>个人资料</h2>
					<p>头像和姓名会显示在顶栏、项目负责人及任务分配中</p>
				</div>
			</header>
			<form method="post" action="?/updateProfile" enctype="multipart/form-data" use:enhance={enhanceSection('profile')}>
				<div class="avatar-editor">
					{#if displayedAvatar}
						<img src={displayedAvatar} alt="头像预览" />
					{:else}
						<span>{data.profile.name.slice(0, 1).toUpperCase()}</span>
					{/if}
					<div>
						<label class="upload-button">
							<Camera size={16} /> 选择头像
							<input name="avatar" type="file" accept="image/jpeg,image/png,image/webp" aria-label="选择头像文件" onchange={previewAvatar} />
						</label>
						<small>支持 JPG、PNG、WebP，文件不超过 512KB</small>
						<label class="remove-avatar"><input type="checkbox" name="removeAvatar" value="1" /> 保存时移除当前头像</label>
					</div>
				</div>

				<div class="form-grid">
					<label>
						<span>显示姓名</span>
						<input name="name" required maxlength="50" value={data.profile.name} autocomplete="name" />
					</label>
					<label>
						<span>联系邮箱</span>
						<input name="email" type="email" value={data.profile.email ?? ''} autocomplete="email" />
					</label>
					<label>
						<span>登录用户名</span>
						<input name="username" required minlength="3" maxlength="64" pattern="[A-Za-z0-9._-]+" value={data.profile.username} autocomplete="username" />
					</label>
					<label>
						<span>当前密码</span>
						<input name="currentPassword" type="password" autocomplete="current-password" aria-describedby="username-password-help" />
						<small id="username-password-help">仅修改登录用户名时需要填写</small>
					</label>
				</div>

				{#if visibleFeedback?.section === 'profile'}
					<p class:success={visibleFeedback.success} class="form-feedback" role={visibleFeedback.success ? 'status' : 'alert'} aria-live="polite">
						{#if visibleFeedback.success}<CheckCircle2 size={16} />{/if}{visibleFeedback.message}
					</p>
				{/if}
				<div class="form-actions">
					<button class="primary-action" type="submit" disabled={pendingSection !== null}>
						{#if pendingSection === 'profile'}<LoaderCircle class="spin" size={16} />{:else}<Save size={16} />{/if}
						{pendingSection === 'profile' ? '保存中…' : '保存个人资料'}
					</button>
				</div>
			</form>
		</section>

		<section class="settings-card password-card">
			<header>
				<span class="card-icon orange"><KeyRound size={20} /></span>
				<div>
					<h2>修改密码</h2>
					<p>修改后会保留当前登录，并退出其他设备上的会话</p>
				</div>
			</header>
			<form method="post" action="?/updatePassword" use:enhance={enhanceSection('password')}>
				<label>
					<span>当前密码</span>
					<input name="currentPassword" type="password" required autocomplete="current-password" />
				</label>
				<label>
					<span>新密码</span>
					<input name="newPassword" type="password" required minlength="16" autocomplete="new-password" />
					<small>至少 16 个字符</small>
				</label>
				<label>
					<span>确认新密码</span>
					<input name="confirmPassword" type="password" required minlength="16" autocomplete="new-password" />
				</label>
				{#if visibleFeedback?.section === 'password'}
					<p class:success={visibleFeedback.success} class="form-feedback" role={visibleFeedback.success ? 'status' : 'alert'} aria-live="polite">
						{#if visibleFeedback.success}<CheckCircle2 size={16} />{/if}{visibleFeedback.message}
					</p>
				{/if}
				<div class="form-actions">
					<button class="primary-action" type="submit" disabled={pendingSection !== null}>
						{#if pendingSection === 'password'}<LoaderCircle class="spin" size={16} />{:else}<KeyRound size={16} />{/if}
						{pendingSection === 'password' ? '更新中…' : '更新密码'}
					</button>
				</div>
			</form>
		</section>
	</div>
</div>
