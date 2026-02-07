<script lang="ts">
	import { db } from '$lib/db.js';
	import { generateTID } from '$lib/tid.js';
	import { generateKeyBetween } from 'fractional-indexing';
	import type { Column, MaterializedTask, BoardPermissions } from '$lib/types.js';
	import { createOp } from '$lib/ops.js';
	import { getPermissionStatus } from '$lib/permissions.js';
	import type { PermissionStatus } from '$lib/permissions.js';
	import { getDraggedCard } from '$lib/drag-state.svelte.js';
	import TaskCard from './TaskCard.svelte';

	let {
		column,
		tasks,
		boardUri,
		did,
		boardOwnerDid,
		permissions,
		ownerTrustedDids,
		onedit
	}: {
		column: Column;
		tasks: MaterializedTask[];
		boardUri: string;
		did: string;
		boardOwnerDid: string;
		permissions: BoardPermissions;
		ownerTrustedDids: Set<string>;
		onedit: (task: MaterializedTask) => void;
	} = $props();

	const createStatus: PermissionStatus = $derived(
		getPermissionStatus(did, boardOwnerDid, ownerTrustedDids, permissions, 'create_task', column.id)
	);

	const moveStatus: PermissionStatus = $derived(
		getPermissionStatus(did, boardOwnerDid, ownerTrustedDids, permissions, 'move_task', column.id)
	);

	let newTaskTitle = $state('');
	let adding = $state(false);
	let dropIndex = $state<number | null>(null);
	let taskListEl: HTMLElement | undefined = $state();

	const sortedTasks = $derived(
		[...tasks].sort((a, b) => {
			if (a.effectivePosition < b.effectivePosition) return -1;
			if (a.effectivePosition > b.effectivePosition) return 1;
			return (a.rkey + a.did).localeCompare(b.rkey + b.did);
		})
	);

	async function addTask(e: Event) {
		e.preventDefault();
		const title = newTaskTitle.trim();
		if (!title) return;

		adding = true;
		try {
			const lastPosition = sortedTasks.at(-1)?.effectivePosition ?? null;
			await db.tasks.add({
				rkey: generateTID(),
				did,
				title,
				columnId: column.id,
				boardUri,
				position: generateKeyBetween(lastPosition, null),
				createdAt: new Date().toISOString(),
				syncStatus: 'pending'
			});
			newTaskTitle = '';
		} catch (err) {
			console.error('Failed to add task:', err);
		} finally {
			adding = false;
		}
	}

	function handleDragOver(e: DragEvent) {
		if (moveStatus === 'denied') return;
		e.preventDefault();
		if (e.dataTransfer) {
			e.dataTransfer.dropEffect = 'move';
		}

		if (!taskListEl) {
			dropIndex = sortedTasks.length;
			return;
		}

		const dragged = getDraggedCard();
		const children = Array.from(taskListEl.querySelectorAll(':scope > .card-slot')) as HTMLElement[];
		let newDropIndex = children.length;

		for (let i = 0; i < children.length; i++) {
			const rect = children[i].getBoundingClientRect();
			const midY = rect.top + rect.height / 2;
			if (e.clientY < midY) {
				newDropIndex = i;
				break;
			}
		}

		// If dragging within the same column and hovering over the card's own position, no gap needed
		if (dragged) {
			const draggedIndex = sortedTasks.findIndex(
				t => t.sourceTask.id === dragged.id && t.ownerDid === dragged.did
			);
			if (draggedIndex !== -1 && (newDropIndex === draggedIndex || newDropIndex === draggedIndex + 1)) {
				dropIndex = null;
				return;
			}
		}

		dropIndex = newDropIndex;
	}

	function isTaskPending(task: MaterializedTask): boolean {
		if (task.ownerDid === boardOwnerDid) return false;
		return getPermissionStatus(task.ownerDid, boardOwnerDid, ownerTrustedDids, permissions, 'create_task', task.columnId) === 'pending';
	}

	function handleDragLeave(e: DragEvent) {
		const relatedTarget = e.relatedTarget as Node | null;
		const currentTarget = e.currentTarget as HTMLElement;
		if (relatedTarget && currentTarget.contains(relatedTarget)) return;
		dropIndex = null;
	}

	async function handleDrop(e: DragEvent) {
		e.preventDefault();
		const currentDropIndex = dropIndex;
		dropIndex = null;

		if (!e.dataTransfer) return;
		const raw = e.dataTransfer.getData('application/x-kanban-task');
		if (!raw) return;

		let data: { id: number; did: string };
		try {
			data = JSON.parse(raw);
		} catch {
			return;
		}

		// Filter out the dragged card and compute insert position
		const filtered = sortedTasks.filter(t => !(t.sourceTask.id === data.id && t.ownerDid === data.did));
		let insertIdx = currentDropIndex ?? filtered.length;

		// Adjust for same-column drag (dragged card still in DOM)
		const draggedIndex = sortedTasks.findIndex(
			t => t.sourceTask.id === data.id && t.ownerDid === data.did
		);
		if (draggedIndex !== -1 && currentDropIndex !== null && currentDropIndex > draggedIndex) {
			insertIdx = currentDropIndex - 1;
		}
		insertIdx = Math.max(0, Math.min(insertIdx, filtered.length));

		// Generate a position between the neighbors
		const before = filtered[insertIdx - 1]?.effectivePosition ?? null;
		const after = filtered[insertIdx]?.effectivePosition ?? null;
		const newPosition = generateKeyBetween(before, after);
		const now = new Date().toISOString();

		if (data.did === did) {
			// We own this task — direct update
			await db.tasks.update(data.id, {
				columnId: column.id,
				position: newPosition,
				updatedAt: now,
				syncStatus: 'pending'
			});
		} else {
			// Not our task — create an op
			const task = await db.tasks.get(data.id);
			if (task) {
				await createOp(did, task, boardUri, {
					columnId: column.id,
					position: newPosition
				});
			}
		}
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="column"
	class:drag-over={dropIndex !== null}
	ondragover={handleDragOver}
	ondragleave={handleDragLeave}
	ondrop={handleDrop}
>
	<div class="column-header">
		<h3>{column.name}</h3>
		<span class="task-count">{tasks.length}</span>
	</div>

	<div class="task-list" bind:this={taskListEl}>
		{#each sortedTasks as task, i (task.rkey + task.did)}
			<div class="card-slot" class:drop-above={dropIndex === i}>
				<TaskCard {task} currentUserDid={did} pending={isTaskPending(task)} {onedit} />
			</div>
		{/each}
		{#if dropIndex !== null && dropIndex >= sortedTasks.length}
			<div class="drop-indicator-end"></div>
		{/if}
	</div>

	{#if createStatus !== 'denied'}
		<form class="add-task-form" onsubmit={addTask}>
			<input
				type="text"
				bind:value={newTaskTitle}
				placeholder={createStatus === 'pending' ? 'Add a task (pending approval)...' : 'Add a task...'}
				disabled={adding}
			/>
			{#if newTaskTitle.trim()}
				<button type="submit" disabled={adding}>Add</button>
			{/if}
		</form>
	{:else}
		<div class="permission-notice denied">
			<span>Author only</span>
		</div>
	{/if}
</div>

<style>
	.column {
		background: var(--color-column-bg);
		border-radius: var(--radius-lg);
		padding: 0.75rem;
		min-width: 280px;
		max-width: 340px;
		width: 100%;
		display: flex;
		flex-direction: column;
		max-height: calc(100vh - 140px);
		transition: background 0.15s;
	}

	.column.drag-over {
		background: var(--color-drag-over);
	}

	.column-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0 0.25rem 0.625rem;
	}

	.column-header h3 {
		margin: 0;
		font-size: 0.8125rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		color: var(--color-text-secondary);
	}

	.task-count {
		font-size: 0.75rem;
		color: var(--color-text-secondary);
		background: var(--color-surface);
		padding: 0.0625rem 0.375rem;
		border-radius: var(--radius-sm);
		font-weight: 500;
	}

	.task-list {
		flex: 1;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		min-height: 40px;
	}

	.card-slot {
		transition: margin-top 0.15s ease;
	}

	.card-slot.drop-above {
		margin-top: 3rem;
		position: relative;
	}

	.card-slot.drop-above::before {
		content: '';
		position: absolute;
		top: -1.625rem;
		left: 0.5rem;
		right: 0.5rem;
		height: 2px;
		background: var(--color-primary);
		border-radius: 1px;
	}

	.drop-indicator-end {
		height: 2px;
		margin: 0.5rem 0.5rem 0;
		background: var(--color-primary);
		border-radius: 1px;
	}

	.add-task-form {
		display: flex;
		gap: 0.375rem;
		margin-top: 0.5rem;
	}

	.add-task-form input {
		flex: 1;
		padding: 0.4375rem 0.625rem;
		border: 1px solid transparent;
		border-radius: var(--radius-md);
		font-size: 0.8125rem;
		background: var(--color-surface);
		color: var(--color-text);
		transition: border-color 0.15s;
	}

	.add-task-form input:focus {
		outline: none;
		border-color: var(--color-primary);
	}

	.add-task-form button {
		padding: 0.4375rem 0.75rem;
		background: var(--color-primary);
		color: white;
		border: none;
		border-radius: var(--radius-md);
		font-size: 0.8125rem;
		font-weight: 500;
		cursor: pointer;
		transition: background 0.15s;
	}

	.add-task-form button:hover:not(:disabled) {
		background: var(--color-primary-hover);
	}

	.permission-notice {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		margin-top: 0.5rem;
		padding: 0.375rem 0.625rem;
		border-radius: var(--radius-md);
		font-size: 0.75rem;
	}

	.permission-notice.denied {
		color: var(--color-text-secondary);
		font-style: italic;
		justify-content: center;
	}
</style>
