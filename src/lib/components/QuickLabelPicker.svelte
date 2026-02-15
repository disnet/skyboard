<script lang="ts">
  import type { Label } from "$lib/types.js";

  const GAP = 8;
  const PICKER_WIDTH = 220;

  let {
    labels,
    activeLabelIds,
    anchorRect,
    ontogglelabel,
    onclose,
  }: {
    labels: Label[];
    activeLabelIds: string[];
    anchorRect: DOMRect;
    ontogglelabel: (id: string) => void;
    onclose: () => void;
  } = $props();

  let pickerEl: HTMLDivElement | undefined = $state();

  const pos = $derived.by(() => {
    const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
    const vh = typeof window !== "undefined" ? window.innerHeight : 800;

    // Prefer right side of card
    let left: number;
    if (anchorRect.right + GAP + PICKER_WIDTH <= vw) {
      left = anchorRect.right + GAP;
    } else {
      left = anchorRect.left - GAP - PICKER_WIDTH;
    }
    // Clamp horizontal
    left = Math.max(GAP, Math.min(left, vw - PICKER_WIDTH - GAP));

    // Vertically align to card top, but clamp to viewport
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
    // 1-9 toggle labels by number
    const num = parseInt(e.key, 10);
    if (num >= 1 && num <= 9 && num <= labels.length) {
      e.preventDefault();
      e.stopPropagation();
      ontogglelabel(labels[num - 1].id);
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
    aria-label="Quick label picker"
    bind:this={pickerEl}
    style="top: {pos.top}px; left: {pos.left}px;"
  >
    {#if labels.length === 0}
      <div class="empty">No labels on this board</div>
    {:else}
      {#each labels as lbl, i (lbl.id)}
        <button
          class="label-option"
          class:selected={activeLabelIds.includes(lbl.id)}
          onclick={() => ontogglelabel(lbl.id)}
          role="option"
          aria-selected={activeLabelIds.includes(lbl.id)}
        >
          {#if i < 9}
            <kbd class="label-key">{i + 1}</kbd>
          {:else}
            <span class="label-key-spacer"></span>
          {/if}
          <span class="label-dot" style="background: {lbl.color};"></span>
          <span class="label-name">{lbl.name}</span>
          {#if activeLabelIds.includes(lbl.id)}
            <svg
              class="check"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          {/if}
        </button>
      {/each}
    {/if}
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

  .empty {
    padding: 0.75rem 1rem;
    font-size: 0.8125rem;
    color: var(--color-text-secondary);
    text-align: center;
  }

  .label-option {
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

  .label-option:hover {
    background: var(--color-bg);
  }

  .label-option.selected {
    font-weight: 600;
  }

  .label-key {
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

  .label-key-spacer {
    width: 18px;
    flex-shrink: 0;
  }

  .label-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .label-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .check {
    flex-shrink: 0;
    color: var(--color-primary);
  }
</style>
