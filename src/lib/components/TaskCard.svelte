<script lang="ts">
	import type { MaterializedTask } from '$lib/types.js';
	import AuthorBadge from './AuthorBadge.svelte';

	let {
		task,
		currentUserDid,
		onedit
	}: {
		task: MaterializedTask;
		currentUserDid: string;
		onedit: (task: MaterializedTask) => void;
	} = $props();

	const isOwned = $derived(task.ownerDid === currentUserDid);

	let wasDragged = false;

	function handleDragStart(e: DragEvent) {
		if (!e.dataTransfer || !task.sourceTask.id) return;
		wasDragged = true;
		e.dataTransfer.setData(
			'application/x-kanban-task',
			JSON.stringify({ id: task.sourceTask.id, did: task.ownerDid })
		);
		e.dataTransfer.effectAllowed = 'move';
	}

	function handleDragEnd() {
		setTimeout(() => {
			wasDragged = false;
		}, 0);
	}

	function handleClick() {
		if (wasDragged) {
			wasDragged = false;
			return;
		}
		onedit(task);
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
<div
	class="task-card"
	draggable="true"
	ondragstart={handleDragStart}
	ondragend={handleDragEnd}
	onclick={handleClick}
>
	<div class="task-title">{task.effectiveTitle}</div>
	{#if task.effectiveDescription}
		<div class="task-desc">{task.effectiveDescription}</div>
	{/if}
	<div class="task-meta">
		<AuthorBadge did={task.ownerDid} isCurrentUser={isOwned} />
		{#if task.pendingOps.length > 0}
			<span class="pending-badge" title="Has pending proposals">
				{task.pendingOps.length}
			</span>
		{/if}
	</div>
	{#if task.sourceTask.syncStatus === 'pending'}
		<span class="sync-dot pending" title="Pending sync"></span>
	{:else if task.sourceTask.syncStatus === 'error'}
		<span class="sync-dot error" title="Sync error"></span>
	{/if}
</div>

<style>
	.task-card {
		background: var(--color-surface);
		border: 1px solid var(--color-border-light);
		border-radius: var(--radius-md);
		padding: 0.625rem 0.75rem;
		cursor: grab;
		position: relative;
		transition:
			box-shadow 0.15s,
			border-color 0.15s;
	}

	.task-card:active {
		cursor: grabbing;
	}

	.task-card:hover {
		box-shadow: var(--shadow-sm);
		border-color: var(--color-border);
	}

	.task-title {
		font-size: 0.8125rem;
		font-weight: 500;
		word-break: break-word;
	}

	.task-desc {
		margin-top: 0.25rem;
		font-size: 0.75rem;
		color: var(--color-text-secondary);
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
		word-break: break-word;
	}

	.task-meta {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		margin-top: 0.375rem;
	}

	.pending-badge {
		font-size: 0.625rem;
		background: var(--color-warning);
		color: white;
		padding: 0 0.3125rem;
		border-radius: var(--radius-sm);
		font-weight: 600;
	}

	.sync-dot {
		position: absolute;
		top: 0.5rem;
		right: 0.5rem;
		width: 6px;
		height: 6px;
		border-radius: 50%;
	}

	.sync-dot.pending {
		background: var(--color-warning);
	}

	.sync-dot.error {
		background: var(--color-error);
	}
</style>
