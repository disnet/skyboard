<script lang="ts">
  import { db } from "$lib/db.js";
  import type { Board, Trust } from "$lib/types.js";
  import { grantTrust, revokeTrust } from "$lib/trust.js";
  import { getAuth } from "$lib/auth.svelte.js";
  import AuthorBadge from "./AuthorBadge.svelte";

  const TYPEAHEAD_API =
    "https://public.api.bsky.app/xrpc/app.bsky.actor.searchActorsTypeahead";
  const RESOLVE_API =
    "https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle";

  let {
    board,
    trusts = [],
    boardUri,
    onclose,
  }: {
    board: Board;
    trusts?: Trust[];
    boardUri: string;
    onclose: () => void;
  } = $props();

  const auth = getAuth();

  /* eslint-disable svelte/state-referenced-locally */
  let isOpen = $state(board.open ?? false);

  // Search state
  let query = $state("");
  let suggestions = $state<{ did: string; handle: string; displayName?: string; avatar?: string }[]>([]);
  let showSuggestions = $state(false);
  let addError = $state<string | null>(null);
  let adding = $state(false);
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  const trustedDids = $derived(new Set(trusts.map((t) => t.trustedDid)));

  async function save() {
    if (!board.id) return;
    await db.boards.update(board.id, {
      open: isOpen || undefined,
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

  // Trusted user search
  async function searchUsers(q: string) {
    if (q.length < 2) {
      suggestions = [];
      return;
    }
    try {
      const res = await fetch(
        `${TYPEAHEAD_API}?q=${encodeURIComponent(q)}&limit=6`,
      );
      if (!res.ok) return;
      const data = await res.json();
      suggestions = (data.actors ?? []).map(
        (a: { did: string; handle: string; displayName?: string; avatar?: string }) => ({
          did: a.did,
          handle: a.handle,
          displayName: a.displayName,
          avatar: a.avatar,
        }),
      );
    } catch {
      suggestions = [];
    }
  }

  function handleInput() {
    addError = null;
    showSuggestions = true;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => searchUsers(query.trim()), 200);
  }

  async function addUser(did: string) {
    if (!auth.did || trustedDids.has(did) || did === auth.did) return;
    adding = true;
    addError = null;
    try {
      await grantTrust(auth.did, did, boardUri);
      query = "";
      suggestions = [];
      showSuggestions = false;
    } catch {
      addError = "Failed to add user.";
    } finally {
      adding = false;
    }
  }

  async function addByHandle() {
    const handle = query.trim().replace(/^@/, "");
    if (!handle || !auth.did) return;
    adding = true;
    addError = null;
    try {
      const res = await fetch(
        `${RESOLVE_API}?handle=${encodeURIComponent(handle)}`,
      );
      if (!res.ok) {
        addError = "Could not resolve handle.";
        return;
      }
      const data = await res.json();
      if (!data.did) {
        addError = "Could not resolve handle.";
        return;
      }
      if (trustedDids.has(data.did)) {
        addError = "User is already trusted.";
        return;
      }
      if (data.did === auth.did) {
        addError = "You can't add yourself.";
        return;
      }
      await grantTrust(auth.did, data.did, boardUri);
      query = "";
      suggestions = [];
      showSuggestions = false;
    } catch {
      addError = "Failed to add user.";
    } finally {
      adding = false;
    }
  }

  async function handleRevoke(trust: Trust) {
    if (!auth.did) return;
    if (
      !confirm(`Revoke trust for this user? Their edits will become proposals.`)
    )
      return;
    await revokeTrust(auth.did, trust.trustedDid, boardUri);
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
<div class="modal-backdrop" onmousedown={handleBackdropMouseDown} onclick={handleBackdropClick}>
  <div class="modal" role="dialog" aria-label="Board Access">
    <div class="modal-header">
      <h3>Board Access</h3>
      <button class="close-btn" onclick={onclose}>&times;</button>
    </div>

    <div class="modal-body">
      <p class="description">
        All boards are publicly visible on the AT Protocol. This setting
        controls who can interact with the board. The board owner and trusted
        users always have full access.
      </p>

      <div class="option-group">
        <button
          class="option-card"
          class:selected={!isOpen}
          onclick={() => (isOpen = false)}
        >
          <strong>Closed</strong>
          <span class="option-hint">
            Only you and trusted users can make edits to this board.
          </span>
        </button>
        <button
          class="option-card"
          class:selected={isOpen}
          onclick={() => (isOpen = true)}
        >
          <strong>Open</strong>
          <span class="option-hint">
            Anyone can propose new tasks and comments. Proposals appear for you
            to accept or reject.
          </span>
        </button>
      </div>

      <div class="trusted-section">
        <h4>Trusted Users</h4>
        <div class="add-section">
          <div class="search-wrapper">
            <input
              class="search-input"
              type="text"
              placeholder="Search by handle..."
              bind:value={query}
              oninput={handleInput}
              onfocus={() => (showSuggestions = true)}
              onkeydown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addByHandle();
                }
              }}
            />
            <button
              class="add-btn"
              onclick={addByHandle}
              disabled={!query.trim() || adding}
            >
              Add
            </button>
          </div>
          {#if showSuggestions && suggestions.length > 0}
            <ul class="suggestions">
              {#each suggestions as s}
                <li>
                  <button
                    class="suggestion-item"
                    onclick={() => addUser(s.did)}
                    disabled={trustedDids.has(s.did) || s.did === auth.did}
                  >
                    {#if s.avatar}
                      <img class="suggestion-avatar" src={s.avatar} alt="" />
                    {/if}
                    <span class="suggestion-text">
                      {#if s.displayName}
                        <span class="suggestion-name">{s.displayName}</span>
                      {/if}
                      <span class="suggestion-handle">@{s.handle}</span>
                    </span>
                    {#if trustedDids.has(s.did)}
                      <span class="already-trusted">Trusted</span>
                    {/if}
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
          {#if addError}
            <p class="add-error">{addError}</p>
          {/if}
        </div>

        {#if trusts.length === 0}
          <p class="empty">No trusted users yet.</p>
        {:else}
          <div class="trust-list">
            {#each trusts as trust (trust.id)}
              <div class="trust-item">
                <AuthorBadge did={trust.trustedDid} />
                <button class="revoke-btn" onclick={() => handleRevoke(trust)}>
                  Revoke
                </button>
              </div>
            {/each}
          </div>
        {/if}
      </div>
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
    max-width: 420px;
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

  .option-group {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .option-card {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0.75rem;
    border: 2px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    cursor: pointer;
    text-align: left;
  }

  .option-card:hover {
    border-color: var(--color-primary);
  }

  .option-card.selected {
    border-color: var(--color-primary);
    background: color-mix(in srgb, var(--color-primary) 8%, var(--color-surface));
  }

  .option-card strong {
    font-size: 0.875rem;
    color: var(--color-text);
  }

  .option-hint {
    font-size: 0.75rem;
    color: var(--color-text-secondary);
    line-height: 1.4;
  }

  /* Trusted users section */

  .trusted-section {
    border-top: 1px solid var(--color-border-light);
    padding-top: 1rem;
  }

  .trusted-section h4 {
    margin: 0 0 0.75rem;
    font-size: 0.875rem;
    font-weight: 600;
  }

  .add-section {
    position: relative;
    margin-bottom: 0.75rem;
  }

  .search-wrapper {
    display: flex;
    gap: 0.375rem;
  }

  .search-input {
    flex: 1;
    padding: 0.4rem 0.625rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    font-size: 0.8125rem;
    background: var(--color-surface);
    color: var(--color-text);
    outline: none;
  }

  .search-input:focus {
    border-color: var(--color-primary);
  }

  .add-btn {
    padding: 0.4rem 0.75rem;
    background: var(--color-primary);
    color: white;
    border: none;
    border-radius: var(--radius-sm);
    font-size: 0.8125rem;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
  }

  .add-btn:hover {
    background: var(--color-primary-hover);
  }

  .add-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .suggestions {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    margin: 0.25rem 0 0;
    padding: 0;
    list-style: none;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    box-shadow: var(--shadow-lg);
    z-index: 10;
    max-height: 200px;
    overflow-y: auto;
  }

  .suggestion-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    padding: 0.5rem 0.625rem;
    border: none;
    background: none;
    cursor: pointer;
    text-align: left;
    font-size: 0.8125rem;
    color: var(--color-text);
  }

  .suggestion-item:hover:not(:disabled) {
    background: var(--color-bg);
  }

  .suggestion-item:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .suggestion-avatar {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    object-fit: cover;
    flex-shrink: 0;
  }

  .suggestion-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1;
  }

  .suggestion-name {
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .suggestion-handle {
    font-size: 0.75rem;
    color: var(--color-text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .already-trusted {
    font-size: 0.6875rem;
    color: var(--color-text-secondary);
    white-space: nowrap;
  }

  .add-error {
    margin: 0.375rem 0 0;
    font-size: 0.75rem;
    color: var(--color-error);
  }

  .empty {
    color: var(--color-text-secondary);
    font-size: 0.8125rem;
    text-align: center;
    padding: 1rem 0;
  }

  .trust-list {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }

  .trust-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.5rem 0.625rem;
    background: var(--color-bg);
    border-radius: var(--radius-md);
  }

  .revoke-btn {
    padding: 0.25rem 0.625rem;
    background: var(--color-surface);
    color: var(--color-error);
    border: 1px solid var(--color-error);
    border-radius: var(--radius-sm);
    font-size: 0.6875rem;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
  }

  .revoke-btn:hover {
    background: var(--color-error-bg);
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
</style>
