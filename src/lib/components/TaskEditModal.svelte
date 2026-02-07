<script lang="ts">
	import { untrack } from 'svelte';
	import { db } from '$lib/db.js';
	import type { MaterializedTask } from '$lib/types.js';
	import { createOp } from '$lib/ops.js';
	import AuthorBadge from './AuthorBadge.svelte';
	import { EditorView, basicSetup } from 'codemirror';
	import { EditorState } from '@codemirror/state';
	import { markdown } from '@codemirror/lang-markdown';
	import { languages } from '@codemirror/language-data';
	import { indentWithTab } from '@codemirror/commands';
	import { keymap, placeholder } from '@codemirror/view';

	let {
		task,
		currentUserDid,
		onclose
	}: {
		task: MaterializedTask;
		currentUserDid: string;
		onclose: () => void;
	} = $props();

	const isOwned = $derived(task.ownerDid === currentUserDid);

	// We intentionally capture initial values for editing a copy
	/* eslint-disable svelte/state-referenced-locally */
	let editTitle = $state(task.effectiveTitle);
	let editDescription = $state(task.effectiveDescription ?? '');

	let editorContainer: HTMLDivElement | undefined = $state();
	let editorView: EditorView | undefined;

	$effect(() => {
		if (!editorContainer) return;

		const initialDoc = untrack(() => editDescription);
		const state = EditorState.create({
			doc: initialDoc,
			extensions: [
				basicSetup,
				markdown({ codeLanguages: languages }),
				EditorView.lineWrapping,
				keymap.of([indentWithTab]),
				placeholder('Write a description using markdown...'),
				EditorView.updateListener.of((update) => {
					if (update.docChanged) {
						editDescription = update.state.doc.toString();
					}
				}),
				EditorView.theme({
					'&': {
						fontSize: '0.875rem',
						maxHeight: '50vh'
					},
					'.cm-scroller': {
						overflow: 'auto',
						fontFamily: 'inherit'
					},
					'.cm-content': {
						caretColor: 'var(--color-primary)',
						padding: '0.5rem 0'
					},
					'&.cm-focused': {
						outline: 'none'
					},
					'.cm-gutters': {
						display: 'none'
					}
				})
			]
		});

		editorView = new EditorView({
			state,
			parent: editorContainer
		});

		return () => {
			editorView?.destroy();
			editorView = undefined;
		};
	});

	async function save() {
		const title = editTitle.trim();
		if (!title) return;

		const description = editDescription.trim() || undefined;

		if (isOwned && task.sourceTask.id) {
			await db.tasks.update(task.sourceTask.id, {
				title,
				description,
				updatedAt: new Date().toISOString(),
				syncStatus: 'pending'
			});
		} else {
			const fields: Record<string, unknown> = {};
			if (title !== task.effectiveTitle) fields.title = title;
			if (description !== task.effectiveDescription) fields.description = description;
			if (Object.keys(fields).length > 0) {
				await createOp(currentUserDid, task.sourceTask, task.boardUri, fields);
			}
		}
		onclose();
	}

	async function deleteTask() {
		if (!isOwned || !task.sourceTask.id) return;
		if (!confirm('Delete this task?')) return;
		await db.tasks.delete(task.sourceTask.id);
		onclose();
	}

	function handleBackdropClick(e: MouseEvent) {
		if (e.target === e.currentTarget) onclose();
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			if (editorView?.hasFocus) {
				editorView.contentDOM.blur();
			} else {
				onclose();
			}
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
<div class="modal-backdrop" onclick={handleBackdropClick}>
	<div class="modal" role="dialog" aria-label="Edit Task">
		<div class="modal-header">
			<input
				class="edit-title"
				type="text"
				bind:value={editTitle}
				placeholder="Task title"
			/>
			<button class="close-btn" onclick={onclose}>&times;</button>
		</div>

		<div class="modal-body">
			<div class="field">
				<label>Description</label>
				<div class="editor-wrapper" bind:this={editorContainer}></div>
				<span class="char-count" class:over-limit={editDescription.length > 10240}>
					{editDescription.length.toLocaleString()} / 10,240
				</span>
			</div>
		</div>

		<div class="modal-footer">
			<div class="footer-left">
				<AuthorBadge did={task.ownerDid} isCurrentUser={isOwned} />
				{#if !isOwned}
					<span class="op-notice">Changes will be proposed</span>
				{/if}
			</div>
			<div class="footer-right">
				{#if isOwned}
					<button class="delete-btn" onclick={deleteTask}>Delete</button>
				{/if}
				<button class="cancel-btn" onclick={onclose}>Cancel</button>
				<button
					class="save-btn"
					onclick={save}
					disabled={!editTitle.trim() || editDescription.length > 10240}
				>
					{isOwned ? 'Save' : 'Propose'}
				</button>
			</div>
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
		max-width: 640px;
		max-height: 90vh;
		overflow-y: auto;
		box-shadow: var(--shadow-lg);
		display: flex;
		flex-direction: column;
	}

	.modal-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 1rem 1.25rem;
		border-bottom: 1px solid var(--color-border-light);
	}

	.edit-title {
		flex: 1;
		border: none;
		font-size: 1.125rem;
		font-weight: 600;
		color: var(--color-text);
		background: transparent;
		padding: 0.25rem 0;
	}

	.edit-title:focus {
		outline: none;
	}

	.edit-title::placeholder {
		color: var(--color-text-secondary);
		font-weight: 400;
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
		flex: 1;
		overflow-y: auto;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.field label {
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--color-text-secondary);
	}

	.editor-wrapper {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		overflow: hidden;
		min-height: 150px;
		background: var(--color-bg);
	}

	.editor-wrapper:focus-within {
		border-color: var(--color-primary);
	}

	.char-count {
		font-size: 0.6875rem;
		color: var(--color-text-secondary);
		text-align: right;
	}

	.char-count.over-limit {
		color: var(--color-error);
		font-weight: 500;
	}

	.modal-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 1rem 1.25rem;
		border-top: 1px solid var(--color-border-light);
		gap: 0.75rem;
	}

	.footer-left {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.op-notice {
		font-size: 0.75rem;
		color: var(--color-warning);
		font-weight: 500;
	}

	.footer-right {
		display: flex;
		gap: 0.5rem;
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

	.delete-btn {
		padding: 0.5rem 1rem;
		background: var(--color-error-bg);
		color: var(--color-error);
		border: 1px solid transparent;
		border-radius: var(--radius-md);
		font-size: 0.875rem;
		cursor: pointer;
	}

	.delete-btn:hover {
		border-color: var(--color-error);
	}
</style>
