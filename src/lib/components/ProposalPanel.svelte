<script lang="ts">
	import type { Op, Task } from '$lib/types.js';
	import { grantTrust } from '$lib/trust.js';
	import { getAuth } from '$lib/auth.svelte.js';

	let {
		proposals,
		untrustedTasks,
		boardUri,
		onclose
	}: {
		proposals: Op[];
		untrustedTasks: Task[];
		boardUri: string;
		onclose: () => void;
	} = $props();

	const auth = getAuth();

	// Group everything by author DID
	const groupedByAuthor = $derived.by(() => {
		const map = new Map<string, { ops: Op[]; tasks: Task[] }>();

		for (const task of untrustedTasks) {
			const entry = map.get(task.did) || { ops: [], tasks: [] };
			entry.tasks.push(task);
			map.set(task.did, entry);
		}

		for (const op of proposals) {
			const entry = map.get(op.did) || { ops: [], tasks: [] };
			entry.ops.push(op);
			map.set(op.did, entry);
		}

		return map;
	});

	async function trustUser(trustedDid: string) {
		if (!auth.did) return;
		await grantTrust(auth.did, trustedDid, boardUri);
	}

	function describeOp(op: Op): string {
		const parts: string[] = [];
		if (op.fields.title !== undefined) parts.push(`title to "${op.fields.title}"`);
		if (op.fields.description !== undefined) parts.push('description');
		if (op.fields.columnId !== undefined) parts.push('column');
		if (op.fields.order !== undefined) parts.push('order');
		return parts.length > 0 ? `Change ${parts.join(', ')}` : 'Unknown change';
	}

	function shortDid(did: string): string {
		return did.length > 24 ? did.slice(0, 14) + '...' + did.slice(-6) : did;
	}
</script>

<div class="panel-backdrop" onclick={onclose} role="presentation">
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="panel" onclick={(e) => e.stopPropagation()} onkeydown={() => {}}>
		<div class="panel-header">
			<h3>Pending Proposals</h3>
			<button class="close-btn" onclick={onclose}>Close</button>
		</div>

		{#if groupedByAuthor.size === 0}
			<p class="empty">No pending proposals.</p>
		{:else}
			{#each [...groupedByAuthor.entries()] as [authorDid, { ops, tasks }]}
				<div class="author-section">
					<div class="author-header">
						<span class="author-did" title={authorDid}>{shortDid(authorDid)}</span>
						<button class="trust-btn" onclick={() => trustUser(authorDid)}>
							Trust Editor
						</button>
					</div>
					{#if tasks.length > 0}
						<div class="subsection-label">Tasks ({tasks.length})</div>
						<ul class="item-list">
							{#each tasks as task}
								<li class="item">{task.title}</li>
							{/each}
						</ul>
					{/if}
					{#if ops.length > 0}
						<div class="subsection-label">Edits ({ops.length})</div>
						<ul class="item-list">
							{#each ops as op}
								<li class="item">{describeOp(op)}</li>
							{/each}
						</ul>
					{/if}
				</div>
			{/each}
		{/if}
	</div>
</div>

<style>
	.panel-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.3);
		z-index: 100;
		display: flex;
		justify-content: flex-end;
	}

	.panel {
		width: 360px;
		max-width: 90vw;
		height: 100%;
		background: var(--color-surface);
		box-shadow: var(--shadow-lg);
		overflow-y: auto;
		padding: 1rem;
	}

	.panel-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 1rem;
		padding-bottom: 0.75rem;
		border-bottom: 1px solid var(--color-border-light);
	}

	.panel-header h3 {
		margin: 0;
		font-size: 0.9375rem;
		font-weight: 600;
	}

	.close-btn {
		padding: 0.25rem 0.5rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-surface);
		color: var(--color-text-secondary);
		font-size: 0.75rem;
		cursor: pointer;
	}

	.empty {
		color: var(--color-text-secondary);
		font-size: 0.8125rem;
		text-align: center;
		padding: 2rem 0;
	}

	.author-section {
		margin-bottom: 1rem;
		padding: 0.75rem;
		background: var(--color-bg);
		border-radius: var(--radius-md);
	}

	.author-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		margin-bottom: 0.5rem;
	}

	.author-did {
		font-family: monospace;
		font-size: 0.6875rem;
		color: var(--color-text-secondary);
	}

	.subsection-label {
		font-size: 0.6875rem;
		font-weight: 600;
		color: var(--color-text-secondary);
		text-transform: uppercase;
		letter-spacing: 0.03em;
		margin-top: 0.375rem;
		margin-bottom: 0.25rem;
	}

	.trust-btn {
		padding: 0.25rem 0.625rem;
		background: var(--color-primary);
		color: white;
		border: none;
		border-radius: var(--radius-sm);
		font-size: 0.6875rem;
		font-weight: 500;
		cursor: pointer;
		white-space: nowrap;
	}

	.trust-btn:hover {
		background: var(--color-primary-hover);
	}

	.item-list {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.item {
		font-size: 0.75rem;
		color: var(--color-text-secondary);
		padding: 0.25rem 0;
		border-bottom: 1px solid var(--color-border-light);
	}

	.item:last-child {
		border-bottom: none;
	}
</style>
