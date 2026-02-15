<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";
  import { db } from "$lib/db.js";
  import { useLiveQuery } from "$lib/db.svelte.js";
  import type { Board } from "$lib/types.js";

  let { onclose }: { onclose: () => void } = $props();

  const boards = useLiveQuery<Board[]>(() => db.boards.toArray());

  let query = $state("");
  let selectedIndex = $state(0);
  let inputEl = $state<HTMLInputElement | null>(null);

  const filtered = $derived(() => {
    const list = boards.current ?? [];
    if (!query.trim()) return list;
    const q = query.trim().toLowerCase();
    return list.filter((b) => b.name.toLowerCase().includes(q));
  });

  $effect(() => {
    // Reset selection when filtered list changes
    filtered();
    selectedIndex = 0;
  });

  $effect(() => {
    // Auto-focus the input on mount
    inputEl?.focus();
  });

  function navigate(board: Board) {
    onclose();
    goto(`/board/${board.did}/${board.rkey}`);
  }

  function handleKeydown(e: KeyboardEvent) {
    const list = filtered();
    switch (e.key) {
      case "Escape":
        e.preventDefault();
        onclose();
        break;
      case "ArrowDown":
        e.preventDefault();
        selectedIndex = Math.min(list.length - 1, selectedIndex + 1);
        break;
      case "ArrowUp":
        e.preventDefault();
        selectedIndex = Math.max(0, selectedIndex - 1);
        break;
      case "Enter":
        e.preventDefault();
        if (list[selectedIndex]) {
          navigate(list[selectedIndex]);
        }
        break;
    }
  }

  function isCurrentBoard(board: Board): boolean {
    const pathname = $page.url.pathname;
    return pathname === `/board/${board.did}/${board.rkey}`;
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
<div class="modal-backdrop" onmousedown={handleBackdropMouseDown} onclick={handleBackdropClick}>
  <div class="modal" role="dialog" aria-label="Switch board">
    <div class="search-wrap">
      <input
        bind:this={inputEl}
        bind:value={query}
        type="text"
        class="search-input"
        placeholder="Search boards..."
      />
    </div>
    <div class="board-list">
      {#each filtered() as board, i (board.id)}
        <button
          class="board-item"
          class:selected={i === selectedIndex}
          class:current={isCurrentBoard(board)}
          onmouseenter={() => (selectedIndex = i)}
          onclick={() => navigate(board)}
        >
          <span class="board-name">{board.name}</span>
          {#if isCurrentBoard(board)}
            <span class="current-badge">current</span>
          {/if}
        </button>
      {:else}
        <div class="empty">No boards found</div>
      {/each}
    </div>
  </div>
</div>

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: var(--color-backdrop);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    z-index: 100;
    padding: 1rem;
    padding-top: 15vh;
  }

  .modal {
    background: var(--color-surface);
    border-radius: var(--radius-lg);
    width: 100%;
    max-width: 440px;
    max-height: 60vh;
    overflow: hidden;
    box-shadow: var(--shadow-lg);
    display: flex;
    flex-direction: column;
  }

  .search-wrap {
    padding: 0.75rem;
    border-bottom: 1px solid var(--color-border-light);
  }

  .search-input {
    width: 100%;
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    font-size: 0.875rem;
    background: var(--color-bg);
    color: var(--color-text);
    outline: none;
  }

  .search-input:focus {
    border-color: var(--color-primary);
    box-shadow: 0 0 0 2px var(--color-primary-alpha);
  }

  .board-list {
    overflow-y: auto;
    padding: 0.25rem 0;
  }

  .board-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 0.5rem 0.75rem;
    border: none;
    background: none;
    font-size: 0.875rem;
    color: var(--color-text);
    cursor: pointer;
    text-align: left;
  }

  .board-item.selected {
    background: var(--color-primary-alpha);
  }

  .board-item.current .board-name {
    font-weight: 600;
  }

  .board-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .current-badge {
    flex-shrink: 0;
    font-size: 0.6875rem;
    color: var(--color-text-secondary);
    margin-left: 0.5rem;
  }

  .empty {
    padding: 1.5rem 0.75rem;
    text-align: center;
    font-size: 0.8125rem;
    color: var(--color-text-secondary);
  }
</style>
