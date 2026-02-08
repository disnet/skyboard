<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onDestroy } from 'svelte';
	import { db } from '$lib/db.js';
	import { useLiveQuery } from '$lib/db.svelte.js';
	import { getAuth } from '$lib/auth.svelte.js';
	import { buildAtUri, BOARD_COLLECTION, TASK_COLLECTION, OP_COLLECTION, TRUST_COLLECTION } from '$lib/tid.js';
	import { materializeTasks } from '$lib/materialize.js';
	import { getBoardPermissions, hasPermission } from '$lib/permissions.js';
	import {
		JetstreamClient,
		loadJetstreamCursor,
		processJetstreamEvent
	} from '$lib/jetstream.js';
	import {
		fetchRemoteBoard,
		fetchRemoteTasks,
		fetchRemoteOps,
		fetchRemoteTrusts,
		seedParticipantsFromTrusts,
		fetchAllKnownParticipants,
		addKnownParticipant
	} from '$lib/remote-sync.js';
	import type { Board, Task, Op, Trust, MaterializedTask } from '$lib/types.js';
	import Column from '$lib/components/Column.svelte';
	import TaskEditModal from '$lib/components/TaskEditModal.svelte';

	const auth = getAuth();

	const ownerDid = $derived($page.params.did ?? '');
	const rkey = $derived($page.params.rkey ?? '');
	const boardUri = $derived(ownerDid && rkey ? buildAtUri(ownerDid, BOARD_COLLECTION, rkey) : '');

	let loading = $state(true);
	let error = $state<string | null>(null);

	// Redirect logged-in users to the interactive board page
	$effect(() => {
		if (auth.isLoggedIn && !auth.isLoading && board.current) {
			goto(`/board/${rkey}`, { replaceState: true });
		}
	});

	// Fetch board data from PDS on load
	$effect(() => {
		if (!ownerDid || !rkey) return;

		loading = true;
		error = null;

		(async () => {
			try {
				// Fetch the board record
				const boardData = await fetchRemoteBoard(ownerDid, BOARD_COLLECTION, rkey);
				if (!boardData) {
					error = 'Board not found';
					loading = false;
					return;
				}

				// Store board in Dexie
				const existing = await db.boards.where('rkey').equals(rkey).first();
				if (existing?.id) {
					await db.boards.update(existing.id, {
						name: boardData.name,
						description: boardData.description,
						columns: boardData.columns,
						permissions: boardData.permissions,
						createdAt: boardData.createdAt,
						syncStatus: boardData.syncStatus
					});
				} else {
					await db.boards.add(boardData as Board);
				}

				// Fetch trusts, then seed participants from them
				await fetchRemoteTrusts(ownerDid, boardUri);
				await seedParticipantsFromTrusts(boardUri);

				// Fetch owner's tasks and ops
				await Promise.all([
					fetchRemoteTasks(ownerDid, boardUri),
					fetchRemoteOps(ownerDid, boardUri)
				]);

				// Fetch all known participants' data
				await fetchAllKnownParticipants(boardUri);

				loading = false;
			} catch (err) {
				console.error('Failed to load board:', err);
				error = 'Failed to load board';
				loading = false;
			}
		})();
	});

	// Reactive queries from Dexie
	const board = useLiveQuery<Board | undefined>(() => {
		if (!rkey) return undefined;
		return db.boards.where('rkey').equals(rkey).first();
	});

	const allTasks = useLiveQuery<Task[]>(() => {
		if (!boardUri) return [];
		return db.tasks.where('boardUri').equals(boardUri).toArray();
	});

	const allOps = useLiveQuery<Op[]>(() => {
		if (!boardUri) return [];
		return db.ops.where('boardUri').equals(boardUri).toArray();
	});

	const ownerTrusts = useLiveQuery<Trust[]>(() => {
		if (!boardUri || !ownerDid) return [];
		return db.trusts
			.where('did')
			.equals(ownerDid)
			.filter((t) => t.boardUri === boardUri)
			.toArray();
	});

	const ownerTrustedDids = $derived(
		new Set((ownerTrusts.current ?? []).map((t) => t.trustedDid))
	);

	const permissions = $derived(
		board.current ? getBoardPermissions(board.current) : getBoardPermissions({ permissions: undefined } as any)
	);

	// Materialized view — pass '' as currentUserDid since viewer is not logged in
	const materializedTasks = $derived.by(() => {
		if (!allTasks.current || !allOps.current || !board.current) return [];
		return materializeTasks(
			allTasks.current,
			allOps.current,
			ownerTrustedDids,
			'',
			board.current.did,
			permissions
		);
	});

	// Group tasks by column — show board owner tasks + permitted tasks
	const tasksByColumn = $derived.by(() => {
		const map = new Map<string, MaterializedTask[]>();
		if (!board.current) return map;
		for (const col of board.current.columns) {
			map.set(col.id, []);
		}
		for (const task of materializedTasks) {
			if (task.ownerDid === board.current.did) {
				const list = map.get(task.effectiveColumnId);
				if (list) list.push(task);
				continue;
			}
			if (
				hasPermission(
					task.ownerDid,
					board.current.did,
					ownerTrustedDids,
					permissions,
					'create_task',
					task.columnId
				)
			) {
				const list = map.get(task.effectiveColumnId);
				if (list) list.push(task);
			}
		}
		return map;
	});

	const sortedColumns = $derived(
		board.current ? [...board.current.columns].sort((a, b) => a.order - b.order) : []
	);

	// --- Jetstream lifecycle ---
	let jetstreamClient: JetstreamClient | null = null;

	$effect(() => {
		if (!boardUri) return;

		loadJetstreamCursor().then((cursor) => {
			if (!cursor) {
				fetchAllKnownParticipants(boardUri).catch(console.error);
			}

			jetstreamClient = new JetstreamClient({
				wantedCollections: [TASK_COLLECTION, OP_COLLECTION, TRUST_COLLECTION],
				cursor,
				onEvent: async (event) => {
					const result = await processJetstreamEvent(event);
					if (result) {
						addKnownParticipant(result.did, result.boardUri).catch(console.error);
					}
				},
				onConnect: () => {
					console.log('Jetstream connected (public view)');
				},
				onReconnect: () => {
					console.log('Jetstream reconnected, backfilling');
					fetchAllKnownParticipants(boardUri).catch(console.error);
				},
				onError: (err) => {
					console.warn('Jetstream error:', err);
				}
			});
			jetstreamClient.connect();
		});

		const handleBeforeUnload = () => {
			jetstreamClient?.disconnect();
		};
		window.addEventListener('beforeunload', handleBeforeUnload);

		return () => {
			window.removeEventListener('beforeunload', handleBeforeUnload);
			jetstreamClient?.disconnect();
			jetstreamClient = null;
		};
	});

	let viewingTask = $state<MaterializedTask | null>(null);

	function openTaskViewer(task: MaterializedTask) {
		viewingTask = task;
	}

	let shareCopied = $state(false);
	async function shareUrl() {
		const url = `${window.location.origin}/board/${ownerDid}/${rkey}`;
		try {
			await navigator.clipboard.writeText(url);
			shareCopied = true;
			setTimeout(() => (shareCopied = false), 2000);
		} catch {
			window.prompt('Copy this link to share:', url);
		}
	}

