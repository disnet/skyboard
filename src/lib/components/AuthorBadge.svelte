<script lang="ts">
	let {
		did,
		isCurrentUser = false
	}: {
		did: string;
		isCurrentUser?: boolean;
	} = $props();

	const shortDid = $derived(
		did.length > 24 ? did.slice(0, 14) + '...' + did.slice(-6) : did
	);
</script>

<span class="author-badge" class:own={isCurrentUser} title={did}>
	{shortDid}
</span>

<style>
	.author-badge {
		display: inline-block;
		font-size: 0.625rem;
		color: var(--color-text-secondary);
		background: var(--color-bg);
		padding: 0.0625rem 0.375rem;
		border-radius: var(--radius-sm);
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: monospace;
	}

	.author-badge.own {
		color: var(--color-primary);
		background: var(--color-primary-alpha, rgba(0, 102, 204, 0.08));
	}
</style>
