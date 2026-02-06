<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { db } from '$lib/db.js';
	import { useLiveQuery } from '$lib/db.svelte.js';
	import { getAuth } from '$lib/auth.svelte.js';
	import { buildAtUri, BOARD_COLLECTION } from '$lib/tid.js';
	import type { Board, Task } from '$lib/types.js';
	import Column from '$lib/components/Column.svelte';
	import BoardSettingsModal from '$lib/components/BoardSettingsModal.svelte';

	const auth = getAuth();

	const rkey = $derived($page.params.id);

	const board = useLiveQuery<Board | undefined>(() =>
		db.boards.where('rkey').equals(rkey).first()
	);

	const boardUri = $derived(
		board.current && auth.did
			? buildAtUri(auth.did, BOARD_COLLECTION, board.current.rkey)
			: ''
	);

	const tasks = useLiveQuery<Task[]>(() => {
		if (!boardUri) return [];
		return db.tasks.where('boardUri').equals(boardUri).toArray();
	});

	const tasksByColumn = $derived.by(() => {
		const map = new Map<string, Task[]>();
		if (!board.current) return map;
		for (const col of board.current.columns) {
			map.set(col.id, []);
		}
		if (tasks.current) {
			for (const task of tasks.current) {
				const list = map.get(task.columnId);
				if (list) {
					list.push(task);
				}
			}
		}
		return map;
	});

	const sortedColumns = $derived(
		board.current ? [...board.current.columns].sort((a, b) => a.order - b.order) : []
	);

	let showSettings = $state(false);

	async function deleteBoard() {
		if (!board.current?.id) return;
		if (!confirm('Delete this board and all its tasks?')) return;

		const boardId = board.current.id;
		const uri = boardUri;

		// Delete all tasks for this board
		await db.tasks.where('boardUri').equals(uri).delete();
		// Delete the board
		await db.boards.delete(boardId);

		goto('/');
	}
</script>

{#if board.current}
	<div class="board-page">
		<div class="board-header">
			<div class="board-header-left">
				<a href="/" class="back-link">Boards</a>
				<span class="separator">/</span>
				<h2>{board.current.name}</h2>
			</div>
			<div class="board-header-right">
				<button class="settings-btn" onclick={() => (showSettings = true)}>
					Settings
				</button>
				<button class="delete-btn" onclick={deleteBoard}>Delete</button>
			</div>
		</div>

		<div class="columns-container">
			{#each sortedColumns as column (column.id)}
				<Column
					{column}
					tasks={tasksByColumn.get(column.id) ?? []}
					{boardUri}
					did={auth.did ?? ''}
				/>
			{/each}
		</div>
	</div>

	{#if showSettings}
		<BoardSettingsModal board={board.current} onclose={() => (showSettings = false)} />
	{/if}
{:else}
	<div class="not-found">
		<p>Board not found.</p>
		<a href="/">Back to boards</a>
	</div>
{/if}

<style>
	.board-page {
		display: flex;
		flex-direction: column;
		height: calc(100vh - 56px);
	}

	.board-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.75rem 1.5rem;
		border-bottom: 1px solid var(--color-border-light);
		flex-shrink: 0;
	}

	.board-header-left {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.back-link {
		font-size: 0.875rem;
		color: var(--color-text-secondary);
	}

	.separator {
		color: var(--color-border);
	}

	.board-header h2 {
		margin: 0;
		font-size: 1.125rem;
		font-weight: 600;
	}

	.board-header-right {
		display: flex;
		gap: 0.5rem;
	}

	.settings-btn,
	.delete-btn {
		padding: 0.375rem 0.75rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		font-size: 0.8125rem;
		cursor: pointer;
		background: var(--color-surface);
		color: var(--color-text-secondary);
		transition:
			background 0.15s,
			color 0.15s;
	}

	.settings-btn:hover {
		background: var(--color-bg);
		color: var(--color-text);
	}

	.delete-btn:hover {
		background: var(--color-error-bg);
		color: var(--color-error);
		border-color: var(--color-error);
	}

	.columns-container {
		flex: 1;
		display: flex;
		gap: 0.75rem;
		padding: 1rem 1.5rem;
		overflow-x: auto;
		align-items: flex-start;
	}

	.not-found {
		text-align: center;
		padding: 3rem;
		color: var(--color-text-secondary);
	}
</style>
