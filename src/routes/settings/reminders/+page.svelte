<script lang="ts">
	import {
		ArrowLeft,
		CheckCircle2,
		Clock3,
		Mail,
		Search,
		TriangleAlert
	} from '@lucide/svelte';

	let { data } = $props();

	const statusLabel: Record<string, string> = {
		sent: '已发送',
		pending: '待发送',
		failed: '失败'
	};
</script>

<svelte:head>
	<title>提醒发送历史 · 融资工作台</title>
</svelte:head>

<section class="page-heading">
	<div>
		<a class="back-link" href="/settings"><ArrowLeft size={16} /> 返回 SOP 与提醒</a>
		<p class="eyebrow">REMINDER DELIVERY</p>
		<h1>提醒发送历史</h1>
		<p>查询 Resend 邮件发送结果、待发记录和失败原因</p>
	</div>
</section>

<section class="summary-grid" aria-label="提醒发送汇总">
	<article>
		<span class="summary-icon all"><Mail size={19} /></span>
		<div><strong>{data.history.summary.total}</strong><span>全部记录</span></div>
	</article>
	<article>
		<span class="summary-icon sent"><CheckCircle2 size={19} /></span>
		<div><strong>{data.history.summary.sent}</strong><span>已发送</span></div>
	</article>
	<article>
		<span class="summary-icon pending"><Clock3 size={19} /></span>
		<div><strong>{data.history.summary.pending}</strong><span>待发送</span></div>
	</article>
	<article>
		<span class="summary-icon failed"><TriangleAlert size={19} /></span>
		<div><strong>{data.history.summary.failed}</strong><span>发送失败</span></div>
	</article>
</section>

<form class="filter-bar" method="get" aria-label="提醒历史筛选">
	<label>
		<span>状态</span>
		<select name="status" value={data.filters.status}>
			<option value="">全部状态</option>
			<option value="sent">已发送</option>
			<option value="pending">待发送</option>
			<option value="failed">失败</option>
		</select>
	</label>
	<label class="query-field">
		<span>关键词</span>
		<div>
			<Search size={16} />
			<input
				name="query"
				value={data.filters.query}
				placeholder="规则、目标、邮箱或失败原因"
			/>
		</div>
	</label>
	<button type="submit">查询</button>
	<a href="/settings/reminders">清除</a>
</form>

