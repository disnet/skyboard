<script lang="ts">
	import { db } from '$lib/db.js';
	import type { Board, BoardPermissions, PermissionRule, PermissionScope, OperationType } from '$lib/types.js';
	import { getBoardPermissions, getEffectiveScope } from '$lib/permissions.js';

	let {
		board,
		onclose
	}: {
		board: Board;
		onclose: () => void;
	} = $props();

	const OPERATIONS: { key: OperationType; label: string; showColumns: boolean }[] = [
		{ key: 'create_task', label: 'Create tasks', showColumns: true },
		{ key: 'edit_title', label: 'Edit title', showColumns: false },
		{ key: 'edit_description', label: 'Edit description', showColumns: false },
		{ key: 'move_task', label: 'Move between columns', showColumns: false },
		{ key: 'reorder', label: 'Reorder within column', showColumns: false },
		{ key: 'comment', label: 'Comment on tasks', showColumns: false }
	];

	const SCOPES: { key: PermissionScope; label: string }[] = [
		{ key: 'author_only', label: 'Author only' },
		{ key: 'trusted', label: 'Trusted' },
		{ key: 'anyone', label: 'Anyone' }
	];

	const currentPerms = getBoardPermissions(board);

	// Initialize state from current permissions
	/* eslint-disable svelte/state-referenced-locally */
	let operationStates = $state(
		OPERATIONS.map((op) => {
			const rules = currentPerms.rules.filter((r) => r.operation === op.key);
			const globalRule = rules.find((r) => !r.columnIds || r.columnIds.length === 0);
			const columnRules = rules.filter((r) => r.columnIds && r.columnIds.length > 0);
			const scope: PermissionScope = globalRule?.scope ?? 'author_only';

			return {
				operation: op.key,
				scope,
				useColumnRestrictions: columnRules.length > 0 && !globalRule,
				columnIds: columnRules.flatMap((r) => r.columnIds ?? [])
			};
		})
	);

	function setScope(index: number, scope: PermissionScope) {
		operationStates[index].scope = scope;
		if (scope === 'author_only') {
			operationStates[index].useColumnRestrictions = false;
			operationStates[index].columnIds = [];
		}
	}

	function toggleColumnRestrictions(index: number) {
		operationStates[index].useColumnRestrictions = !operationStates[index].useColumnRestrictions;
		if (!operationStates[index].useColumnRestrictions) {
			operationStates[index].columnIds = [];
		}
	}

	function toggleColumn(index: number, columnId: string) {
		const state = operationStates[index];
		if (state.columnIds.includes(columnId)) {
			state.columnIds = state.columnIds.filter((id) => id !== columnId);
		} else {
			state.columnIds = [...state.columnIds, columnId];
		}
	}

	function buildPermissions(): BoardPermissions {
		const rules: PermissionRule[] = [];
		for (const state of operationStates) {
			if (state.useColumnRestrictions && state.columnIds.length > 0) {
				rules.push({
					operation: state.operation,
					scope: state.scope,
					columnIds: [...state.columnIds]
				});
			} else {
				rules.push({
					operation: state.operation,
					scope: state.scope
				});
			}
		}
		return { rules };
	}

	async function save() {
		if (!board.id) return;
		const permissions = buildPermissions();
		await db.boards.update(board.id, {
			permissions,
			syncStatus: 'pending'
		});
		onclose();
	}

	function handleBackdropClick(e: MouseEvent) {
		if (e.target === e.currentTarget) onclose();
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onclose();
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
<div class="modal-backdrop" onclick={handleBackdropClick}>
	<div class="modal" role="dialog" aria-label="Board Permissions">
		<div class="modal-header">
			<h3>Permissions</h3>
			<button class="close-btn" onclick={onclose}>&times;</button>
		</div>

		<div class="modal-body">
			<p class="description">
				Control what other users can do on this board. The board author always has full access.
			</p>

			{#each OPERATIONS as op, i (op.key)}
				<div class="permission-row">
					<div class="permission-label">{op.label}</div>
					<div class="scope-selector">
						{#each SCOPES as scope (scope.key)}
							<button
								class="scope-btn"
								class:active={operationStates[i].scope === scope.key}
								onclick={() => setScope(i, scope.key)}
							>
								{scope.label}
							</button>
						{/each}
					</div>
					{#if op.showColumns && operationStates[i].scope !== 'author_only'}
						<div class="column-restrictions">
							<label class="restrict-toggle">
								<input
									type="checkbox"
									checked={operationStates[i].useColumnRestrictions}
									onchange={() => toggleColumnRestrictions(i)}
								/>
								Restrict to specific columns
							</label>
							{#if operationStates[i].useColumnRestrictions}
								<div class="column-checkboxes">
									{#each board.columns as col (col.id)}
										<label class="column-check">
											<input
												type="checkbox"
												checked={operationStates[i].columnIds.includes(col.id)}
												onchange={() => toggleColumn(i, col.id)}
											/>
											{col.name}
										</label>
									{/each}
								</div>
							{/if}
						</div>
					{/if}
				</div>
			{/each}
		</div>

		<div class="modal-footer">
			<button class="cancel-btn" onclick={onclose}>Cancel</button>
			<button class="save-btn" onclick={save}>Save</button>
		</div>
	</div>
</div>

<style>
	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.4);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 100;
		padding: 1rem;
	}

	.modal {
		background: var(--color-surface);
		border-radius: var(--radius-lg);
		width: 100%;
		max-width: 520px;
		max-height: 90vh;
		overflow-y: auto;
		box-shadow: var(--shadow-lg);
	}

	.modal-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 1rem 1.25rem;
		border-bottom: 1px solid var(--color-border-light);
	}

	.modal-header h3 {
		margin: 0;
		font-size: 1rem;
		font-weight: 600;
	}

	.close-btn {
		background: none;
		border: none;
		font-size: 1.25rem;
		color: var(--color-text-secondary);
		cursor: pointer;
		padding: 0.25rem;
		line-height: 1;
	}

	.modal-body {
		padding: 1.25rem;
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}

	.description {
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
		margin: 0;
	}

	.permission-row {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.permission-label {
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--color-text);
	}

	.scope-selector {
		display: flex;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		overflow: hidden;
	}

	.scope-btn {
		flex: 1;
		padding: 0.375rem 0.5rem;
		border: none;
		background: var(--color-bg);
		color: var(--color-text-secondary);
		font-size: 0.75rem;
		cursor: pointer;
		transition: background 0.15s, color 0.15s;
	}

	.scope-btn:not(:last-child) {
		border-right: 1px solid var(--color-border);
	}

	.scope-btn.active {
		background: var(--color-primary);
		color: white;
		font-weight: 500;
	}

	.scope-btn:hover:not(.active) {
		background: var(--color-surface);
		color: var(--color-text);
	}

	.column-restrictions {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		padding-left: 0.25rem;
	}

	.restrict-toggle {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		font-size: 0.75rem;
		color: var(--color-text-secondary);
		cursor: pointer;
	}

	.restrict-toggle input {
		margin: 0;
	}

	.column-checkboxes {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.75rem;
		padding-left: 1.25rem;
	}

	.column-check {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		font-size: 0.75rem;
		color: var(--color-text);
		cursor: pointer;
	}

	.column-check input {
		margin: 0;
	}

	.modal-footer {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
		padding: 1rem 1.25rem;
		border-top: 1px solid var(--color-border-light);
	}

	.cancel-btn {
		padding: 0.5rem 1rem;
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		font-size: 0.875rem;
		color: var(--color-text-secondary);
		cursor: pointer;
	}

	.save-btn {
		padding: 0.5rem 1rem;
		background: var(--color-primary);
		color: white;
		border: none;
		border-radius: var(--radius-md);
		font-size: 0.875rem;
		font-weight: 500;
		cursor: pointer;
	}

	.save-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
