<script lang="ts">
  const TYPEAHEAD_API =
    "https://public.api.bsky.app/xrpc/app.bsky.actor.searchActorsTypeahead";

  interface ActorResult {
    did: string;
    handle: string;
    displayName?: string;
    avatar?: string;
  }

  let {
    value = $bindable(""),
    placeholder = "",
    rows = 2,
    maxlength,
    disabled = false,
  }: {
    value?: string;
    placeholder?: string;
    rows?: number;
    maxlength?: number;
    disabled?: boolean;
  } = $props();

  let textarea: HTMLTextAreaElement | undefined = $state();
  let suggestions: ActorResult[] = $state([]);
  let showDropdown = $state(false);
  let selectedIndex = $state(0);
  let mentionStart = $state(-1);
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  function getMentionQuery(): string | null {
    if (!textarea) return null;
    const pos = textarea.selectionStart;
    const textBefore = value.slice(0, pos);
    const match = textBefore.match(/@([a-zA-Z0-9._-]{2,})$/);
    if (match) {
      mentionStart = pos - match[0].length;
      return match[1];
    }
    return null;
  }

  async function searchActors(query: string) {
    try {
      const url = `${TYPEAHEAD_API}?q=${encodeURIComponent(query)}&limit=5`;
      const res = await fetch(url);
      if (!res.ok) return;
      const data = await res.json();
      suggestions = data.actors ?? [];
      selectedIndex = 0;
      showDropdown = suggestions.length > 0;
    } catch {
      suggestions = [];
      showDropdown = false;
    }
  }

  function insertMention(handle: string) {
    if (mentionStart < 0 || !textarea) return;
    const pos = textarea.selectionStart;
    const before = value.slice(0, mentionStart);
    const after = value.slice(pos);
    value = `${before}@${handle} ${after}`;
    showDropdown = false;
    suggestions = [];

    // Restore cursor after the inserted mention
    const newPos = mentionStart + handle.length + 2; // @handle + space
    requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(newPos, newPos);
    });
  }

  function handleInput() {
    clearTimeout(debounceTimer);
    const query = getMentionQuery();
    if (query) {
      debounceTimer = setTimeout(() => searchActors(query), 200);
    } else {
      showDropdown = false;
      suggestions = [];
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (!showDropdown) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      selectedIndex = (selectedIndex + 1) % suggestions.length;
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      selectedIndex =
        (selectedIndex - 1 + suggestions.length) % suggestions.length;
    } else if (e.key === "Enter" || e.key === "Tab") {
      if (suggestions[selectedIndex]) {
        e.preventDefault();
        insertMention(suggestions[selectedIndex].handle);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      showDropdown = false;
    }
  }

  function handleBlur() {
    // Delay to allow click on dropdown item
    setTimeout(() => {
      showDropdown = false;
    }, 150);
  }
</script>

<div class="mention-textarea-wrapper">
  <textarea
    bind:this={textarea}
    bind:value
    {placeholder}
    {rows}
    {maxlength}
    {disabled}
    class="comment-input"
    oninput={handleInput}
    onkeydown={handleKeydown}
    onblur={handleBlur}
  ></textarea>
  {#if showDropdown}
    <div class="mention-dropdown">
      {#each suggestions as actor, i}
        <button
          class="mention-option"
          class:selected={i === selectedIndex}
          onmousedown={(e) => { e.preventDefault(); insertMention(actor.handle); }}
        >
          {#if actor.avatar}
            <img class="mention-avatar" src={actor.avatar} alt="" />
          {:else}
            <span class="mention-avatar-placeholder"></span>
          {/if}
          <span class="mention-info">
            <span class="mention-handle">@{actor.handle}</span>
            {#if actor.displayName}
              <span class="mention-name">{actor.displayName}</span>
            {/if}
          </span>
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .mention-textarea-wrapper {
    position: relative;
    width: 100%;
  }

  .comment-input {
    width: 100%;
    padding: 0.5rem 0.625rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    font-size: 0.8125rem;
    font-family: inherit;
    color: var(--color-text);
    background: var(--color-surface);
    resize: vertical;
    min-height: 2.5rem;
  }

  .comment-input:focus {
    outline: none;
    border-color: var(--color-primary);
  }

  .mention-dropdown {
    position: absolute;
    z-index: 200;
    bottom: 100%;
    margin-bottom: 4px;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-md);
    max-height: 200px;
    overflow-y: auto;
    min-width: 240px;
  }

  .mention-option {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.375rem 0.625rem;
    width: 100%;
    border: none;
    background: none;
    cursor: pointer;
    text-align: left;
    font-family: inherit;
    font-size: 0.8125rem;
    color: var(--color-text);
  }

  .mention-option:hover,
  .mention-option.selected {
    background: var(--color-bg);
  }

  .mention-avatar {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    object-fit: cover;
    flex-shrink: 0;
  }

  .mention-avatar-placeholder {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: var(--color-border-light);
    flex-shrink: 0;
  }

  .mention-info {
    display: flex;
    flex-direction: column;
    gap: 0;
    overflow: hidden;
  }

  .mention-handle {
    font-size: 0.75rem;
    color: var(--color-text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .mention-name {
    font-size: 0.6875rem;
    color: var(--color-text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