<section class="history-panel">
	<div class="table-head">
		<span>日期 / 状态</span>
		<span>提醒规则与目标</span>
		<span>收件人</span>
		<span>结果</span>
	</div>
	{#if data.history.rows.length}
		<div class="history-list">
			{#each data.history.rows as row}
				<article class="history-row">
					<div>
						<span class={`status-pill ${row.status}`}>{statusLabel[row.status] ?? row.status}</span>
						<strong>{row.deliveryDate}</strong>
						<small>{row.sentAt ?? row.createdAt}</small>
					</div>
					<div>
						<strong>{row.ruleName}</strong>
						<span>{row.targetType} · {row.targetId}</span>
					</div>
					<div class="recipient-list">
						{#each row.recipients as recipient}
							<span>{recipient}</span>
						{/each}
					</div>
					<div class:error-copy={row.status === 'failed'}>
						{#if row.status === 'failed'}
							<strong>{row.errorMessage ?? '未记录失败原因'}</strong>
							<span>请修正配置后重新执行提醒任务</span>
						{:else if row.status === 'sent'}
							<strong>Resend 已接受</strong>
							<span>{row.providerMessageId ?? '未返回消息编号'}</span>
						{:else}
							<strong>等待发送</strong>
							<span>配置密钥后执行发送任务</span>
						{/if}
					</div>
				</article>
			{/each}
		</div>
	{:else}
		<div class="empty-state">
			<Mail size={24} />
			<strong>没有匹配的提醒记录</strong>
			<p>调整筛选条件，或先运行一次提醒任务。</p>
		</div>
	{/if}
</section>

<style>
	.page-heading {
		margin-bottom: 1.25rem;
	}

	.back-link {
		display: inline-flex;
		min-height: 2.75rem;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.5rem;
		font-size: 0.75rem;
		font-weight: 650;
		color: #475467;
	}

	.eyebrow {
		margin: 0 0 0.25rem;
		font-size: 0.75rem;
		font-weight: 800;
		letter-spacing: 0.16em;
		color: #2f6fed;
	}

	h1 {
		margin: 0;
		font-size: clamp(1.5rem, 2vw, 1.875rem);
		color: #101828;
	}

	.page-heading p:last-child {
		margin: 0.375rem 0 0;
		font-size: 1rem;
		color: #667085;
	}

	.summary-grid {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 0.75rem;
		margin-bottom: 0.75rem;
	}

	.summary-grid article {
		display: flex;
		min-height: 5rem;
		align-items: center;
		gap: 0.75rem;
		padding: 1rem;
		border: 1px solid #e4e7ec;
		border-radius: 0.75rem;
		background: #fff;
	}

	.summary-icon {
		display: grid;
		width: 2.5rem;
		height: 2.5rem;
		place-items: center;
		border-radius: 0.625rem;
		color: #175cd3;
		background: #eff4ff;
	}

	.summary-icon.sent {
		color: #067647;
		background: #ecfdf3;
	}

	.summary-icon.pending {
		color: #b54708;
		background: #fffaeb;
	}

	.summary-icon.failed {
		color: #b42318;
		background: #fef3f2;
	}

	.summary-grid strong,
	.summary-grid span {
		display: block;
	}

	.summary-grid strong {
		font-size: 1.375rem;
		color: #101828;
	}

	.summary-grid div > span {
		margin-top: 0.125rem;
		font-size: 0.75rem;
		color: #667085;
	}

	.filter-bar {
		display: flex;
		align-items: end;
		gap: 0.75rem;
		margin-bottom: 0.75rem;
		padding: 0.875rem 1rem;
		border: 1px solid #e4e7ec;
		border-radius: 0.75rem;
		background: #fff;
	}

	.filter-bar label {
		display: grid;
		gap: 0.375rem;
	}

	.filter-bar label > span {
		font-size: 0.75rem;
		font-weight: 650;
		color: #475467;
	}

	.filter-bar select,
	.query-field > div,
	.filter-bar button,
	.filter-bar > a {
		min-height: 2.75rem;
		border: 1px solid #d0d5dd;
		border-radius: 0.5rem;
		font-size: 1rem;
		background: #fff;
	}

	.filter-bar select {
		min-width: 9rem;
		padding-inline: 0.75rem;
	}

	.query-field {
		flex: 1;
	}

	.query-field > div {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding-inline: 0.75rem;
		color: #667085;
	}

	.query-field input {
		width: 100%;
		border: 0;
		outline: 0;
	}

	.filter-bar button,
	.filter-bar > a {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding-inline: 1rem;
		font-weight: 650;
	}

	.filter-bar button {
		border-color: #2f6fed;
		color: #fff;
		background: #2f6fed;
	}

	.history-panel {
		overflow: hidden;
		border: 1px solid #e4e7ec;
		border-radius: 0.75rem;
		background: #fff;
	}

	.table-head,
	.history-row {
		display: grid;
		grid-template-columns: minmax(9rem, 0.8fr) minmax(12rem, 1.2fr) minmax(12rem, 1fr) minmax(14rem, 1.4fr);
		gap: 1rem;
	}

	.table-head {
		padding: 0.75rem 1rem;
		border-bottom: 1px solid #e4e7ec;
		font-size: 0.75rem;
		font-weight: 700;
		color: #667085;
		background: #f9fafb;
	}

	.history-row {
		align-items: start;
		padding: 1rem;
		border-bottom: 1px solid #eaecf0;
	}

	.history-row:last-child {
		border-bottom: 0;
	}

	.history-row > div {
		display: grid;
		gap: 0.25rem;
		min-width: 0;
	}

	.history-row strong {
		overflow-wrap: anywhere;
		font-size: 1rem;
		color: #344054;
	}

	.history-row span,
	.history-row small {
		overflow-wrap: anywhere;
		font-size: 0.75rem;
		color: #667085;
	}

	.status-pill {
		justify-self: start;
		padding: 0.25rem 0.5rem;
		border-radius: 999rem;
		font-weight: 700;
	}

	.status-pill.sent {
		color: #067647;
		background: #ecfdf3;
	}

	.status-pill.pending {
		color: #b54708;
		background: #fffaeb;
	}

	.status-pill.failed,
	.error-copy strong {
		color: #b42318;
		background: #fef3f2;
	}

	.recipient-list span {
		padding: 0.25rem 0.5rem;
		border-radius: 0.375rem;
		background: #f2f4f7;
	}

	.empty-state {
		display: grid;
		min-height: 16rem;
		place-items: center;
		align-content: center;
		gap: 0.5rem;
		padding: 2rem;
		text-align: center;
		color: #667085;
	}

	.empty-state strong {
		font-size: 1rem;
		color: #344054;
	}

	.empty-state p {
		margin: 0;
		font-size: 0.75rem;
	}

	@media (max-width: 64rem) {
		.summary-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}

		.history-panel {
			overflow-x: auto;
		}

		.table-head,
		.history-row {
			min-width: 62rem;
		}
	}

	@media (max-width: 51.25rem) {
		.filter-bar {
			align-items: stretch;
			flex-direction: column;
		}

		.filter-bar select {
			width: 100%;
		}
	}

	@media (max-width: 35rem) {
		.summary-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
