<script lang="ts">
  import type { MaterializedTask, Label } from "$lib/types.js";
  import { Marked } from "marked";
  import { getDraggedCard, setDraggedCard } from "$lib/drag-state.svelte.js";
  import { handleTouchStart } from "$lib/touch-drag.svelte.js";
  import DOMPurify from "dompurify";
  import AuthorBadge from "./AuthorBadge.svelte";
  import { createOp } from "$lib/ops.js";

  const marked = new Marked({
    renderer: {
      checkbox({ checked }: { checked: boolean }) {
        return `<input ${checked ? 'checked="" ' : ""}type="checkbox"> `;
      },
    },
  });

  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName === "A") {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
    }
  });

  const EMOJI_OPTIONS = [
    "\u{1F44D}",
    "\u{1F44E}",
    "\u{2764}\u{FE0F}",
    "\u{1F389}",
    "\u{1F680}",
  ];

  let {
    task,
    currentUserDid,
    pending = false,
    commentCount = 0,
    reactions,
    onreact,
    taskUri = "",
    boardLabels = [],
    onedit,
    readonly = false,
    selected = false,
    editing = false,
    onsavetitle,
    onpastelines,
    ondiscarderrors,
  }: {
    task: MaterializedTask;
    currentUserDid: string;
    pending?: boolean;
    commentCount?: number;
    reactions?: Map<string, { count: number; userReacted: boolean }>;
    onreact?: (taskUri: string, emoji: string) => void;
    taskUri?: string;
    boardLabels?: Label[];
    onedit: (task: MaterializedTask) => void;
    readonly?: boolean;
    selected?: boolean;
    editing?: boolean;
    onsavetitle?: (
      task: MaterializedTask,
      title: string,
      andContinue?: boolean,
    ) => void;
    onpastelines?: (task: MaterializedTask, lines: string[]) => void;
    ondiscarderrors?: (task: MaterializedTask) => void;
  } = $props();

  let cardEl: HTMLDivElement | undefined = $state();
  let titleEl: HTMLDivElement | undefined = $state();
  let svelteTextNode: Text | null = null;

  $effect(() => {
    if (selected && cardEl) {
      cardEl.scrollIntoView({ block: "nearest" });
    }
  });

  $effect(() => {
    if (editing && titleEl) {
      // Capture Svelte's text node before contenteditable modifies the DOM
      for (const node of titleEl.childNodes) {
        if (node.nodeType === Node.TEXT_NODE) {
          svelteTextNode = node as Text;
          break;
        }
      }
      titleEl.focus();
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(titleEl);
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
  });

  // Restore the DOM to a single Svelte-tracked text node after contenteditable
  // may have created extra nodes (prevents doubled text on reactive updates)
  function normalizeTitleDom(value: string) {
    if (!titleEl || !svelteTextNode) return;
    svelteTextNode.nodeValue = value;
    while (titleEl.firstChild) {
      titleEl.removeChild(titleEl.firstChild);
    }
    titleEl.appendChild(svelteTextNode);
  }

  function commitEdit(andContinue = false) {
    if (!titleEl) return;
    const trimmed = (titleEl.textContent ?? "").trim();
    normalizeTitleDom(trimmed || task.effectiveTitle);
    if (trimmed && trimmed !== task.effectiveTitle) {
      onsavetitle?.(task, trimmed, andContinue);
    } else {
      onsavetitle?.(task, task.effectiveTitle, andContinue);
    }
  }

  function stripListMarker(line: string): string {
    return line.replace(/^(?:[-*+]|\d+[.)]\s?|☐\s?|☑\s?|>\s?)\s*/, "");
  }

  function handlePaste(e: ClipboardEvent) {
    const text = e.clipboardData?.getData("text/plain") ?? "";
    const lines = text
      .split(/\r?\n/)
      .map((l) => stripListMarker(l.trim()))
      .filter(Boolean);
    if (lines.length <= 1) return; // single line — let default paste behavior handle it
    e.preventDefault();
    if (titleEl) {
      titleEl.textContent = lines[0];
    }
    onpastelines?.(task, lines.slice(1));
    commitEdit(false);
  }

  let showReactionPopover = $state(false);
  let popoverStyle = $state("");
  let reactionTriggerEl: HTMLButtonElement | undefined = $state();
  let popoverEl: HTMLDivElement | undefined = $state();

  const totalReactionCount = $derived(
    reactions
      ? [...reactions.values()].reduce((sum, v) => sum + v.count, 0)
      : 0,
  );

  const topEmoji = $derived.by(() => {
    if (!reactions) return null;
    let best: { emoji: string; count: number } | null = null;
    for (const [emoji, data] of reactions) {
      if (data.count > 0 && (!best || data.count > best.count)) {
        best = { emoji, count: data.count };
      }
    }
    return best;
  });

  function getReactionCount(emoji: string): number {
    return reactions?.get(emoji)?.count ?? 0;
  }

  function isUserReacted(emoji: string): boolean {
    return reactions?.get(emoji)?.userReacted ?? false;
  }

  function handleReactionSelect(e: MouseEvent, emoji: string) {
    e.stopPropagation();
    onreact?.(taskUri, emoji);
  }

  function positionPopover() {
    if (!reactionTriggerEl || !popoverEl) return;
    const btn = reactionTriggerEl.getBoundingClientRect();
    const pw = popoverEl.offsetWidth;
    const ph = popoverEl.offsetHeight;
    const margin = 4;

    let left = btn.right - pw;
    if (left < margin) {
      left = btn.left;
    }
    left = Math.max(margin, Math.min(left, window.innerWidth - pw - margin));

    let top = btn.top - ph - margin;
    if (top < margin) {
      top = btn.bottom + margin;
    }

    popoverStyle = `top: ${top}px; left: ${left}px;`;
  }

  $effect(() => {
    if (showReactionPopover && popoverEl) {
      positionPopover();
    }
  });

  let closeTimer: ReturnType<typeof setTimeout> | null = null;

  function cancelClose() {
    if (closeTimer) {
      clearTimeout(closeTimer);
      closeTimer = null;
    }
  }

  function scheduleClose() {
    cancelClose();
    closeTimer = setTimeout(() => {
      showReactionPopover = false;
      closeTimer = null;
    }, 150);
  }

  function handleTriggerEnter(e: MouseEvent) {
    e.stopPropagation();
    cancelClose();
    showReactionPopover = true;
  }

  function handleTriggerLeave() {
    scheduleClose();
  }

  function handlePopoverEnter() {
    cancelClose();
  }

  function handlePopoverLeave() {
    scheduleClose();
  }

  const taskLabels = $derived(
    task.effectiveLabelIds
      .map((id) => boardLabels.find((l) => l.id === id))
      .filter((l): l is Label => l !== undefined),
  );

  const renderedDescription = $derived(
    task.effectiveDescription
      ? DOMPurify.sanitize(marked.parse(task.effectiveDescription) as string, {
          ADD_TAGS: ["input"],
          ADD_ATTR: ["type", "checked"],
        })
      : "",
  );

  const TASK_LIST_RE = /\[([ xX])\]/g;

  function handleCheckboxClick(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (
      target.tagName !== "INPUT" ||
      (target as HTMLInputElement).type !== "checkbox"
    )
      return;
    if (readonly || !currentUserDid || !task.effectiveDescription) return;

    e.preventDefault();
    e.stopPropagation();

    const container = target.closest(".task-desc");
    if (!container) return;
    const checkboxes = container.querySelectorAll('input[type="checkbox"]');
    const index = Array.from(checkboxes).indexOf(target as HTMLInputElement);
    if (index === -1) return;

    const desc = task.effectiveDescription;
    let count = 0;
    let match: RegExpExecArray | null;
    TASK_LIST_RE.lastIndex = 0;
    while ((match = TASK_LIST_RE.exec(desc)) !== null) {
      if (count === index) {
        const isChecked = match[1] !== " ";
        const newChar = isChecked ? " " : "x";
        const newDesc =
          desc.slice(0, match.index + 1) +
          newChar +
          desc.slice(match.index + 2);
        createOp(currentUserDid, task.sourceTask, task.boardUri, {
          description: newDesc,
        });
        break;
      }
      count++;
    }
  }

  const todoStats = $derived.by(() => {
    const desc = task.effectiveDescription;
    if (!desc) return null;
    let total = 0;
    let checked = 0;
    for (const m of desc.matchAll(/\[([ xX])\]/g)) {
      total++;
      if (m[1] !== " ") checked++;
    }
    return total > 0 ? { checked, total } : null;
  });

  const hasSyncErrors = $derived(
    task.sourceTask.syncStatus === "error" ||
      task.appliedOps.some((op) => op.syncStatus === "error"),
  );

  const isOwned = $derived(task.ownerDid === currentUserDid);

  const isDragging = $derived(
    getDraggedCard()?.id === task.sourceTask.id &&
      getDraggedCard()?.did === task.ownerDid,
  );

  let wasDragged = false;

  function handleDragStart(e: DragEvent) {
    if (readonly || !e.dataTransfer || !task.sourceTask.id) return;
    wasDragged = true;
    e.dataTransfer.setData(
      "application/x-skyboard-task",
      JSON.stringify({ id: task.sourceTask.id, did: task.ownerDid }),
    );
    e.dataTransfer.effectAllowed = "move";
    setDraggedCard({
      id: task.sourceTask.id,
      did: task.ownerDid,
      rkey: task.rkey,
      columnId: task.effectiveColumnId,
    });
  }

  function handleDragEnd() {
    setDraggedCard(null);
    setTimeout(() => {
      wasDragged = false;
    }, 0);
  }

  function handleTouchStartLocal(e: TouchEvent) {
    if (readonly || editing || !task.sourceTask.id || !cardEl) return;
    const target = e.target as HTMLElement;
    if (
      target.closest(
        'a, button, [contenteditable="true"], [contenteditable="plaintext-only"]',
      )
    )
      return;
    handleTouchStart(
      e,
      cardEl,
      {
        id: task.sourceTask.id,
        did: task.ownerDid,
        rkey: task.rkey,
        columnId: task.effectiveColumnId,
      },
      () => {
        wasDragged = true;
      },
    );
  }

  function handleClick(e: MouseEvent) {
    if (wasDragged) {
      wasDragged = false;
      return;
    }
    // Let the browser follow link clicks instead of opening the edit modal
    const target = e.target as HTMLElement;
    if (target.closest("a")) return;
    onedit(task);
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
<div
  class="task-card"
  class:task-pending={pending}
  class:dragging={isDragging}
  class:task-readonly={readonly}
  class:task-selected={selected}
  draggable={readonly ? "false" : "true"}
  ondragstart={handleDragStart}
  ondragend={handleDragEnd}
  ontouchstart={handleTouchStartLocal}
  onclick={handleClick}
  bind:this={cardEl}
>
  {#if pending}
    <div class="pending-bar">
      <span class="info-icon" title="Pending acceptance from board creator"
        >i</span
      >
      <span>Pending approval</span>
    </div>
  {/if}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="task-title"
    contenteditable={editing ? "plaintext-only" : false}
    bind:this={titleEl}
    onkeydown={editing
      ? (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commitEdit(true);
          }
          if (e.key === "Escape") {
            e.preventDefault();
            normalizeTitleDom(task.effectiveTitle);
            onsavetitle?.(task, task.effectiveTitle);
          }
          e.stopPropagation();
        }
      : undefined}
    onpaste={editing ? handlePaste : undefined}
    onblur={editing ? () => commitEdit() : undefined}
    onclick={editing ? (e) => e.stopPropagation() : undefined}
  >
    {task.effectiveTitle}
  </div>
  {#if taskLabels.length > 0}
    <div class="task-labels">
      {#each taskLabels as label (label.id)}
        <span
          class="label-pill"
          style="background: {label.color}20; color: {label.color}; border-color: {label.color}40;"
        >
          {label.name}
        </span>
      {/each}
    </div>
  {/if}
  {#if task.effectiveDescription}
    <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
    <div class="task-desc" onclick={handleCheckboxClick}>
      {@html renderedDescription}
    </div>
  {/if}
  <div class="task-meta">
    <AuthorBadge did={task.ownerDid} isCurrentUser={isOwned} />
    {#if task.effectiveAssigneeDid}
      <span class="assignee-badge" title="Assigned">
        <svg class="assignee-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="8" cy="5" r="3" />
          <path d="M2 14c0-3.3 2.7-6 6-6s6 2.7 6 6" />
        </svg>
        <AuthorBadge did={task.effectiveAssigneeDid} isCurrentUser={task.effectiveAssigneeDid === currentUserDid} />
      </span>
    {/if}
    {#if commentCount > 0}
      <span
        class="comment-badge"
        title="{commentCount} comment{commentCount === 1 ? '' : 's'}"
      >
        {commentCount}
      </span>
    {/if}
    {#if todoStats}
      <span
        class="todo-badge"
        class:todo-done={todoStats.checked === todoStats.total}
        title="{todoStats.checked} of {todoStats.total} completed"
      >
        <svg
          class="todo-icon"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
        >
          <rect x="1.5" y="1.5" width="13" height="13" rx="2" />
          <path d="M4.5 8.5l2.5 2.5 4.5-5" />
        </svg>
        {todoStats.checked}/{todoStats.total}
      </span>
    {/if}
    {#if task.pendingOps.length > 0}
      <span class="pending-badge" title="Has pending proposals">
        {task.pendingOps.length}
      </span>
    {/if}
    {#if totalReactionCount > 0 || (!readonly && onreact)}
      <button
        class="reaction-trigger"
        class:has-reactions={totalReactionCount > 0}
        bind:this={reactionTriggerEl}
        onmouseenter={handleTriggerEnter}
        onmouseleave={handleTriggerLeave}
        onclick={(e) => e.stopPropagation()}
        title="{totalReactionCount} reaction{totalReactionCount === 1
          ? ''
          : 's'}"
      >
        {#if topEmoji}
          {topEmoji.emoji} {topEmoji.count}
        {:else}
          <span class="reaction-trigger-icon">+</span>
        {/if}
      </button>
    {/if}
  </div>
  {#if !readonly}
    {#if hasSyncErrors}
      <div class="sync-error-bar">
        <span>Sync failed</span>
        {#if ondiscarderrors}
          <button
            class="discard-btn"
            onclick={(e) => {
              e.stopPropagation();
              ondiscarderrors(task);
            }}>Discard</button
          >
        {/if}
      </div>
    {:else if task.sourceTask.syncStatus === "pending"}
      <span class="sync-dot pending" title="Pending sync"></span>
    {/if}
  {/if}
</div>

{#if showReactionPopover}
  <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
  <div
    class="reaction-popover"
    bind:this={popoverEl}
    style={popoverStyle}
    onmouseenter={handlePopoverEnter}
    onmouseleave={handlePopoverLeave}
  >
    {#each EMOJI_OPTIONS as emoji (emoji)}
      <button
        class="popover-emoji"
        class:reacted={isUserReacted(emoji)}
        onclick={(e) => handleReactionSelect(e, emoji)}
      >
        <span class="popover-emoji-icon">{emoji}</span>
        <span class="popover-emoji-count">{getReactionCount(emoji)}</span>
      </button>
    {/each}
  </div>
{/if}

<style>
  .task-card {
    background: var(--color-surface);
    border: 1px solid var(--color-border-light);
    border-radius: var(--radius-md);
    padding: 0.625rem 0.75rem;
    cursor: grab;
    position: relative;
    scroll-margin: 6px;
    -webkit-user-select: none;
    user-select: none;
    transition:
      box-shadow 0.15s,
      border-color 0.15s;
  }

  .task-card.task-readonly {
    cursor: pointer;
  }

  .task-card:active:not(.task-readonly) {
    cursor: grabbing;
  }

  .task-card:hover {
    box-shadow: var(--shadow-sm);
    border-color: var(--color-border);
  }

  .task-card.task-selected {
    outline: 2px solid var(--color-primary);
    outline-offset: -1px;
    box-shadow: 0 0 0 3px var(--color-primary-alpha, rgba(0, 102, 204, 0.15));
  }

  .task-card.dragging {
    opacity: 0.3;
  }

  .task-card.task-pending {
    opacity: 0.55;
    border-style: dashed;
  }

  .pending-bar {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.625rem;
    color: var(--color-text-secondary);
    margin-bottom: 0.375rem;
  }

  .info-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 0.875rem;
    height: 0.875rem;
    border-radius: 50%;
    background: var(--color-border);
    color: var(--color-surface);
    font-size: 0.5rem;
    font-weight: 700;
    font-style: italic;
    flex-shrink: 0;
  }

  .task-title {
    font-size: 0.875rem;
    font-weight: 500;
    word-break: break-word;
    outline: none;
  }

  .task-title[contenteditable] {
    -webkit-user-select: text;
    user-select: text;
  }

  .task-labels {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
    margin-top: 0.25rem;
  }

  .label-pill {
    font-size: 0.625rem;
    font-weight: 600;
    padding: 0.0625rem 0.375rem;
    border-radius: var(--radius-sm);
    border: 1px solid;
    line-height: 1.4;
  }

  .task-desc {
    margin-top: 0.25rem;
    font-size: 0.8125rem;
    line-height: 1.4;
    color: var(--color-text-secondary);
    max-height: calc(7 * 1.4em);
    overflow: hidden;
    word-break: break-word;
    -webkit-mask-image: linear-gradient(to bottom, black 70%, transparent 100%);
    mask-image: linear-gradient(to bottom, black 70%, transparent 100%);
  }

  .task-desc :global(p),
  .task-desc :global(h1),
  .task-desc :global(h2),
  .task-desc :global(h3),
  .task-desc :global(h4),
  .task-desc :global(h5),
  .task-desc :global(h6) {
    margin: 0 0 0.25em;
  }

  .task-desc :global(h1),
  .task-desc :global(h2),
  .task-desc :global(h3),
  .task-desc :global(h4),
  .task-desc :global(h5),
  .task-desc :global(h6) {
    font-size: 0.8125rem;
    font-weight: 600;
  }

  .task-desc :global(ul),
  .task-desc :global(ol) {
    margin: 0 0 0.25em;
    padding-left: 1.25em;
  }

  .task-desc :global(li) {
    margin: 0;
  }

  .task-desc :global(code) {
    font-size: 0.6875rem;
    background: var(--color-border-light);
    padding: 0.1em 0.3em;
    border-radius: var(--radius-sm);
  }

  .task-desc :global(pre) {
    margin: 0.25em 0;
    padding: 0.375em 0.5em;
    background: var(--color-border-light);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }

  .task-desc :global(pre code) {
    background: none;
    padding: 0;
  }

  .task-desc :global(blockquote) {
    margin: 0.25em 0;
    padding-left: 0.5em;
    border-left: 2px solid var(--color-border);
    color: var(--color-text-secondary);
  }

  .task-desc :global(:last-child) {
    margin-bottom: 0;
  }

  .task-desc :global(a) {
    color: var(--color-primary);
    text-decoration: underline;
    cursor: pointer;
  }

  .task-desc :global(input[type="checkbox"]) {
    cursor: pointer;
    margin: 0 4px 0 0;
    vertical-align: middle;
    position: relative;
    top: -1px;
  }

  .task-meta {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    margin-top: 0.375rem;
  }

  .assignee-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.125rem;
    font-size: 0.75rem;
    color: var(--color-text-secondary);
  }

  .assignee-icon {
    width: 0.75rem;
    height: 0.75rem;
    flex-shrink: 0;
  }

  .todo-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.125rem;
    font-size: 0.75rem;
    color: var(--color-text-secondary);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .todo-icon {
    width: 0.75rem;
    height: 0.75rem;
  }

  .todo-badge.todo-done {
    color: var(--color-success, #22c55e);
  }

  .comment-badge {
    font-size: 0.75rem;
    background: var(--color-border);
    color: var(--color-text-secondary);
    padding: 0 0.3125rem;
    border-radius: var(--radius-sm);
    font-weight: 600;
  }

  .pending-badge {
    font-size: 0.75rem;
    background: var(--color-warning);
    color: white;
    padding: 0 0.3125rem;
    border-radius: var(--radius-sm);
    font-weight: 600;
  }

  .sync-error-bar {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    font-size: 0.625rem;
    color: var(--color-error);
    margin-top: 0.375rem;
    padding: 0.1875rem 0.375rem;
    background: var(--color-error-bg, rgba(239, 68, 68, 0.08));
    border-radius: var(--radius-sm);
  }

  .discard-btn {
    margin-left: auto;
    padding: 0.0625rem 0.375rem;
    border: 1px solid var(--color-error);
    border-radius: var(--radius-sm);
    background: none;
    color: var(--color-error);
    font-size: 0.625rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s;
  }

  .discard-btn:hover {
    background: var(--color-error);
    color: white;
  }

  .sync-dot {
    position: absolute;
    top: 0.5rem;
    right: 0.5rem;
    width: 6px;
    height: 6px;
    border-radius: 50%;
  }

  .sync-dot.pending {
    background: var(--color-warning);
  }

  .reaction-trigger {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    gap: 0.125rem;
    padding: 0 0.3125rem;
    border-radius: var(--radius-sm);
    border: none;
    background: none;
    font-size: 0.75rem;
    cursor: pointer;
    color: var(--color-text-secondary);
    line-height: 1.4;
    transition:
      background 0.15s,
      color 0.15s;
  }

  .reaction-trigger:hover {
    background: var(--color-border-light);
  }

  .reaction-trigger.has-reactions {
    background: var(--color-border-light);
    font-weight: 600;
  }

  .reaction-trigger-icon {
    font-size: 0.8125rem;
    opacity: 0.5;
  }

  .reaction-popover {
    position: fixed;
    display: flex;
    gap: 0.125rem;
    padding: 0.3rem;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-sm);
    z-index: 100;
  }

  .popover-emoji {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.25rem 0.375rem;
    border: 1px solid transparent;
    background: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition:
      background 0.15s,
      border-color 0.15s;
  }

  .popover-emoji:hover {
    background: var(--color-bg);
    border-color: var(--color-border-light);
  }

  .popover-emoji.reacted {
    background: var(--color-primary-alpha, rgba(0, 102, 204, 0.1));
    border-color: var(--color-primary);
  }

  .popover-emoji-icon {
    font-size: 1rem;
    line-height: 1;
  }

  .popover-emoji-count {
    font-size: 0.6875rem;
    font-weight: 600;
    color: var(--color-text-secondary);
    line-height: 1;
    min-width: 0.75rem;
    text-align: center;
  }

  .popover-emoji.reacted .popover-emoji-count {
    color: var(--color-primary);
  }
</style>
