<script lang="ts">
  import type { Trust } from "$lib/types.js";
  import { grantTrust, revokeTrust } from "$lib/trust.js";
  import { getAuth } from "$lib/auth.svelte.js";
  import AuthorBadge from "./AuthorBadge.svelte";

  const TYPEAHEAD_API =
    "https://public.api.bsky.app/xrpc/app.bsky.actor.searchActorsTypeahead";
  const RESOLVE_API =
    "https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle";

  let {
    trusts,
    boardUri,
    onclose,
  }: {
    trusts: Trust[];
    boardUri: string;
    onclose: () => void;
  } = $props();

  const auth = getAuth();

  // Search state
  let query = $state("");
  let suggestions = $state<{ did: string; handle: string; displayName?: string; avatar?: string }[]>([]);
  let showSuggestions = $state(false);
  let addError = $state<string | null>(null);
  let adding = $state(false);
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  const trustedDids = $derived(new Set(trusts.map((t) => t.trustedDid)));

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

<div class="panel-backdrop" onclick={onclose} role="presentation">
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="panel" onclick={(e) => e.stopPropagation()} onkeydown={() => {}}>
    <div class="panel-header">
      <h3>Trusted Users</h3>
      <button class="close-btn" onclick={onclose}>Close</button>
    </div>

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
      <p class="empty">No trusted users.</p>
    {:else}
      {#each trusts as trust (trust.id)}
        <div class="trust-item">
          <AuthorBadge did={trust.trustedDid} />
          <button class="revoke-btn" onclick={() => handleRevoke(trust)}>
            Revoke
          </button>
        </div>
      {/each}
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

  .add-section {
    margin-bottom: 1rem;
    position: relative;
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
    max-height: 240px;
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
    padding: 2rem 0;
  }

  .trust-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.625rem 0.75rem;
    background: var(--color-bg);
    border-radius: var(--radius-md);
    margin-bottom: 0.5rem;
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
</style>
