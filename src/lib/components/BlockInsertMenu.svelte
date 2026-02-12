<script lang="ts">
  import type { EditorView } from "codemirror";

  let { editorView }: { editorView: EditorView | undefined } = $props();

  let showMenu = $state(false);
  let buttonTop = $state(0);
  let visible = $state(false);
  let searchQuery = $state("");
  let selectedIndex = $state(0);
  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  let menuEl: HTMLDivElement | undefined = $state();
  let buttonEl: HTMLButtonElement | undefined = $state();
  let searchInputEl: HTMLInputElement | undefined = $state();

  interface BlockOption {
    label: string;
    icon: string;
    action: (view: EditorView) => void;
  }

  const BLOCK_OPTIONS: BlockOption[] = [
    {
      label: "Heading 1",
      icon: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 3v10M10 3v10M2 8h8"/><text x="13" y="13" font-size="7" font-weight="700" fill="currentColor" stroke="none">1</text></svg>`,
      action: (view) => insertLinePrefix(view, "# "),
    },
    {
      label: "Heading 2",
      icon: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 3v10M10 3v10M2 8h8"/><text x="13" y="13" font-size="7" font-weight="700" fill="currentColor" stroke="none">2</text></svg>`,
      action: (view) => insertLinePrefix(view, "## "),
    },
    {
      label: "Heading 3",
      icon: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 3v10M10 3v10M2 8h8"/><text x="13" y="13" font-size="7" font-weight="700" fill="currentColor" stroke="none">3</text></svg>`,
      action: (view) => insertLinePrefix(view, "### "),
    },
    {
      label: "Bullet list",
      icon: `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><circle cx="3" cy="4" r="1.5"/><circle cx="3" cy="8" r="1.5"/><circle cx="3" cy="12" r="1.5"/><rect x="6.5" y="3" width="8" height="2" rx="0.5"/><rect x="6.5" y="7" width="8" height="2" rx="0.5"/><rect x="6.5" y="11" width="8" height="2" rx="0.5"/></svg>`,
      action: (view) => insertLinePrefix(view, "- "),
    },
    {
      label: "Numbered list",
      icon: `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><text x="1" y="5.5" font-size="7" font-weight="600">1.</text><text x="1" y="9.5" font-size="7" font-weight="600">2.</text><text x="1" y="13.5" font-size="7" font-weight="600">3.</text><rect x="7.5" y="3" width="7" height="2" rx="0.5"/><rect x="7.5" y="7" width="7" height="2" rx="0.5"/><rect x="7.5" y="11" width="7" height="2" rx="0.5"/></svg>`,
      action: (view) => insertLinePrefix(view, "1. "),
    },
    {
      label: "Todo list",
      icon: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1.5" y="2.5" width="5" height="5" rx="1"/><path d="M3 5.2l1.2 1.2L6 4"/><rect x="1.5" y="8.5" width="5" height="5" rx="1"/><rect x="9" y="4" width="6" height="1.5" rx="0.5" fill="currentColor" stroke="none"/><rect x="9" y="10" width="6" height="1.5" rx="0.5" fill="currentColor" stroke="none"/></svg>`,
      action: (view) => insertLinePrefix(view, "- [ ] "),
    },
    {
      label: "Blockquote",
      icon: `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><rect x="2" y="2" width="2.5" height="12" rx="1"/><rect x="7" y="4" width="7" height="2" rx="0.5"/><rect x="7" y="7.5" width="5" height="2" rx="0.5"/><rect x="7" y="11" width="6" height="2" rx="0.5"/></svg>`,
      action: (view) => insertLinePrefix(view, "> "),
    },
    {
      label: "Code block",
      icon: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M5.5 4L2 8l3.5 4M10.5 4L14 8l-3.5 4"/></svg>`,
      action: insertCodeBlock,
    },
    {
      label: "Horizontal rule",
      icon: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="2" y1="8" x2="14" y2="8"/></svg>`,
      action: insertHorizontalRule,
    },
  ];

  const filteredOptions = $derived(
    searchQuery
      ? BLOCK_OPTIONS.filter((o) =>
          o.label.toLowerCase().includes(searchQuery.toLowerCase()),
        )
      : BLOCK_OPTIONS,
  );

  const LINE_PREFIX_PATTERN = /^(#{1,6}\s|[-*+]\s(\[[ xX]\]\s)?|\d+\.\s|>\s)/;

  function insertLinePrefix(view: EditorView, prefix: string) {
    const { from } = view.state.selection.main;
    const line = view.state.doc.lineAt(from);
    const match = line.text.match(LINE_PREFIX_PATTERN);

    if (match) {
      // Replace existing prefix
      view.dispatch({
        changes: { from: line.from, to: line.from + match[0].length, insert: prefix },
        selection: { anchor: line.from + prefix.length },
      });
    } else {
      // Insert at line start
      view.dispatch({
        changes: { from: line.from, to: line.from, insert: prefix },
        selection: { anchor: from + prefix.length },
      });
    }
    view.focus();
  }

  function insertCodeBlock(view: EditorView) {
    const { from } = view.state.selection.main;
    const line = view.state.doc.lineAt(from);
    const needsNewlineBefore = line.text.length > 0 ? "\n" : "";
    const insert = `${needsNewlineBefore}\`\`\`\n\n\`\`\``;
    const cursorOffset = needsNewlineBefore.length + 4; // after ``` + newline
    view.dispatch({
      changes: { from: line.from + line.text.length, to: line.from + line.text.length, insert },
      selection: { anchor: line.from + line.text.length + cursorOffset },
    });
    view.focus();
  }

  function insertHorizontalRule(view: EditorView) {
    const { from } = view.state.selection.main;
    const line = view.state.doc.lineAt(from);
    const needsNewlineBefore = line.text.length > 0 ? "\n" : "";
    const insert = `${needsNewlineBefore}---\n`;
    view.dispatch({
      changes: { from: line.from + line.text.length, to: line.from + line.text.length, insert },
      selection: { anchor: line.from + line.text.length + insert.length },
    });
    view.focus();
  }

  function positionAtCursorLine(view: EditorView, wrapper: Element) {
    const { from } = view.state.selection.main;
    const coords = view.coordsAtPos(from);
    if (!coords) return;
    const wrapperRect = wrapper.getBoundingClientRect();
    const buttonHeight = 24;
    const lineHeight = coords.bottom - coords.top;
    buttonTop = coords.top - wrapperRect.top + (lineHeight - buttonHeight) / 2;
  }

  function showButton() {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    visible = true;
  }

  function hideButton() {
    if (showMenu) return;
    visible = false;
  }

  $effect(() => {
    if (!editorView) return;
    const wrapper = editorView.dom.closest(".editor-area");
    if (!wrapper) return;

    const onMouseMove = (e: MouseEvent) => {
      if (showMenu) return;
      const view = editorView!;
      const contentEl = view.contentDOM;
      const contentRect = contentEl.getBoundingClientRect();
      const paddingTop = parseFloat(getComputedStyle(contentEl).paddingTop) || 0;
      // Y relative to document start (block.top=0 is first line)
      const yInEditor = e.clientY - contentRect.top - paddingTop + view.scrollDOM.scrollTop;
      const block = view.lineBlockAtHeight(yInEditor);
      // Convert block.top back to screen position relative to wrapper
      const wrapperRect = wrapper.getBoundingClientRect();
      const blockScreenY = contentRect.top + paddingTop + block.top - view.scrollDOM.scrollTop;
      const buttonHeight = 24;
      buttonTop = blockScreenY - wrapperRect.top + (block.height - buttonHeight) / 2;
      showButton();
    };

    const onMouseLeave = () => {
      if (!showMenu) hideButton();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (showMenu) return;
      if (e.key === "/") {
        const view = editorView!;
        const { from } = view.state.selection.main;
        const line = view.state.doc.lineAt(from);
        // Only trigger on empty line or at line start
        if (from === line.from && line.text.length === 0) {
          e.preventDefault();
          positionAtCursorLine(view, wrapper);
          visible = true;
          openMenu();
          return;
        }
      }
      visible = false;
      if (hideTimer) clearTimeout(hideTimer);
    };

    wrapper.addEventListener("mousemove", onMouseMove as EventListener);
    wrapper.addEventListener("mouseleave", onMouseLeave);
    editorView.dom.addEventListener("keydown", onKeyDown as EventListener);

    return () => {
      wrapper.removeEventListener("mousemove", onMouseMove as EventListener);
      wrapper.removeEventListener("mouseleave", onMouseLeave);
      editorView!.dom.removeEventListener("keydown", onKeyDown as EventListener);
      if (hideTimer) clearTimeout(hideTimer);
    };
  });

  function openMenu() {
    searchQuery = "";
    selectedIndex = 0;
    showMenu = true;
  }

  function toggleMenu() {
    if (showMenu) {
      closeMenu();
    } else {
      openMenu();
    }
  }

  function handleOptionClick(option: BlockOption) {
    if (!editorView) return;
    option.action(editorView);
    closeMenu();
  }

  function handleMenuKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeMenu();
      editorView?.focus();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      selectedIndex = (selectedIndex + 1) % filteredOptions.length;
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      selectedIndex = (selectedIndex - 1 + filteredOptions.length) % filteredOptions.length;
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const option = filteredOptions[selectedIndex];
      if (option) handleOptionClick(option);
      return;
    }
    if (e.key === "Backspace" && !searchQuery) {
      e.preventDefault();
      closeMenu();
      editorView?.focus();
      return;
    }
  }

  // Reset selectedIndex when filtered list changes
  $effect(() => {
    if (filteredOptions.length > 0 && selectedIndex >= filteredOptions.length) {
      selectedIndex = 0;
    }
  });

  // Auto-focus search input when menu opens
  $effect(() => {
    if (showMenu && searchInputEl) {
      searchInputEl.focus();
    }
  });

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape" && showMenu) {
      e.stopPropagation();
      closeMenu();
    }
  }

  function closeMenu() {
    showMenu = false;
    visible = false;
  }

  function handleClickOutside(e: MouseEvent) {
    if (
      showMenu &&
      menuEl &&
      !menuEl.contains(e.target as Node) &&
      buttonEl &&
      !buttonEl.contains(e.target as Node)
    ) {
      closeMenu();
    }
  }
