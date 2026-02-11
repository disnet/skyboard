<script lang="ts">
  import type { Label } from "$lib/types.js";

  let {
    labels,
    titleFilter = $bindable(""),
    selectedLabelIds = $bindable([]),
    onclose,
  }: {
    labels: Label[];
    titleFilter: string;
    selectedLabelIds: string[];
    onclose: () => void;
  } = $props();

  function toggleLabel(id: string) {
    if (selectedLabelIds.includes(id)) {
      selectedLabelIds = selectedLabelIds.filter((l) => l !== id);
    } else {
      selectedLabelIds = [...selectedLabelIds, id];
    }
  }

  function clearAll() {
    titleFilter = "";
    selectedLabelIds = [];
  }

  const hasFilters = $derived(titleFilter !== "" || selectedLabelIds.length > 0);
</script>

<div class="panel-backdrop" onclick={onclose} role="presentation">
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="panel" onclick={(e) => e.stopPropagation()} onkeydown={() => {}}>
    <div class="panel-header">
      <h3>Filter</h3>
      <button class="close-btn" onclick={onclose}>Close</button>
    </div>

    <div class="filter-section">
      <label class="filter-label" for="title-filter">Title</label>
      <input
        id="title-filter"
        class="filter-input"
        type="text"
        placeholder="Search by title..."
        bind:value={titleFilter}
      />
    </div>

    {#if labels.length > 0}
      <div class="filter-section">
        <span class="filter-label">Labels</span>
        <div class="label-pills">
          {#each labels as label (label.id)}
            <button
              class="label-pill"
              class:selected={selectedLabelIds.includes(label.id)}
              style="background: {selectedLabelIds.includes(label.id) ? label.color + '30' : label.color + '10'}; color: {label.color}; border-color: {selectedLabelIds.includes(label.id) ? label.color : label.color + '40'};"
              onclick={() => toggleLabel(label.id)}
            >
              {label.name}
            </button>
          {/each}
        </div>
      </div>
    {/if}

    {#if hasFilters}
      <button class="clear-btn" onclick={clearAll}>
        Clear all
      </button>
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

  .filter-section {
    margin-bottom: 1rem;
  }

  .filter-label {
    display: block;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--color-text-secondary);
    margin-bottom: 0.375rem;
  }

  .filter-input {
    width: 100%;
    padding: 0.4375rem 0.625rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    font-size: 0.8125rem;
    background: var(--color-bg);
    color: var(--color-text);
    outline: none;
    box-sizing: border-box;
  }

  .filter-input:focus {
    border-color: var(--color-primary);
    box-shadow: 0 0 0 2px var(--color-primary-alpha, rgba(0, 102, 204, 0.15));
  }

  .label-pills {
    display: flex;
    flex-wrap: wrap;
    gap: 0.375rem;
  }

  .label-pill {
    font-size: 0.6875rem;
    font-weight: 600;
    padding: 0.125rem 0.5rem;
    border-radius: var(--radius-sm);
    border: 1px solid;
    cursor: pointer;
    line-height: 1.4;
    transition:
      background 0.15s,
      border-color 0.15s;
  }

  .label-pill:hover {
    opacity: 0.85;
  }

  .label-pill.selected {
    box-shadow: 0 0 0 1px currentColor;
  }

  .clear-btn {
    padding: 0.375rem 0.75rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    font-size: 0.75rem;
    cursor: pointer;
    background: var(--color-surface);
    color: var(--color-text-secondary);
    transition:
      background 0.15s,
      color 0.15s;
  }

  .clear-btn:hover {
    background: var(--color-bg);
    color: var(--color-text);
  }
</style>
