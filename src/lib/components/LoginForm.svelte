<script lang="ts">
  import { login, getAuth } from "$lib/auth.svelte.js";

  interface Actor {
    did: string;
    handle: string;
    displayName?: string;
    avatar?: string;
  }

  const TYPEAHEAD_API =
    "https://public.api.bsky.app/xrpc/app.bsky.actor.searchActorsTypeahead";

  const auth = getAuth();
  let handle = $state("");
  let submitting = $state(false);

  let suggestions = $state<Actor[]>([]);
  let showDropdown = $state(false);
  let activeIndex = $state(-1);
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let abortController: AbortController | undefined;

  async function fetchSuggestions(query: string): Promise<void> {
    abortController?.abort();
    abortController = new AbortController();

    try {
      const url = `${TYPEAHEAD_API}?q=${encodeURIComponent(query)}&limit=8`;
      const res = await fetch(url, { signal: abortController.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      suggestions = data.actors ?? [];
      showDropdown = suggestions.length > 0;
      activeIndex = -1;
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      suggestions = [];
      showDropdown = false;
    }
  }

  function handleInput(): void {
    const query = handle.trim();
    clearTimeout(debounceTimer);

    if (query.length < 2) {
      suggestions = [];
      showDropdown = false;
      activeIndex = -1;
      abortController?.abort();
      return;
    }

    debounceTimer = setTimeout(() => {
      fetchSuggestions(query);
    }, 300);
  }

  function selectSuggestion(actor: Actor): void {
    handle = actor.handle;
    showDropdown = false;
    suggestions = [];
    activeIndex = -1;
  }

  function handleKeydown(e: KeyboardEvent): void {
    if (!showDropdown || suggestions.length === 0) return;

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        activeIndex = (activeIndex + 1) % suggestions.length;
        break;
      case "ArrowUp":
        e.preventDefault();
        activeIndex =
          activeIndex <= 0 ? suggestions.length - 1 : activeIndex - 1;
        break;
      case "Enter":
        if (activeIndex >= 0 && activeIndex < suggestions.length) {
          e.preventDefault();
          selectSuggestion(suggestions[activeIndex]);
        }
        break;
      case "Escape":
        e.preventDefault();
        showDropdown = false;
        activeIndex = -1;
        break;
    }
  }

  function handleBlur(): void {
    setTimeout(() => {
      showDropdown = false;
      activeIndex = -1;
    }, 200);
  }

  async function handleSubmit(e: Event) {
    e.preventDefault();
    if (!handle.trim()) return;
    showDropdown = false;
    suggestions = [];
    activeIndex = -1;
    clearTimeout(debounceTimer);
    abortController?.abort();

    submitting = true;
    await login(handle.trim());
    submitting = false;
  }
</script>

<div class="login-card">
  <h1>Skyboard</h1>
  <p class="subtitle">Sign in with your AT Protocol identity</p>

  <form onsubmit={handleSubmit}>
    <label for="handle">Handle</label>
    <div class="input-wrapper">
      <input
        id="handle"
        type="text"
        bind:value={handle}
        placeholder="e.g. alice.bsky.social"
        disabled={submitting}
        required
        autocomplete="off"
        oninput={handleInput}
        onkeydown={handleKeydown}
        onblur={handleBlur}
        role="combobox"
        aria-expanded={showDropdown}
        aria-controls="handle-listbox"
        aria-activedescendant={activeIndex >= 0
          ? `suggestion-${activeIndex}`
          : undefined}
      />
      {#if showDropdown && suggestions.length > 0}
        <ul class="suggestions" id="handle-listbox" role="listbox">
          {#each suggestions as actor, i (actor.did)}
            <li
              id="suggestion-{i}"
              class="suggestion-item"
              class:active={i === activeIndex}
              role="option"
              aria-selected={i === activeIndex}
              onmousedown={() => selectSuggestion(actor)}
            >
              {#if actor.avatar}
                <img class="suggestion-avatar" src={actor.avatar} alt="" />
              {:else}
                <div class="suggestion-avatar-placeholder"></div>
              {/if}
              <div class="suggestion-text">
                <span class="suggestion-handle">@{actor.handle}</span>
                {#if actor.displayName}
                  <span class="suggestion-name">{actor.displayName}</span>
                {/if}
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
    <button type="submit" disabled={submitting || !handle.trim()}>
      {submitting ? "Signing in..." : "Sign In"}
    </button>
  </form>

  {#if auth.error}
    <p class="error">{auth.error}</p>
  {/if}
</div>

<style>
  .login-card {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    padding: 2.5rem;
    width: 100%;
    max-width: 400px;
    box-shadow: var(--shadow-lg);
  }

  h1 {
    margin: 0 0 0.25rem;
    font-size: 1.75rem;
    color: var(--color-primary);
  }

  .subtitle {
    margin: 0 0 1.5rem;
    color: var(--color-text-secondary);
    font-size: 0.875rem;
  }

  form {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  label {
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--color-text);
  }

  .input-wrapper {
    position: relative;
  }

  input {
    width: 100%;
    padding: 0.625rem 0.75rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    font-size: 0.875rem;
    background: var(--color-bg);
    color: var(--color-text);
    transition: border-color 0.15s;
  }

  input:focus {
    outline: none;
    border-color: var(--color-primary);
    box-shadow: 0 0 0 2px var(--color-primary-alpha);
  }

  .suggestions {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    margin: 4px 0 0;
    padding: 4px 0;
    list-style: none;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-md);
    z-index: 10;
    max-height: 280px;
    overflow-y: auto;
  }

  .suggestion-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    cursor: pointer;
    transition: background 0.1s;
  }

  .suggestion-item:hover,
  .suggestion-item.active {
    background: var(--color-primary-alpha);
  }

  .suggestion-avatar {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    object-fit: cover;
    flex-shrink: 0;
  }

  .suggestion-avatar-placeholder {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: var(--color-border-light);
    flex-shrink: 0;
  }

  .suggestion-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
    overflow: hidden;
  }

  .suggestion-handle {
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--color-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .suggestion-name {
    font-size: 0.75rem;
    color: var(--color-text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  button {
    padding: 0.625rem 1rem;
    background: var(--color-primary);
    color: white;
    border: none;
    border-radius: var(--radius-md);
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s;
  }

  button:hover:not(:disabled) {
    background: var(--color-primary-hover);
  }

  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .error {
    margin: 1rem 0 0;
    padding: 0.625rem;
    background: var(--color-error-bg);
    color: var(--color-error);
    border-radius: var(--radius-md);
    font-size: 0.875rem;
  }
</style>
