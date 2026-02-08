<script lang="ts">
	import { onMount } from 'svelte';
	import { db } from '$lib/db.js';
	import { useLiveQuery } from '$lib/db.svelte.js';

	let online = $state(navigator.onLine);

	onMount(() => {
		const setOnline = () => (online = true);
		const setOffline = () => (online = false);
		window.addEventListener('online', setOnline);
		window.addEventListener('offline', setOffline);
		return () => {
			window.removeEventListener('online', setOnline);
			window.removeEventListener('offline', setOffline);
		};
	});

	const unsyncedCount = useLiveQuery<number>(async () => {
		const boards = await db.boards.where('syncStatus').anyOf('pending', 'error').count();
		const tasks = await db.tasks.where('syncStatus').anyOf('pending', 'error').count();
		const ops = await db.ops.where('syncStatus').anyOf('pending', 'error').count();
		const trusts = await db.trusts.where('syncStatus').anyOf('pending', 'error').count();
		const comments = await db.comments.where('syncStatus').anyOf('pending', 'error').count();
		return boards + tasks + ops + trusts + comments;
	});

	const errorCount = useLiveQuery<number>(async () => {
		const boards = await db.boards.where('syncStatus').equals('error').count();
		const tasks = await db.tasks.where('syncStatus').equals('error').count();
		const ops = await db.ops.where('syncStatus').equals('error').count();
		const trusts = await db.trusts.where('syncStatus').equals('error').count();
		const comments = await db.comments.where('syncStatus').equals('error').count();
		return boards + tasks + ops + trusts + comments;
	});

	const unsynced = $derived(unsyncedCount.current ?? 0);
	const errors = $derived(errorCount.current ?? 0);
</script>

<span class="sync-status">
	{#if !online && unsynced > 0}
		<span class="dot pending"></span>
		<span class="text">Offline ({unsynced} pending)</span>
	{:else if !online}
		<span class="dot offline"></span>
		<span class="text">Offline</span>
	{:else if errors > 0}
		<span class="dot error"></span>
		<span class="text error">Error ({errors})</span>
	{:else if unsynced > 0}
		<span class="dot pending"></span>
		<span class="text">Syncing ({unsynced})...</span>
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

	.dot.offline {
		background: var(--color-text-secondary);
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
