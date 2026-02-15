<script lang="ts">
  import { db } from "$lib/db.js";
  import { generateTID } from "$lib/tid.js";
  import type { Board, Column, Label } from "$lib/types.js";

  let {
    board,
    onclose,
  }: {
    board: Board;
    onclose: () => void;
  } = $props();

  // We intentionally capture initial values for editing a copy
  /* eslint-disable svelte/state-referenced-locally */
  let name = $state(board.name);
  let description = $state(board.description ?? "");
  let columns = $state<Column[]>(board.columns.map((c) => ({ ...c })));
  let newColumnName = $state("");
  let labels = $state<Label[]>((board.labels ?? []).map((l) => ({ ...l })));
  let newLabelName = $state("");
  let newLabelColor = $state("#ef4444");

  const LABEL_COLORS = [
    { name: "Red", value: "#ef4444" },
    { name: "Orange", value: "#f97316" },
    { name: "Amber", value: "#f59e0b" },
    { name: "Green", value: "#22c55e" },
    { name: "Teal", value: "#14b8a6" },
    { name: "Blue", value: "#3b82f6" },
    { name: "Indigo", value: "#6366f1" },
    { name: "Violet", value: "#8b5cf6" },
    { name: "Pink", value: "#ec4899" },
    { name: "Gray", value: "#6b7280" },
  ];

  function addColumn() {
    const colName = newColumnName.trim();
    if (!colName) return;
    const maxOrder = columns.reduce((max, c) => Math.max(max, c.order), -1);
    columns.push({ id: generateTID(), name: colName, order: maxOrder + 1 });
    newColumnName = "";
  }

  function removeColumn(id: string) {
    if (columns.length <= 1) return;
    columns = columns.filter((c) => c.id !== id);
    // Reindex order
    columns.forEach((c, i) => (c.order = i));
  }

  function moveColumn(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= columns.length) return;
    const temp = columns[index];
    columns[index] = columns[target];
    columns[target] = temp;
    columns.forEach((c, i) => (c.order = i));
    // Trigger reactivity
    columns = [...columns];
  }

  function addLabel() {
    const labelName = newLabelName.trim();
    if (!labelName) return;
    labels.push({ id: generateTID(), name: labelName, color: newLabelColor });
    newLabelName = "";
  }

  function removeLabel(id: string) {
    labels = labels.filter((l) => l.id !== id);
  }

  async function save() {
    const trimmedName = name.trim();
    if (!trimmedName || !board.id) return;
    if (columns.length === 0) return;

    await db.boards.update(board.id, {
      name: trimmedName,
      description: description.trim() || undefined,
      columns: columns.map((c) => ({ ...c })),
      labels: labels.length > 0 ? labels.map((l) => ({ ...l })) : undefined,
      syncStatus: "pending",
    });

    onclose();
  }

  let mouseDownOnBackdrop = false;

  function handleBackdropMouseDown(e: MouseEvent) {
    mouseDownOnBackdrop = e.target === e.currentTarget;
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget && mouseDownOnBackdrop) onclose();
    mouseDownOnBackdrop = false;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") onclose();
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
<div class="modal-backdrop" onmousedown={handleBackdropMouseDown} onclick={handleBackdropClick}>
  <div class="modal" role="dialog" aria-label="Board Settings">
    <div class="modal-header">
      <h3>Board Settings</h3>
      <button class="close-btn" onclick={onclose}>&times;</button>
    </div>

    <div class="modal-body">
      <div class="field">
        <label for="board-name">Name</label>
        <input id="board-name" type="text" bind:value={name} />
      </div>

      <div class="field">
        <label for="board-desc">Description</label>
        <textarea id="board-desc" bind:value={description} rows="3"></textarea>
      </div>

      <div class="field">
        <!-- svelte-ignore a11y_label_has_associated_control -->
        <label>Columns</label>
        <div class="column-list">
          {#each columns as col, i (col.id)}
            <div class="column-row">
              <input
                type="text"
                bind:value={col.name}
                class="column-name-input"
              />
              <button
                class="move-btn"
                disabled={i === 0}
                onclick={() => moveColumn(i, -1)}
                title="Move up">&#8593;</button
              >
              <button
                class="move-btn"
                disabled={i === columns.length - 1}
                onclick={() => moveColumn(i, 1)}
                title="Move down">&#8595;</button
              >
              <button
                class="remove-col-btn"
                disabled={columns.length <= 1}
                onclick={() => removeColumn(col.id)}
                title="Remove column">&times;</button
              >
            </div>
          {/each}
        </div>
        <div class="add-column-row">
          <input
            type="text"
            bind:value={newColumnName}
            placeholder="New column name"
            onkeydown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addColumn();
              }
            }}
          />
          <button onclick={addColumn} disabled={!newColumnName.trim()}
            >Add</button
          >
        </div>
      </div>

      <div class="field">
        <!-- svelte-ignore a11y_label_has_associated_control -->
        <label>Labels</label>
        <div class="label-list">
          {#each labels as lbl (lbl.id)}
            <div class="label-row">
              <span
                class="color-dot"
                style="background: {lbl.color}"
              ></span>
              <input
                type="text"
                bind:value={lbl.name}
                class="label-name-input"
              />
              <select bind:value={lbl.color} class="color-select">
                {#each LABEL_COLORS as c}
                  <option value={c.value}>{c.name}</option>
                {/each}
              </select>
              <button
                class="remove-col-btn"
                onclick={() => removeLabel(lbl.id)}
                title="Remove label">&times;</button
              >
            </div>
          {/each}
        </div>
        <div class="add-label-row">
          <span
            class="color-dot"
            style="background: {newLabelColor}"
          ></span>
          <input
            type="text"
            bind:value={newLabelName}
            placeholder="New label name"
            onkeydown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addLabel();
              }
            }}
          />
          <select bind:value={newLabelColor} class="color-select">
            {#each LABEL_COLORS as c}
              <option value={c.value}>{c.name}</option>
            {/each}
          </select>
          <button onclick={addLabel} disabled={!newLabelName.trim()}
            >Add</button
          >
        </div>
      </div>
    </div>

    <div class="modal-footer">
      <button class="cancel-btn" onclick={onclose}>Cancel</button>
      <button
        class="save-btn"
        onclick={save}
        disabled={!name.trim() || columns.length === 0}
      >
        Save
      </button>
    </div>
  </div>
</div>

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: var(--color-backdrop);
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
    max-width: 480px;
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
    gap: 1rem;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }

  .field label {
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--color-text);
  }

  .field input,
  .field textarea {
    padding: 0.5rem 0.625rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    font-size: 0.875rem;
    background: var(--color-bg);
    color: var(--color-text);
    font-family: inherit;
  }

  .field input:focus,
  .field textarea:focus {
    outline: none;
    border-color: var(--color-primary);
  }

  .column-list {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }

  .column-row {
    display: flex;
    gap: 0.25rem;
    align-items: center;
  }

  .column-name-input {
    flex: 1;
    padding: 0.375rem 0.5rem !important;
    font-size: 0.8125rem !important;
  }

  .move-btn,
  .remove-col-btn {
    padding: 0.25rem 0.5rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-surface);
    color: var(--color-text-secondary);
    cursor: pointer;
    font-size: 0.8125rem;
    line-height: 1;
  }

  .move-btn:disabled,
  .remove-col-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .remove-col-btn:hover:not(:disabled) {
    background: var(--color-error-bg);
    color: var(--color-error);
    border-color: var(--color-error);
  }

  .add-column-row {
    display: flex;
    gap: 0.375rem;
    margin-top: 0.25rem;
  }

  .add-column-row input {
    flex: 1;
    padding: 0.375rem 0.5rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    font-size: 0.8125rem;
    background: var(--color-bg);
    color: var(--color-text);
  }

  .add-column-row input:focus {
    outline: none;
    border-color: var(--color-primary);
  }

  .add-column-row button {
    padding: 0.375rem 0.75rem;
    background: var(--color-primary);
    color: white;
    border: none;
    border-radius: var(--radius-md);
    font-size: 0.8125rem;
    cursor: pointer;
  }

  .add-column-row button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .label-list {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }

  .label-row {
    display: flex;
    gap: 0.25rem;
    align-items: center;
  }

  .label-name-input {
    flex: 1;
    padding: 0.375rem 0.5rem !important;
    font-size: 0.8125rem !important;
  }

  .color-dot {
    width: 0.875rem;
    height: 0.875rem;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .color-select {
    padding: 0.375rem 0.25rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    font-size: 0.75rem;
    background: var(--color-surface);
    color: var(--color-text);
    cursor: pointer;
  }

  .add-label-row {
    display: flex;
    gap: 0.375rem;
    margin-top: 0.25rem;
    align-items: center;
  }

  .add-label-row input {
    flex: 1;
    padding: 0.375rem 0.5rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    font-size: 0.8125rem;
    background: var(--color-bg);
    color: var(--color-text);
  }

  .add-label-row input:focus {
    outline: none;
    border-color: var(--color-primary);
  }

  .add-label-row button {
    padding: 0.375rem 0.75rem;
    background: var(--color-primary);
    color: white;
    border: none;
    border-radius: var(--radius-md);
    font-size: 0.8125rem;
    cursor: pointer;
  }

  .add-label-row button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
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
