<script lang="ts">
  import type { Board } from "$lib/types.js";

  let {
    board,
    userDid,
    onArchive,
    onLeave,
    onUnarchive,
  }: {
    board: Board;
    userDid?: string;
    onArchive?: (board: Board) => void;
    onLeave?: (board: Board) => void;
    onUnarchive?: (board: Board) => void;
  } = $props();

  let showMenu = $state(false);
  let confirmingLeave = $state(false);

  const isOwner = $derived(userDid != null && board.did === userDid);

  function handleActionClick(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    showMenu = !showMenu;
  }

  function handleArchive(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    showMenu = false;
    onArchive?.(board);
  }

  function handleUnarchive(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    onUnarchive?.(board);
  }

  function handleLeaveClick(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    confirmingLeave = true;
    showMenu = false;
  }

  function handleLeaveConfirm(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    confirmingLeave = false;
    onLeave?.(board);
  }

  function handleLeaveCancel(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    confirmingLeave = false;
  }
</script>

<svelte:window
  onclick={() => {
    showMenu = false;
  }}
/>

<a href="/board/{board.did}/{board.rkey}" class="board-card">
  {#if board.archived}
    <div class="archived-actions">
      <span class="archived-label">Archived</span>
      <button class="unarchive-btn" onclick={handleUnarchive}>Unarchive</button>
    </div>
  {:else if userDid}
    <button
      class="action-btn"
      onclick={handleActionClick}
      title={isOwner ? "Archive board" : "Leave board"}
    >
      &hellip;
    </button>
    {#if showMenu}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="action-menu" onclick={(e) => e.stopPropagation()}>
        {#if isOwner}
          <button class="menu-item" onclick={handleArchive}>Archive</button>
        {:else}
          <button class="menu-item danger" onclick={handleLeaveClick}
            >Leave Board</button
          >
        {/if}
      </div>
    {/if}
  {/if}

  {#if confirmingLeave}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="confirm-overlay"
      onclick={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <p>Leave <strong>{board.name}</strong>?</p>
      <p class="confirm-detail">You'll need to rejoin to access it again.</p>
      <div class="confirm-actions">
        <button class="confirm-cancel" onclick={handleLeaveCancel}
          >Cancel</button
        >
        <button class="confirm-leave" onclick={handleLeaveConfirm}>Leave</button
        >
      </div>
    </div>
  {/if}

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
    {#if board.open}
      <span class="sync-badge open">Open</span>
    {:else}
      <span class="sync-badge closed">Closed</span>
    {/if}
    <span
      class="sync-badge public"
      title="All boards are publicly viewable on the AT Protocol network"
      >Public</span
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
    position: relative;
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

  .sync-badge.open {
    background: var(--color-success-alpha, rgba(22, 163, 74, 0.1));
    color: rgb(22, 163, 74);
  }

  .sync-badge.closed {
    background: var(--color-border-light, rgba(0, 0, 0, 0.05));
    color: var(--color-text-secondary);
  }

  .sync-badge.public {
    background: var(--color-primary-alpha, rgba(59, 130, 246, 0.1));
    color: var(--color-primary);
    cursor: help;
  }

  .sync-badge.pending {
    background: var(--color-warning-bg);
    color: var(--color-warning);
  }

  .sync-badge.error {
    background: var(--color-error-bg);
    color: var(--color-error);
  }

  .action-btn {
    position: absolute;
    top: 0.5rem;
    right: 0.5rem;
    background: none;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    padding: 0.125rem 0.375rem;
    font-size: 1rem;
    line-height: 1;
    color: var(--color-text-secondary);
    cursor: pointer;
    opacity: 0;
    transition:
      opacity 0.15s,
      background 0.15s;
  }

  .board-card:hover .action-btn {
    opacity: 1;
  }

  .action-btn:hover {
    background: var(--color-border-light, rgba(0, 0, 0, 0.05));
    border-color: var(--color-border);
  }

  .action-menu {
    position: absolute;
    top: 2rem;
    right: 0.5rem;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-md);
    z-index: 10;
    min-width: 120px;
  }

  .menu-item {
    display: block;
    width: 100%;
    padding: 0.5rem 0.75rem;
    background: none;
    border: none;
    text-align: left;
    font-size: 0.8125rem;
    color: var(--color-text);
    cursor: pointer;
  }

  .menu-item:hover {
    background: var(--color-border-light, rgba(0, 0, 0, 0.05));
  }

  .menu-item.danger {
    color: var(--color-error, #dc2626);
  }

  .confirm-overlay {
    position: absolute;
    inset: 0;
    background: var(--color-surface);
    border-radius: var(--radius-lg);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    z-index: 20;
    padding: 1rem;
  }

  .confirm-overlay p {
    margin: 0 0 0.25rem;
    font-size: 0.875rem;
    text-align: center;
  }

  .confirm-detail {
    font-size: 0.75rem !important;
    color: var(--color-text-secondary);
    margin-bottom: 0.75rem !important;
  }

  .confirm-actions {
    display: flex;
    gap: 0.5rem;
  }

  .confirm-cancel,
  .confirm-leave {
    padding: 0.375rem 0.75rem;
    border-radius: var(--radius-md);
    font-size: 0.8125rem;
    cursor: pointer;
    border: 1px solid var(--color-border);
  }

  .confirm-cancel {
    background: var(--color-surface);
    color: var(--color-text);
  }

  .confirm-leave {
    background: var(--color-error, #dc2626);
    color: white;
    border-color: var(--color-error, #dc2626);
  }

  .archived-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.5rem;
  }

  .archived-label {
    font-size: 0.6875rem;
    font-weight: 500;
    padding: 0.125rem 0.375rem;
    border-radius: var(--radius-sm);
    background: var(--color-border-light, rgba(0, 0, 0, 0.05));
    color: var(--color-text-secondary);
  }

  .unarchive-btn {
    padding: 0.25rem 0.5rem;
    font-size: 0.75rem;
    background: none;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    color: var(--color-text-secondary);
    cursor: pointer;
  }

  .unarchive-btn:hover {
    background: var(--color-border-light, rgba(0, 0, 0, 0.05));
    color: var(--color-text);
  }
</style>
