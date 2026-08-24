<script lang="ts">
	import { CheckCircle2, CircleAlert, Info, TriangleAlert, X } from '@lucide/svelte';
	import { onDestroy } from 'svelte';
	import { prefersReducedMotion } from 'svelte/motion';
	import { fly } from 'svelte/transition';
	import { globalMessages } from '$lib/global-messages';

	let { hasReminderTicker = false }: { hasReminderTicker?: boolean } = $props();
	onDestroy(globalMessages.clear);

	function resumeAfterFocusLeaves(event: FocusEvent, id: string) {
		const region = event.currentTarget as HTMLElement;
		if (!region.contains(event.relatedTarget as Node | null)) globalMessages.resume(id, 'focus');
	}
</script>

<div class:ticker-offset={hasReminderTicker} class="global-message-region" aria-label="系统消息">
	{#each $globalMessages as item (item.id)}
		<article
			class={`global-message ${item.kind}`}
			onpointerenter={() => globalMessages.pause(item.id, 'pointer')}
			onpointerleave={() => globalMessages.resume(item.id, 'pointer')}
			onfocusin={() => globalMessages.pause(item.id, 'focus')}
			onfocusout={(event) => resumeAfterFocusLeaves(event, item.id)}
			transition:fly={{
				y: prefersReducedMotion.current ? 0 : -12,
				duration: prefersReducedMotion.current ? 0 : 180
			}}
		>
			<span class="message-icon" aria-hidden="true">
				{#if item.kind === 'success'}
					<CheckCircle2 size={20} strokeWidth={2.2} />
				{:else if item.kind === 'error'}
					<CircleAlert size={20} strokeWidth={2.2} />
				{:else if item.kind === 'warning'}
					<TriangleAlert size={20} strokeWidth={2.2} />
				{:else}
					<Info size={20} strokeWidth={2.2} />
				{/if}
			</span>
			<span
				class="message-copy"
				role={item.kind === 'error' ? 'alert' : 'status'}
				aria-atomic="true"
			>
				<strong>{item.title}</strong>
				<span>{item.message}</span>
			</span>
			<button
				type="button"
				aria-label={`关闭通知：${item.message}`}
				title="关闭通知"
				onclick={() => globalMessages.dismiss(item.id)}
			>
				<X size={18} />
			</button>
		</article>
	{/each}
</div>

<style>
	.global-message-region {
		position: fixed;
		z-index: 80;
		top: max(4.75rem, calc(env(safe-area-inset-top) + 4.75rem));
		left: 14.5rem;
		right: 0;
		display: grid;
		justify-items: center;
		gap: 0.625rem;
		padding-inline: 1rem;
		pointer-events: none;
	}

	.global-message-region.ticker-offset {
		top: max(7.375rem, calc(env(safe-area-inset-top) + 7.375rem));
	}

	.global-message {
		--message-color: var(--blue);
		display: grid;
		width: min(34rem, 100%);
		min-height: 4.25rem;
		grid-template-columns: 2.5rem minmax(0, 1fr) 2.75rem;
		align-items: center;
		gap: 0.75rem;
		padding: 0.625rem 0.625rem 0.625rem 0.75rem;
		border: 1px solid color-mix(in srgb, var(--message-color) 28%, var(--line));
		border-left: 0.25rem solid var(--message-color);
		border-radius: 0.75rem;
		color: var(--ink);
		background: rgb(255 255 255 / 97%);
		box-shadow: 0 1rem 2.5rem rgb(16 24 40 / 18%), 0 0.125rem 0.375rem rgb(16 24 40 / 8%);
		backdrop-filter: blur(0.75rem);
		pointer-events: auto;
	}

	.global-message.success { --message-color: var(--teal); }
	.global-message.error { --message-color: var(--red); }
	.global-message.warning { --message-color: var(--orange); }

	.message-icon {
		display: grid;
		width: 2.5rem;
		height: 2.5rem;
		place-items: center;
		border-radius: 0.625rem;
		color: var(--message-color);
		background: color-mix(in srgb, var(--message-color) 10%, white);
	}

	.message-copy {
		display: grid;
		min-width: 0;
		gap: 0.125rem;
		line-height: 1.45;
	}

	.message-copy strong {
		font-size: 0.75rem;
		font-weight: 760;
		letter-spacing: 0.03em;
		color: color-mix(in srgb, var(--message-color) 78%, #182230);
	}

	.message-copy > span {
		font-size: 1rem;
		color: #344054;
		overflow-wrap: anywhere;
	}

	button {
		display: grid;
		width: 2.75rem;
		height: 2.75rem;
		place-items: center;
		padding: 0;
		border: 0;
		border-radius: 0.5rem;
		color: #667085;
		background: transparent;
		cursor: pointer;
		transition: color 180ms ease, background 180ms ease;
	}

	button:hover {
		color: #1d2939;
		background: #f2f4f7;
	}

	button:focus-visible {
		outline: 0.1875rem solid rgb(47 111 237 / 22%);
		outline-offset: 0.125rem;
	}

	@media (max-width: 56.25rem) {
		.global-message-region {
			top: max(7.25rem, calc(env(safe-area-inset-top) + 7.25rem));
			left: 0;
		}

		.global-message-region.ticker-offset {
			top: max(9.875rem, calc(env(safe-area-inset-top) + 9.875rem));
		}
	}

	@media (max-width: 35rem) {
		.global-message-region {
			padding-inline: 0.5rem;
		}

		.global-message {
			grid-template-columns: 2.25rem minmax(0, 1fr) 2.75rem;
			gap: 0.625rem;
			padding-left: 0.625rem;
		}

		.message-icon {
			width: 2.25rem;
			height: 2.25rem;
		}
	}
</style>
