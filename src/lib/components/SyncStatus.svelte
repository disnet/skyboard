<script lang="ts">
	import { db } from '$lib/db.js';
	import { useLiveQuery } from '$lib/db.svelte.js';

	const pendingCount = useLiveQuery<number>(async () => {
		const boards = await db.boards.where('syncStatus').equals('pending').count();
		const tasks = await db.tasks.where('syncStatus').equals('pending').count();
		const ops = await db.ops.where('syncStatus').equals('pending').count();
		const trusts = await db.trusts.where('syncStatus').equals('pending').count();
		return boards + tasks + ops + trusts;
	});

	const errorCount = useLiveQuery<number>(async () => {
		const boards = await db.boards.where('syncStatus').equals('error').count();
		const tasks = await db.tasks.where('syncStatus').equals('error').count();
		const ops = await db.ops.where('syncStatus').equals('error').count();
		const trusts = await db.trusts.where('syncStatus').equals('error').count();
		return boards + tasks + ops + trusts;
	});
</script>

<span class="sync-status">
	{#if (errorCount.current ?? 0) > 0}
		<span class="dot error"></span>
		<span class="text error">Error ({errorCount.current})</span>
	{:else if (pendingCount.current ?? 0) > 0}
		<span class="dot pending"></span>
		<span class="text">Syncing ({pendingCount.current})...</span>
	{:else}
		<span class="dot synced"></span>
		<span class="text">Synced</span>
	{/if}
</span>

<style>
	.sync-status {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		font-size: 0.75rem;
		color: var(--color-text-secondary);
	}

	.dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.dot.synced {
		background: var(--color-success);
	}

	.dot.pending {
		background: var(--color-warning);
		animation: pulse 1.5s ease-in-out infinite;
	}

	.dot.error {
		background: var(--color-error);
	}

	.text.error {
		color: var(--color-error);
	}

	@keyframes pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.4;
		}
	}
</style>
