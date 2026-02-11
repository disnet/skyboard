<script lang="ts">
  import type { Board } from "$lib/types.js";

  let { board }: { board: Board } = $props();
</script>

<a href="/board/{board.did}/{board.rkey}" class="board-card">
  <h3 class="board-name">{board.name}</h3>
  {#if board.description}
    <p class="board-desc">{board.description}</p>
  {/if}
  <div class="board-meta">
    <span class="column-count"
      >{board.columns.length} column{board.columns.length !== 1
        ? "s"
        : ""}</span
    >
    {#if board.syncStatus === "pending"}
      <span class="sync-badge pending">Pending</span>
    {:else if board.syncStatus === "error"}
      <span class="sync-badge error">Error</span>
    {/if}
  </div>
</a>

<style>
  .board-card {
    display: block;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    padding: 1.25rem;
    text-decoration: none;
    color: var(--color-text);
    transition:
      box-shadow 0.15s,
      border-color 0.15s;
  }

  .board-card:hover {
    text-decoration: none;
    border-color: var(--color-primary);
    box-shadow: var(--shadow-md);
  }

  .board-name {
    margin: 0 0 0.375rem;
    font-size: 1rem;
    font-weight: 600;
  }

  .board-desc {
    margin: 0 0 0.75rem;
    font-size: 0.8125rem;
    color: var(--color-text-secondary);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .board-meta {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.75rem;
    color: var(--color-text-secondary);
  }

  .sync-badge {
    padding: 0.125rem 0.375rem;
    border-radius: var(--radius-sm);
    font-size: 0.6875rem;
    font-weight: 500;
  }

  .sync-badge.pending {
    background: var(--color-warning-bg);
    color: var(--color-warning);
  }

  .sync-badge.error {
    background: var(--color-error-bg);
    color: var(--color-error);
  }
</style>
