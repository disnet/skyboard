<script lang="ts">
  import type { Column } from "$lib/types.js";

  const GAP = 8;
  const PICKER_WIDTH = 220;

  let {
    columns,
    currentColumnId,
    anchorRect,
    onmove,
    onclose,
  }: {
    columns: Column[];
    currentColumnId: string;
    anchorRect: DOMRect;
    onmove: (columnId: string) => void;
    onclose: () => void;
  } = $props();

  let pickerEl: HTMLDivElement | undefined = $state();

  const pos = $derived.by(() => {
    const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
    const vh = typeof window !== "undefined" ? window.innerHeight : 800;

    let left: number;
    if (anchorRect.right + GAP + PICKER_WIDTH <= vw) {
      left = anchorRect.right + GAP;
    } else {
      left = anchorRect.left - GAP - PICKER_WIDTH;
    }
    left = Math.max(GAP, Math.min(left, vw - PICKER_WIDTH - GAP));

    let top = anchorRect.top;
    const pickerHeight = pickerEl?.offsetHeight ?? 200;
    if (top + pickerHeight > vh - GAP) {
      top = vh - GAP - pickerHeight;
    }
    top = Math.max(GAP, top);

    return { top, left };
  });

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onclose();
      return;
    }
    const num = parseInt(e.key, 10);
    if (num >= 1 && num <= 9 && num <= columns.length) {
      e.preventDefault();
      e.stopPropagation();
      onmove(columns[num - 1].id);
      onclose();
    }
  }

  let mouseDownOnBackdrop = false;

  function handleBackdropMouseDown(e: MouseEvent) {
    mouseDownOnBackdrop = e.target === e.currentTarget;
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget && mouseDownOnBackdrop) onclose();
    mouseDownOnBackdrop = false;
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="picker-backdrop"
  onmousedown={handleBackdropMouseDown}
  onclick={handleBackdropClick}
>
  <div
    class="picker"
    role="listbox"
    aria-label="Move to column"
    bind:this={pickerEl}
    style="top: {pos.top}px; left: {pos.left}px;"
  >
    {#each columns as col, i (col.id)}
      <button
        class="col-option"
        class:current={col.id === currentColumnId}
        onclick={() => {
          onmove(col.id);
          onclose();
        }}
        role="option"
        aria-selected={col.id === currentColumnId}
      >
        {#if i < 9}
          <kbd class="col-key">{i + 1}</kbd>
        {:else}
          <span class="col-key-spacer"></span>
        {/if}
        <span class="col-name">{col.name}</span>
        {#if col.id === currentColumnId}
          <span class="current-indicator">(current)</span>
        {/if}
      </button>
    {/each}
  </div>
</div>

<style>
  .picker-backdrop {
    position: fixed;
    inset: 0;
    z-index: 90;
  }

  .picker {
    position: fixed;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-lg);
    width: 220px;
    padding: 0.375rem 0;
    z-index: 91;
  }

  .col-option {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    padding: 0.4375rem 0.75rem;
    border: none;
    background: none;
    color: var(--color-text);
    font-size: 0.8125rem;
    cursor: pointer;
    text-align: left;
    transition: background 0.1s;
  }

  .col-option:hover {
    background: var(--color-bg);
  }

  .col-option.current {
    font-weight: 600;
    color: var(--color-primary);
  }

  .col-key {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    font-size: 0.6875rem;
    font-family: inherit;
    font-weight: 600;
    color: var(--color-text-secondary);
    background: var(--color-bg);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    flex-shrink: 0;
    line-height: 1;
  }

  .col-key-spacer {
    width: 18px;
    flex-shrink: 0;
  }

  .col-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .current-indicator {
    font-weight: 400;
    font-size: 0.6875rem;
    color: var(--color-text-secondary);
    flex-shrink: 0;
  }
</style>