</script>

{#if loading}
	<div class="loading-state">
		<div class="spinner"></div>
		<p>Loading board...</p>
	</div>
{:else if error}
	<div class="error-state">
		<p>{error}</p>
		<a href="/">Go to Skyboard</a>
	</div>
{:else if board.current}
	<div class="board-page">
		<div class="board-header">
			<div class="board-header-left">
				<h2>{board.current.name}</h2>
				<span class="readonly-badge">Read-only</span>
			</div>
			<div class="board-header-right">
				<button class="share-btn" onclick={shareUrl}>
					{shareCopied ? 'Copied!' : 'Share'}
				</button>
			</div>
		</div>

		<div class="readonly-banner">
			Viewing in read-only mode. <a href="/">Sign in</a> to collaborate.
		</div>

		<div class="columns-container">
			{#each sortedColumns as column (column.id)}
				<Column
					{column}
					tasks={tasksByColumn.get(column.id) ?? []}
					{boardUri}
					did={''}
					boardOwnerDid={board.current.did}
					{permissions}
					{ownerTrustedDids}
					onedit={openTaskViewer}
					readonly={true}
				/>
			{/each}
		</div>
	</div>

	{#if viewingTask}
		<TaskEditModal
			task={viewingTask}
			currentUserDid={''}
			boardOwnerDid={board.current.did}
			{permissions}
			{ownerTrustedDids}
			onclose={() => (viewingTask = null)}
			readonly={true}
		/>
	{/if}
{:else}
	<div class="error-state">
		<p>Board not found.</p>
		<a href="/">Go to Skyboard</a>
	</div>
{/if}

<style>
	.loading-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		min-height: calc(100vh - 56px);
		color: var(--color-text-secondary);
	}

	.spinner {
		width: 32px;
		height: 32px;
		border: 3px solid var(--color-border);
		border-top-color: var(--color-primary);
		border-radius: 50%;
		animation: spin 0.6s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.error-state {
		text-align: center;
		padding: 3rem;
		color: var(--color-text-secondary);
	}

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

	.board-header h2 {
		margin: 0;
		font-size: 1.125rem;
		font-weight: 600;
	}

	.readonly-badge {
		font-size: 0.6875rem;
		background: var(--color-border-light);
		color: var(--color-text-secondary);
		padding: 0.125rem 0.5rem;
		border-radius: var(--radius-sm);
		font-weight: 500;
	}

	.board-header-right {
		display: flex;
		gap: 0.5rem;
	}

	.share-btn {
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

	.share-btn:hover {
		background: var(--color-bg);
		color: var(--color-text);
	}

	.readonly-banner {
		padding: 0.5rem 1.5rem;
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
		background: var(--color-column-bg);
		border-bottom: 1px solid var(--color-border-light);
		flex-shrink: 0;
	}

	.readonly-banner a {
		color: var(--color-primary);
		font-weight: 500;
	}

	.columns-container {
		flex: 1;
		display: flex;
		gap: 0.75rem;
		padding: 1rem 1.5rem;
		overflow-x: auto;
		align-items: flex-start;
	}
</style>
