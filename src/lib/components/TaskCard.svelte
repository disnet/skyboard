<script lang="ts">
	import type { MaterializedTask } from '$lib/types.js';
	import { Marked } from 'marked';
	import DOMPurify from 'dompurify';
	import AuthorBadge from './AuthorBadge.svelte';

	const marked = new Marked();

	DOMPurify.addHook('afterSanitizeAttributes', (node) => {
		if (node.tagName === 'A') {
			node.setAttribute('rel', 'noopener noreferrer');
		}
	});

	let {
		task,
		currentUserDid,
		pending = false,
		onedit
	}: {
		task: MaterializedTask;
		currentUserDid: string;
		pending?: boolean;
		onedit: (task: MaterializedTask) => void;
	} = $props();

	const renderedDescription = $derived(
		task.effectiveDescription
			? DOMPurify.sanitize(marked.parse(task.effectiveDescription) as string)
			: ''
	);

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
	class:task-pending={pending}
	draggable="true"
	ondragstart={handleDragStart}
	ondragend={handleDragEnd}
	onclick={handleClick}
>
	{#if pending}
		<div class="pending-bar">
			<span class="info-icon" title="Pending acceptance from board creator">i</span>
			<span>Pending approval</span>
		</div>
	{/if}
	<div class="task-title">{task.effectiveTitle}</div>
	{#if task.effectiveDescription}
		<div class="task-desc">{@html renderedDescription}</div>
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

	.task-card.task-pending {
		opacity: 0.55;
		border-style: dashed;
	}

	.pending-bar {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		font-size: 0.625rem;
		color: var(--color-text-secondary);
		margin-bottom: 0.375rem;
	}

	.info-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 0.875rem;
		height: 0.875rem;
		border-radius: 50%;
		background: var(--color-border);
		color: var(--color-surface);
		font-size: 0.5rem;
		font-weight: 700;
		font-style: italic;
		flex-shrink: 0;
	}

	.task-title {
		font-size: 0.8125rem;
		font-weight: 500;
		word-break: break-word;
	}

	.task-desc {
		margin-top: 0.25rem;
		font-size: 0.75rem;
		line-height: 1.4;
		color: var(--color-text-secondary);
		max-height: calc(7 * 1.4em);
		overflow: hidden;
		word-break: break-word;
		-webkit-mask-image: linear-gradient(to bottom, black 70%, transparent 100%);
		mask-image: linear-gradient(to bottom, black 70%, transparent 100%);
	}

	.task-desc :global(p),
	.task-desc :global(h1),
	.task-desc :global(h2),
	.task-desc :global(h3),
	.task-desc :global(h4),
	.task-desc :global(h5),
	.task-desc :global(h6) {
		margin: 0 0 0.25em;
	}

	.task-desc :global(h1),
	.task-desc :global(h2),
	.task-desc :global(h3),
	.task-desc :global(h4),
	.task-desc :global(h5),
	.task-desc :global(h6) {
		font-size: 0.8125rem;
		font-weight: 600;
	}

	.task-desc :global(ul),
	.task-desc :global(ol) {
		margin: 0 0 0.25em;
		padding-left: 1.25em;
	}

	.task-desc :global(li) {
		margin: 0;
	}

	.task-desc :global(code) {
		font-size: 0.6875rem;
		background: var(--color-border-light);
		padding: 0.1em 0.3em;
		border-radius: var(--radius-sm);
	}

	.task-desc :global(pre) {
		margin: 0.25em 0;
		padding: 0.375em 0.5em;
		background: var(--color-border-light);
		border-radius: var(--radius-sm);
		overflow: hidden;
	}

	.task-desc :global(pre code) {
		background: none;
		padding: 0;
	}

	.task-desc :global(blockquote) {
		margin: 0.25em 0;
		padding-left: 0.5em;
		border-left: 2px solid var(--color-border);
		color: var(--color-text-secondary);
	}

	.task-desc :global(:last-child) {
		margin-bottom: 0;
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
