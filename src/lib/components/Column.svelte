<script lang="ts">
	import { db } from '$lib/db.js';
	import { generateTID } from '$lib/tid.js';
	import type { Column, MaterializedTask } from '$lib/types.js';
	import { createOp } from '$lib/ops.js';
	import TaskCard from './TaskCard.svelte';

	let {
		column,
		tasks,
		boardUri,
		did
	}: {
		column: Column;
		tasks: MaterializedTask[];
		boardUri: string;
		did: string;
	} = $props();

	let newTaskTitle = $state('');
	let adding = $state(false);
	let dragOver = $state(false);

	const sortedTasks = $derived(
		[...tasks].sort((a, b) => a.effectiveOrder - b.effectiveOrder)
	);

	async function addTask(e: Event) {
		e.preventDefault();
		const title = newTaskTitle.trim();
		if (!title) return;

		adding = true;
		try {
			const maxOrder = tasks.reduce((max, t) => Math.max(max, t.effectiveOrder), -1);
			await db.tasks.add({
				rkey: generateTID(),
				did,
				title,
				columnId: column.id,
				boardUri,
				order: maxOrder + 1,
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
		e.preventDefault();
		if (e.dataTransfer) {
			e.dataTransfer.dropEffect = 'move';
		}
		dragOver = true;
	}

	function handleDragLeave() {
		dragOver = false;
	}

	async function handleDrop(e: DragEvent) {
		e.preventDefault();
		dragOver = false;

		if (!e.dataTransfer) return;
		const raw = e.dataTransfer.getData('application/x-kanban-task');
		if (!raw) return;

		let data: { id: number; did: string };
		try {
			data = JSON.parse(raw);
		} catch {
			return;
		}

		const maxOrder = tasks.reduce((max, t) => Math.max(max, t.effectiveOrder), -1);
		const newOrder = maxOrder + 1;

		if (data.did === did) {
			// We own this task — direct update
			await db.tasks.update(data.id, {
				columnId: column.id,
				order: newOrder,
				updatedAt: new Date().toISOString(),
				syncStatus: 'pending'
			});
		} else {
			// Not our task — create an op
			const task = await db.tasks.get(data.id);
			if (task) {
				await createOp(did, task, boardUri, {
					columnId: column.id,
					order: newOrder
				});
			}
		}
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="column"
	class:drag-over={dragOver}
	ondragover={handleDragOver}
	ondragleave={handleDragLeave}
	ondrop={handleDrop}
>
	<div class="column-header">
		<h3>{column.name}</h3>
		<span class="task-count">{tasks.length}</span>
	</div>

	<div class="task-list">
		{#each sortedTasks as task (task.rkey + task.did)}
			<TaskCard {task} currentUserDid={did} />
		{/each}
	</div>

	<form class="add-task-form" onsubmit={addTask}>
		<input
			type="text"
			bind:value={newTaskTitle}
			placeholder="Add a task..."
			disabled={adding}
		/>
		{#if newTaskTitle.trim()}
			<button type="submit" disabled={adding}>Add</button>
		{/if}
	</form>
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
</style>
