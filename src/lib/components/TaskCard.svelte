<script lang="ts">
	import { db } from '$lib/db.js';
	import type { MaterializedTask } from '$lib/types.js';
	import { shouldCreateOp, createOp } from '$lib/ops.js';
	import AuthorBadge from './AuthorBadge.svelte';

	let {
		task,
		currentUserDid
	}: {
		task: MaterializedTask;
		currentUserDid: string;
	} = $props();

	let editing = $state(false);
	let editTitle = $state('');
	let editDescription = $state('');

	const isOwned = $derived(task.ownerDid === currentUserDid);

	function startEdit() {
		editTitle = task.effectiveTitle;
		editDescription = task.effectiveDescription ?? '';
		editing = true;
	}

	async function saveEdit() {
		const title = editTitle.trim();
		if (!title) return;

		const description = editDescription.trim() || undefined;

		if (isOwned && task.sourceTask.id) {
			// Direct edit — we own this task
			await db.tasks.update(task.sourceTask.id, {
				title,
				description,
				updatedAt: new Date().toISOString(),
				syncStatus: 'pending'
			});
		} else {
			// Create an op — we don't own this task
			const fields: Record<string, unknown> = {};
			if (title !== task.effectiveTitle) fields.title = title;
			if (description !== task.effectiveDescription) fields.description = description;
			if (Object.keys(fields).length > 0) {
				await createOp(currentUserDid, task.sourceTask, task.boardUri, fields);
			}
		}
		editing = false;
	}

	async function deleteTask() {
		if (!isOwned || !task.sourceTask.id) return;
		await db.tasks.delete(task.sourceTask.id);
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') editing = false;
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			saveEdit();
		}
	}

	function handleDragStart(e: DragEvent) {
		if (!e.dataTransfer || !task.sourceTask.id) return;
		// Encode both the task ID and the owner DID so the column can decide op vs direct
		e.dataTransfer.setData(
			'application/x-kanban-task',
			JSON.stringify({ id: task.sourceTask.id, did: task.ownerDid })
		);
		e.dataTransfer.effectAllowed = 'move';
	}
</script>

{#if editing}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="task-card editing" onkeydown={handleKeydown}>
		<input
			class="edit-title"
			type="text"
			bind:value={editTitle}
			placeholder="Task title"
		/>
		<textarea
			class="edit-desc"
			bind:value={editDescription}
			placeholder="Description (optional)"
			rows="2"
		></textarea>
		<div class="edit-actions">
			<button class="save-btn" onclick={saveEdit}>Save</button>
			<button class="cancel-btn" onclick={() => (editing = false)}>Cancel</button>
			{#if isOwned}
				<button class="delete-btn" onclick={deleteTask}>Delete</button>
			{/if}
		</div>
	</div>
{:else}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="task-card"
		draggable="true"
		ondragstart={handleDragStart}
		ondblclick={startEdit}
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
{/if}

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

	.task-card.editing {
		cursor: default;
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

	.edit-title {
		width: 100%;
		padding: 0.375rem 0.5rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		font-size: 0.8125rem;
		font-weight: 500;
		background: var(--color-bg);
		color: var(--color-text);
		margin-bottom: 0.375rem;
	}

	.edit-title:focus {
		outline: none;
		border-color: var(--color-primary);
	}

	.edit-desc {
		width: 100%;
		padding: 0.375rem 0.5rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		font-size: 0.75rem;
		background: var(--color-bg);
		color: var(--color-text);
		resize: vertical;
		font-family: inherit;
		margin-bottom: 0.375rem;
	}

	.edit-desc:focus {
		outline: none;
		border-color: var(--color-primary);
	}

	.edit-actions {
		display: flex;
		gap: 0.375rem;
	}

	.edit-actions button {
		padding: 0.25rem 0.5rem;
		border: none;
		border-radius: var(--radius-sm);
		font-size: 0.75rem;
		cursor: pointer;
	}

	.save-btn {
		background: var(--color-primary);
		color: white;
	}

	.cancel-btn {
		background: var(--color-bg);
		color: var(--color-text-secondary);
		border: 1px solid var(--color-border) !important;
	}

	.delete-btn {
		background: var(--color-error-bg);
		color: var(--color-error);
		margin-left: auto;
	}
</style>