</script>

<svelte:window onclick={handleClickOutside} onkeydown={handleKeydown} />

<div class="block-insert">
  <button
    class="block-insert-btn"
    class:active={showMenu}
    class:visible={visible || showMenu}
    style="top: {buttonTop}px"
    onclick={toggleMenu}
    bind:this={buttonEl}
    tabindex={-1}
    title="Insert block"
    type="button"
  >
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
      <line x1="7" y1="2" x2="7" y2="12" />
      <line x1="2" y1="7" x2="12" y2="7" />
    </svg>
  </button>

  {#if showMenu}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="block-menu" style="top: {buttonTop}px" bind:this={menuEl} onkeydown={handleMenuKeydown}>
      <div class="block-menu-search">
        <input
          bind:this={searchInputEl}
          bind:value={searchQuery}
          class="block-menu-search-input"
          type="text"
          placeholder="Filter…"
        />
      </div>
      {#each filteredOptions as option, i (option.label)}
        <button
          class="block-menu-item"
          class:selected={i === selectedIndex}
          onclick={() => handleOptionClick(option)}
          onpointerenter={() => (selectedIndex = i)}
          type="button"
        >
          <span class="block-menu-icon">{@html option.icon}</span>
          <span class="block-menu-label">{option.label}</span>
        </button>
      {/each}
      {#if filteredOptions.length === 0}
        <div class="block-menu-empty">No matches</div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .block-insert {
    position: relative;
    width: 28px;
    flex-shrink: 0;
  }

  .block-insert-btn {
    position: absolute;
    left: 0;
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: none;
    color: var(--color-text-secondary);
    border-radius: 50%;
    cursor: pointer;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.15s, background 0.15s, color 0.15s, transform 0.2s;
    padding: 0;
  }

  .block-insert-btn.visible {
    opacity: 0.4;
    pointer-events: auto;
  }

  .block-insert-btn.visible:hover,
  .block-insert-btn.active {
    opacity: 1;
    background: var(--color-border-light);
    color: var(--color-text);
  }

  .block-insert-btn.active {
    transform: rotate(45deg);
  }

  .block-menu {
    position: absolute;
    left: 0;
    margin-top: 28px;
    min-width: 180px;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-lg);
    z-index: 50;
    padding: 0.25rem 0;
  }

  .block-menu-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    padding: 0.375rem 0.75rem;
    border: none;
    background: none;
    color: var(--color-text);
    font-size: 0.8125rem;
    text-align: left;
    cursor: pointer;
    transition: background 0.1s;
  }

  .block-menu-search {
    padding: 0.375rem 0.5rem;
    border-bottom: 1px solid var(--color-border-light);
  }

  .block-menu-search-input {
    width: 100%;
    border: none;
    background: none;
    color: var(--color-text);
    font-size: 0.8125rem;
    outline: none;
    padding: 0;
  }

  .block-menu-search-input::placeholder {
    color: var(--color-text-secondary);
  }

  .block-menu-item:hover,
  .block-menu-item.selected {
    background: var(--color-bg);
  }

  .block-menu-empty {
    padding: 0.5rem 0.75rem;
    font-size: 0.75rem;
    color: var(--color-text-secondary);
  }

  .block-menu-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    flex-shrink: 0;
    color: var(--color-text-secondary);
  }

  .block-menu-label {
    flex: 1;
  }
</style>
