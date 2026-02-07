<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onDestroy } from 'svelte';
	import { db } from '$lib/db.js';
	import { useLiveQuery } from '$lib/db.svelte.js';
	import { getAuth } from '$lib/auth.svelte.js';
	import { buildAtUri, BOARD_COLLECTION, TASK_COLLECTION, OP_COLLECTION, TRUST_COLLECTION } from '$lib/tid.js';
	import { materializeTasks } from '$lib/materialize.js';
	import {
		JetstreamClient,
		loadJetstreamCursor,
		processJetstreamEvent
	} from '$lib/jetstream.js';
	import { fetchAllKnownParticipants, addKnownParticipant } from '$lib/remote-sync.js';
	import type { Board, Task, Op, Trust, MaterializedTask } from '$lib/types.js';
	import Column from '$lib/components/Column.svelte';
	import BoardSettingsModal from '$lib/components/BoardSettingsModal.svelte';
	import ProposalPanel from '$lib/components/ProposalPanel.svelte';

	const auth = getAuth();

	const rkey = $derived($page.params.id);

	// The board can be owned by anyone — find it by rkey
	const board = useLiveQuery<Board | undefined>(() => {
		if (!rkey) return undefined;
		return db.boards.where('rkey').equals(rkey).first();
	});

	// Build the boardUri from the board's own DID (not necessarily the current user)
	const boardUri = $derived(
		board.current ? buildAtUri(board.current.did, BOARD_COLLECTION, board.current.rkey) : ''
	);

	// All tasks for this board from ANY user
	const allTasks = useLiveQuery<Task[]>(() => {
		if (!boardUri) return [];
		return db.tasks.where('boardUri').equals(boardUri).toArray();
	});

	// All ops for this board from ANY user
	const allOps = useLiveQuery<Op[]>(() => {
		if (!boardUri) return [];
		return db.ops.where('boardUri').equals(boardUri).toArray();
	});

	// Trust records from the current user for this board
	const trusts = useLiveQuery<Trust[]>(() => {
		if (!boardUri || !auth.did) return [];
		return db.trusts
			.where('did')
			.equals(auth.did)
			.filter((t) => t.boardUri === boardUri)
			.toArray();
	});

	// Materialized view with LWW merge
	const materializedTasks = $derived.by(() => {
		if (!allTasks.current || !allOps.current || !auth.did) return [];
		const trustedDids = new Set((trusts.current ?? []).map((t) => t.trustedDid));
		return materializeTasks(allTasks.current, allOps.current, trustedDids, auth.did);
	});

	// Pending proposals from untrusted users
	const pendingProposals = $derived(materializedTasks.flatMap((t) => t.pendingOps));

	// Tasks from untrusted DIDs (these don't show on the board until trusted)
	const untrustedTasks = $derived.by(() => {
		const trustedDids = new Set((trusts.current ?? []).map((t) => t.trustedDid));
		return (allTasks.current ?? []).filter(
			(t) => t.did !== auth.did && !trustedDids.has(t.did)
		);
	});

	// Group materialized tasks by effective column
	const tasksByColumn = $derived.by(() => {
		const map = new Map<string, MaterializedTask[]>();
		if (!board.current) return map;
		for (const col of board.current.columns) {
			map.set(col.id, []);
		}
		for (const task of materializedTasks) {
			// Only show tasks from trusted users + self
			const trustedDids = new Set((trusts.current ?? []).map((t) => t.trustedDid));
			if (task.ownerDid !== auth.did && !trustedDids.has(task.ownerDid)) continue;
			const list = map.get(task.effectiveColumnId);
			if (list) {
				list.push(task);
			}
		}
		return map;
	});

	const sortedColumns = $derived(
		board.current ? [...board.current.columns].sort((a, b) => a.order - b.order) : []
	);

	let showSettings = $state(false);
	let showProposals = $state(false);

	// --- Jetstream lifecycle ---
	let jetstreamClient: JetstreamClient | null = null;

	$effect(() => {
		if (!boardUri) return;

		// Cold start: fetch from known participants
		fetchAllKnownParticipants(boardUri).catch(console.error);

		// Start Jetstream
		loadJetstreamCursor().then((cursor) => {
			// If cursor was stale (discarded by loadJetstreamCursor), do an extra
			// PDS backfill since we'll be streaming from "now" and missed events
			if (!cursor) {
				fetchAllKnownParticipants(boardUri).catch(console.error);
			}

			jetstreamClient = new JetstreamClient({
				wantedCollections: [TASK_COLLECTION, OP_COLLECTION, TRUST_COLLECTION],
				cursor,
				onEvent: async (event) => {
					// Don't process our own events
					if (event.did === auth.did) return;
					const result = await processJetstreamEvent(event);
					if (result) {
						addKnownParticipant(result.did, result.boardUri).catch(console.error);
					}
				},
				onConnect: () => {
					console.log('Jetstream connected');
				},
				onReconnect: () => {
					// Backfill from PDS on reconnect to catch events missed during the gap
					console.log('Jetstream reconnected, backfilling from PDS');
					fetchAllKnownParticipants(boardUri).catch(console.error);
				},
				onError: (err) => {
					console.warn('Jetstream error:', err);
				}
			});
			jetstreamClient.connect();
		});

		// Save cursor on tab close as a safety net
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

	const isBoardOwner = $derived(board.current?.did === auth.did);

	let shareCopied = $state(false);
	async function shareBoardUri() {
		try {
			await navigator.clipboard.writeText(boardUri);
			shareCopied = true;
			setTimeout(() => (shareCopied = false), 2000);
		} catch {
			// Fallback: prompt with the URI
			window.prompt('Copy this board URI to share:', boardUri);
		}
	}

	async function deleteBoard() {
		if (!board.current?.id || !isBoardOwner) return;
		if (!confirm('Delete this board and all its tasks?')) return;

		const boardId = board.current.id;
		const uri = boardUri;

		await db.tasks.where('boardUri').equals(uri).delete();
		await db.ops.where('boardUri').equals(uri).delete();
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
				{#if !isBoardOwner}
					<span class="shared-badge">Shared</span>
				{/if}
			</div>
			<div class="board-header-right">
				{#if pendingProposals.length > 0 || untrustedTasks.length > 0}
					<button class="proposals-btn" onclick={() => (showProposals = true)}>
						Proposals
						<span class="badge">
							{pendingProposals.length + untrustedTasks.length}
						</span>
					</button>
				{/if}
				<button class="share-btn" onclick={shareBoardUri}>
					{shareCopied ? 'Copied!' : 'Share'}
				</button>
				{#if isBoardOwner}
					<button class="settings-btn" onclick={() => (showSettings = true)}>
						Settings
					</button>
					<button class="delete-btn" onclick={deleteBoard}>Delete</button>
				{/if}
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

	{#if showSettings && isBoardOwner}
		<BoardSettingsModal board={board.current} onclose={() => (showSettings = false)} />
	{/if}

	{#if showProposals}
		<ProposalPanel
			proposals={pendingProposals}
			{untrustedTasks}
			{boardUri}
			onclose={() => (showProposals = false)}
		/>
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

	.shared-badge {
		font-size: 0.6875rem;
		background: var(--color-primary-alpha, rgba(0, 102, 204, 0.1));
		color: var(--color-primary);
		padding: 0.125rem 0.5rem;
		border-radius: var(--radius-sm);
		font-weight: 500;
	}

	.board-header-right {
		display: flex;
		gap: 0.5rem;
	}

	.settings-btn,
	.delete-btn,
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

	.settings-btn:hover,
	.share-btn:hover {
		background: var(--color-bg);
		color: var(--color-text);
	}

	.delete-btn:hover {
		background: var(--color-error-bg);
		color: var(--color-error);
		border-color: var(--color-error);
	}

	.proposals-btn {
		padding: 0.375rem 0.75rem;
		border: 1px solid var(--color-warning);
		border-radius: var(--radius-md);
		font-size: 0.8125rem;
		cursor: pointer;
		background: var(--color-surface);
		color: var(--color-warning);
		font-weight: 500;
		display: flex;
		align-items: center;
		gap: 0.375rem;
		transition: background 0.15s;
	}

	.proposals-btn:hover {
		background: var(--color-bg);
	}

	.badge {
		font-size: 0.6875rem;
		background: var(--color-warning);
		color: white;
		padding: 0 0.375rem;
		border-radius: var(--radius-sm);
		font-weight: 600;
		min-width: 1rem;
		text-align: center;
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
