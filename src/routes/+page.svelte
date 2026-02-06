<script lang="ts">
	import { db } from '$lib/db.js';
	import { useLiveQuery } from '$lib/db.svelte.js';
	import { getAuth } from '$lib/auth.svelte.js';
	import { generateTID, buildAtUri, BOARD_COLLECTION } from '$lib/tid.js';
	import type { Board, Column } from '$lib/types.js';
	import BoardCard from '$lib/components/BoardCard.svelte';

	const auth = getAuth();
	const boards = useLiveQuery<Board[]>(() => db.boards.where('did').equals(auth.did ?? '').toArray());

	let newBoardName = $state('');
	let creating = $state(false);

	async function createBoard(e: Event) {
		e.preventDefault();
		const name = newBoardName.trim();
		if (!name || !auth.did) return;

		creating = true;
		try {
			const rkey = generateTID();
			const now = new Date().toISOString();
			const defaultColumns: Column[] = [
				{ id: generateTID(), name: 'To Do', order: 0 },
				{ id: generateTID(), name: 'In Progress', order: 1 },
				{ id: generateTID(), name: 'Done', order: 2 }
			];

			await db.boards.add({
				rkey,
				did: auth.did,
				name,
				columns: defaultColumns,
				createdAt: now,
				syncStatus: 'pending'
			});

			newBoardName = '';
		} catch (err) {
			console.error('Failed to create board:', err);
		} finally {
			creating = false;
		}
	}
</script>

<div class="page">
	<div class="page-header">
		<h2>Your Boards</h2>
	</div>

	<form class="create-board-form" onsubmit={createBoard}>
		<input
			type="text"
			bind:value={newBoardName}
			placeholder="New board name..."
			disabled={creating}
			required
		/>
		<button type="submit" disabled={creating || !newBoardName.trim()}>
			{creating ? 'Creating...' : 'Create Board'}
		</button>
	</form>

	<div class="board-grid">
		{#if boards.current && boards.current.length > 0}
			{#each boards.current as board (board.id)}
				<BoardCard {board} />
			{/each}
		{:else if boards.current}
			<p class="empty">No boards yet. Create one above to get started.</p>
		{/if}
	</div>
</div>

<style>
	.page {
		max-width: 900px;
		margin: 0 auto;
		padding: 2rem 1.5rem;
	}

	.page-header {
		margin-bottom: 1.5rem;
	}

	.page-header h2 {
		margin: 0;
		font-size: 1.25rem;
		font-weight: 600;
	}

	.create-board-form {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 2rem;
	}

	.create-board-form input {
		flex: 1;
		padding: 0.625rem 0.75rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		font-size: 0.875rem;
		background: var(--color-surface);
		color: var(--color-text);
	}

	.create-board-form input:focus {
		outline: none;
		border-color: var(--color-primary);
		box-shadow: 0 0 0 2px var(--color-primary-alpha);
	}

	.create-board-form button {
		padding: 0.625rem 1.25rem;
		background: var(--color-primary);
		color: white;
		border: none;
		border-radius: var(--radius-md);
		font-size: 0.875rem;
		font-weight: 500;
		cursor: pointer;
		white-space: nowrap;
		transition: background 0.15s;
	}

	.create-board-form button:hover:not(:disabled) {
		background: var(--color-primary-hover);
	}

	.create-board-form button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.board-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
		gap: 1rem;
	}

	.empty {
		grid-column: 1 / -1;
		text-align: center;
		color: var(--color-text-secondary);
		padding: 3rem 0;
	}
</style>
