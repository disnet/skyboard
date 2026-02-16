<script lang="ts">
  import { untrack } from "svelte";
  import { db } from "$lib/db.js";
  import type {
    MaterializedTask,
    Comment,
    Link,
    Label,
    Column,
  } from "$lib/types.js";
  import { createOp } from "$lib/ops.js";
  import { createComment, deleteComment } from "$lib/comments.js";
  import { createLink, deleteLink } from "$lib/links.js";
  import { TASK_COLLECTION } from "$lib/tid.js";
  import { getAuth } from "$lib/auth.svelte.js";
  import { deleteTaskFromPDS } from "$lib/sync.js";
  import { getActionStatus, isContentVisible } from "$lib/permissions.js";
  import type { PermissionStatus } from "$lib/permissions.js";
  import { COMMENT_COLLECTION, buildAtUri, generateTID } from "$lib/tid.js";
  import AuthorBadge from "./AuthorBadge.svelte";
  import MentionText from "./MentionText.svelte";
  import MentionTextarea from "./MentionTextarea.svelte";
  import { EditorView, basicSetup } from "codemirror";
  import { EditorState, Prec } from "@codemirror/state";
  import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
  import { languages } from "@codemirror/language-data";
  import { keymap, placeholder } from "@codemirror/view";
  import { autocompletion } from "@codemirror/autocomplete";
  import { mentionCompletionSource } from "$lib/mention-completions.js";
  import { markdownLivePreview } from "$lib/markdown-live-preview.js";
  import { formattingToolbar } from "$lib/editor-formatting-toolbar.js";
  import { Marked } from "marked";
  import { mentionExtension } from "$lib/mention-markdown.js";
  import BlockInsertMenu from "./BlockInsertMenu.svelte";
  import DOMPurify from "dompurify";

  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName === "A") {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
    }
  });

  const markedInstance = new Marked(mentionExtension(), {
    renderer: {
      checkbox({ checked }: { checked: boolean }) {
        return `<input ${checked ? 'checked="" ' : ""}type="checkbox"> `;
      },
    },
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
    boardOwnerDid,
    boardOpen,
    ownerTrustedDids,
    approvedUris,
    comments = [],
    reactions,
    links = [],
    allTasks = [],
    boardLabels = [],
    boardUri = "",
    columns = [],
    onclose,
    onreact,
    onmove,
    readonly = false,
  }: {
    task: MaterializedTask;
    currentUserDid: string;
    boardOwnerDid: string;
    boardOpen: boolean;
    ownerTrustedDids: Set<string>;
    approvedUris: Set<string>;
    comments?: Comment[];
    reactions?: Map<string, { count: number; userReacted: boolean }>;
    links?: Link[];
    allTasks?: MaterializedTask[];
    boardLabels?: Label[];
    boardUri?: string;
    columns?: Column[];
    onclose: () => void;
    onreact?: (taskUri: string, emoji: string) => void;
    onmove?: (task: MaterializedTask, columnId: string) => void;
    readonly?: boolean;
  } = $props();

  const activeReactions = $derived(
    reactions ? [...reactions.entries()].filter(([, v]) => v.count > 0) : [],
  );

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

  function handleReactionClick(emoji: string) {
    onreact?.(taskUri, emoji);
  }

  function handleReactionSelect(e: MouseEvent, emoji: string) {
    e.stopPropagation();
    onreact?.(taskUri, emoji);
  }

  let showReactionPopover = $state(false);
  let popoverStyle = $state("");
  let reactionTriggerEl: HTMLButtonElement | undefined = $state();
  let popoverEl: HTMLDivElement | undefined = $state();

  function positionPopover() {
    if (!reactionTriggerEl || !popoverEl) return;
    const btn = reactionTriggerEl.getBoundingClientRect();
    const pw = popoverEl.offsetWidth;
    const ph = popoverEl.offsetHeight;
    const margin = 4;

    let left = btn.right - pw;
    if (left < margin) left = btn.left;
    left = Math.max(margin, Math.min(left, window.innerWidth - pw - margin));

    let top = btn.bottom + margin;
    if (top + ph > window.innerHeight - margin) {
      top = btn.top - ph - margin;
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

  const renderedDescription = $derived(
    task.effectiveDescription
      ? DOMPurify.sanitize(
          markedInstance.parse(task.effectiveDescription) as string,
          { ADD_TAGS: ["input"], ADD_ATTR: ["type", "checked"] },
        )
      : "",
  );

  const todoStats = $derived.by(() => {
    const desc = readonly ? task.effectiveDescription : editDescription;
    if (!desc) return null;
    let total = 0;
    let checked = 0;
    for (const m of desc.matchAll(/\[([ xX])\]/g)) {
      total++;
      if (m[1] !== " ") checked++;
    }
    return total > 0 ? { checked, total } : null;
  });

  const isOwned = $derived(task.ownerDid === currentUserDid);

  const editStatus: PermissionStatus = $derived(
    isOwned
      ? "allowed"
      : getActionStatus(
          currentUserDid,
          boardOwnerDid,
          ownerTrustedDids,
          boardOpen,
          "edit",
        ),
  );

  const commentStatus: PermissionStatus = $derived(
    currentUserDid
      ? getActionStatus(
          currentUserDid,
          boardOwnerDid,
          ownerTrustedDids,
          boardOpen,
          "comment",
        )
      : "denied",
  );

  // Comment-related derivations
  const taskUri = $derived(
    `at://${task.ownerDid}/dev.skyboard.task/${task.rkey}`,
  );

  const allTaskComments = $derived(
    comments
      .filter((c) => c.targetTaskUri === taskUri)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  );

  // Only show comments from visible users
  const taskComments = $derived.by(() => {
    return allTaskComments.filter((c) => {
      const commentUri = buildAtUri(c.did, COMMENT_COLLECTION, c.rkey);
      return isContentVisible(
        c.did,
        currentUserDid,
        boardOwnerDid,
        ownerTrustedDids,
        boardOpen,
        approvedUris,
        commentUri,
      );
    });
  });

  const moveStatus: PermissionStatus = $derived(
    getActionStatus(
      currentUserDid,
      boardOwnerDid,
      ownerTrustedDids,
      boardOpen,
      "move",
    ),
  );

  let showMoveMenu = $state(false);

  function handleMove(columnId: string) {
    showMoveMenu = false;
    onmove?.(task, columnId);
  }

  function handleMoveKeydown(e: KeyboardEvent) {
    if (!showMoveMenu) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      showMoveMenu = false;
      return;
    }
    const num = parseInt(e.key, 10);
    if (num >= 1 && num <= 9 && num <= columns.length) {
      e.preventDefault();
      e.stopPropagation();
      handleMove(columns[num - 1].id);
    }
  }

  let commentText = $state("");
  let submittingComment = $state(false);

  async function submitComment() {
    const text = commentText.trim();
    if (!text || !currentUserDid || !boardUri) return;
    submittingComment = true;
    try {
      await createComment(currentUserDid, taskUri, boardUri, text);
      commentText = "";
    } finally {
      submittingComment = false;
    }
  }

  async function handleDeleteComment(comment: Comment) {
    await deleteComment(comment);
  }

  function relativeTime(iso: string): string {
    const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (seconds < 60) return "just now";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months}mo`;
    return `${Math.floor(months / 12)}y`;
  }

  // We intentionally capture initial values for editing a copy
  /* eslint-disable svelte/state-referenced-locally */
  let editTitle = $state(task.effectiveTitle);
  let editDescription = $state(task.effectiveDescription ?? "");
  let editLabelIds = $state<string[]>([...task.effectiveLabelIds]);

  function toggleLabel(id: string) {
    if (editLabelIds.includes(id)) {
      editLabelIds = editLabelIds.filter((l) => l !== id);
    } else {
      editLabelIds = [...editLabelIds, id];
    }
  }

  const isBoardOwner = $derived(currentUserDid === boardOwnerDid);

  const LABEL_COLORS = [
    { name: "Red", value: "#ef4444" },
    { name: "Orange", value: "#f97316" },
    { name: "Amber", value: "#f59e0b" },
    { name: "Green", value: "#22c55e" },
    { name: "Teal", value: "#14b8a6" },
    { name: "Blue", value: "#3b82f6" },
    { name: "Indigo", value: "#6366f1" },
    { name: "Violet", value: "#8b5cf6" },
    { name: "Pink", value: "#ec4899" },
    { name: "Gray", value: "#6b7280" },
  ];

  let showAddLabel = $state(false);
  let newLabelName = $state("");
  let newLabelColor = $state("#ef4444");

  async function addBoardLabel() {
    const labelName = newLabelName.trim();
    if (!labelName || !boardUri) return;

    // Find the board by rkey from boardUri
    const parts = boardUri.split("/");
    const boardRkey = parts[parts.length - 1];
    const board = await db.boards.where("rkey").equals(boardRkey).first();
    if (!board?.id) return;

    const newLabel: Label = {
      id: generateTID(),
      name: labelName,
      color: newLabelColor,
    };
    const existingLabels = board.labels ?? [];
    await db.boards.update(board.id, {
      labels: [...existingLabels, newLabel],
      syncStatus: "pending",
    });

    // Auto-select the newly created label
    editLabelIds = [...editLabelIds, newLabel.id];

    newLabelName = "";
    showAddLabel = false;
  }

  const taskLabelsForDisplay = $derived(
    task.effectiveLabelIds
      .map((id) => boardLabels.find((l) => l.id === id))
      .filter((l): l is Label => l !== undefined),
  );

  // --- Links ---

  const LINK_TYPE_LABELS: Record<string, string> = {
    blocks: "blocks",
    relates_to: "relates to",
    duplicates: "duplicates",
  };
  const INVERSE_LINK_LABELS: Record<string, string> = {
    blocks: "blocked by",
    relates_to: "relates to",
    duplicates: "duplicated by",
  };

  let showAddLink = $state(false);
  let newLinkType = $state("relates_to");
  let newLinkTargetRkey = $state("");

  // Tasks available for linking (exclude current task)
  const linkableTaskOptions = $derived(
    allTasks
      .filter((t) => !(t.rkey === task.rkey && t.ownerDid === task.ownerDid))
      .map((t) => ({
        uri: buildAtUri(t.ownerDid, TASK_COLLECTION, t.rkey),
        rkey: t.rkey,
        did: t.ownerDid,
        title: t.effectiveTitle,
      })),
  );

  function getLinkLabel(link: Link): string {
    if (link.sourceTaskUri === taskUri) {
      return LINK_TYPE_LABELS[link.linkType] ?? link.linkType;
    }
    return INVERSE_LINK_LABELS[link.linkType] ?? link.linkType;
  }

  function getLinkedTaskUri(link: Link): string {
    return link.sourceTaskUri === taskUri
      ? link.targetTaskUri
      : link.sourceTaskUri;
  }

  function getLinkedTaskTitle(link: Link): string {
    const linkedUri = getLinkedTaskUri(link);
    const found = allTasks.find(
      (t) => buildAtUri(t.ownerDid, TASK_COLLECTION, t.rkey) === linkedUri,
    );
    return found?.effectiveTitle ?? "Unknown task";
  }

  async function handleAddLink() {
    if (!currentUserDid || !newLinkTargetRkey) return;
    const target = linkableTaskOptions.find(
      (t) => t.rkey === newLinkTargetRkey,
    );
    if (!target) return;

    await createLink(
      currentUserDid,
      taskUri,
      target.uri,
      boardUri,
      newLinkType,
    );
    newLinkTargetRkey = "";
    newLinkType = "relates_to";
    showAddLink = false;
  }

  async function handleDeleteLink(link: Link) {
    await deleteLink(link);
  }

  let editorContainer: HTMLDivElement | undefined = $state();
  let editorView: EditorView | undefined = $state();

  $effect(() => {
    if (!editorContainer) return;

    const initialDoc = untrack(() => editDescription);
    const state = EditorState.create({
      doc: initialDoc,
      extensions: [
        basicSetup,
        markdown({ codeLanguages: languages, base: markdownLanguage }),
        EditorView.lineWrapping,
        Prec.highest(
          keymap.of([
            {
              key: "Mod-Enter",
              run: () => {
                closeModal();
                return true;
              },
            },
          ]),
        ),
        placeholder("Write a description… Type @ to mention, / for commands"),
        autocompletion({ override: [mentionCompletionSource] }),
        markdownLivePreview,
        formattingToolbar,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            editDescription = update.state.doc.toString();
          }
        }),
        EditorView.theme({
          "&": {
            fontSize: "0.875rem",
          },
          ".cm-scroller": {
            overflow: "visible",
            fontFamily: "inherit",
          },
          ".cm-content": {
            caretColor: "var(--color-primary)",
            padding: "0.5rem 0",
          },
          "&.cm-focused": {
            outline: "none",
          },
          ".cm-gutters": {
            display: "none",
          },
          ".cm-activeLine": {
            backgroundColor: "transparent",
          },
        }),
      ],
    });

    editorView = new EditorView({
      state,
      parent: editorContainer,
    });

    // Cmd/Ctrl+click to open links — use capturing listener to intercept
    // before CodeMirror's multi-cursor handler processes the event
    function handleEditorMousedown(e: MouseEvent) {
      if (!(e.metaKey || e.ctrlKey) || !editorView) return;
      const pos = editorView.posAtCoords({ x: e.clientX, y: e.clientY });
      if (pos === null) return;
      const line = editorView.state.doc.lineAt(pos);
      const text = line.text;
      const offsetInLine = pos - line.from;
      // Try markdown link syntax first: [text](url)
      const mdLinkRegex = /\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g;
      let match: RegExpExecArray | null;
      while ((match = mdLinkRegex.exec(text)) !== null) {
        if (
          offsetInLine >= match.index &&
          offsetInLine <= match.index + match[0].length
        ) {
          e.preventDefault();
          e.stopImmediatePropagation();
          window.open(match[2], "_blank", "noopener,noreferrer");
          return;
        }
      }
      // Try plain URL (with or without protocol)
      const urlRegex = /(?:https?:\/\/|www\.)[^\s)>\]]+/g;
      while ((match = urlRegex.exec(text)) !== null) {
        if (
          offsetInLine >= match.index &&
          offsetInLine <= match.index + match[0].length
        ) {
          e.preventDefault();
          e.stopImmediatePropagation();
          const url = match[0].startsWith("www.")
            ? `https://${match[0]}`
            : match[0];
          window.open(url, "_blank", "noopener,noreferrer");
          return;
        }
      }
    }
    editorContainer.addEventListener("mousedown", handleEditorMousedown, true);

    return () => {
      editorContainer!.removeEventListener(
        "mousedown",
        handleEditorMousedown,
        true,
      );
      editorView?.destroy();
      editorView = undefined;
    };
  });

  async function commitChanges() {
    if (readonly || editStatus === "denied") return;

    const title = editTitle.trim();
    if (!title) return;

    const description = editDescription.trim() || undefined;

    const fields: Record<string, unknown> = {};
    if (title !== task.effectiveTitle) fields.title = title;
    if (description !== task.effectiveDescription)
      fields.description = description;
    const sortedEditLabelIds = [...editLabelIds].sort();
    const sortedEffectiveLabelIds = [...task.effectiveLabelIds].sort();
    if (
      JSON.stringify(sortedEditLabelIds) !==
      JSON.stringify(sortedEffectiveLabelIds)
    )
      fields.labelIds = [...editLabelIds];
    if (Object.keys(fields).length > 0) {
      await createOp(currentUserDid, task.sourceTask, task.boardUri, fields);
    }
  }

  async function closeModal() {
    await commitChanges();
    onclose();
  }

  async function deleteTask() {
    if (!isOwned || !task.sourceTask.id) return;
    if (!confirm("Delete this task?")) return;

    if (task.sourceTask.syncStatus === "synced") {
      const auth = getAuth();
      if (auth.agent && auth.did) {
        await deleteTaskFromPDS(auth.agent, auth.did, task.sourceTask);
      }
    }

    await db.tasks.delete(task.sourceTask.id);
    onclose();
  }

  let modalEl: HTMLDivElement | undefined = $state();
  let titleInputEl: HTMLInputElement | undefined = $state();

  $effect(() => {
    if (titleInputEl) {
      titleInputEl.focus();
    }
  });

  function getFocusableElements(): HTMLElement[] {
    if (!modalEl) return [];
    const els = modalEl.querySelectorAll<HTMLElement>(
      'input:not([disabled]):not([tabindex="-1"]), textarea:not([disabled]):not([tabindex="-1"]), button:not([disabled]):not([tabindex="-1"]), select:not([disabled]):not([tabindex="-1"]), [contenteditable="true"], [tabindex]:not([tabindex="-1"]):not([disabled])',
    );
    return Array.from(els).filter((el) => el.offsetParent !== null);
  }

  let mouseDownOnBackdrop = false;

  function handleBackdropMouseDown(e: MouseEvent) {
    mouseDownOnBackdrop = e.target === e.currentTarget;
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget && mouseDownOnBackdrop) closeModal();
    mouseDownOnBackdrop = false;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Tab") {
      const focusable = getFocusableElements();
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (
          document.activeElement === first ||
          !modalEl?.contains(document.activeElement)
        ) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (
          document.activeElement === last ||
          !modalEl?.contains(document.activeElement)
        ) {
          e.preventDefault();
          first.focus();
        }
      }
      return;
    }
    if (showMoveMenu) {
      handleMoveKeydown(e);
      return;
    }
    if (
      e.key === "m" &&
      !readonly &&
      onmove &&
      moveStatus !== "denied" &&
      columns.length > 0
    ) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if ((e.target as HTMLElement)?.isContentEditable) return;
      if (editorView?.hasFocus) return;
      e.preventDefault();
      showMoveMenu = true;
      return;
    }
    if (e.key === "Escape") {
      if (editorView?.hasFocus) {
        editorView.contentDOM.blur();
      } else {
        closeModal();
      }
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
<div
  class="modal-backdrop"
  onmousedown={handleBackdropMouseDown}
  onclick={handleBackdropClick}
>
  <div
    class="modal"
    role="dialog"
    aria-label={readonly ? "View Task" : "Edit Task"}
    aria-modal="true"
    bind:this={modalEl}
  >
    <div class="modal-header">
      <div class="modal-header-top">
        {#if readonly}
          <span class="view-title">{task.effectiveTitle}</span>
        {:else}
          <input
            class="edit-title"
            type="text"
            bind:value={editTitle}
            bind:this={titleInputEl}
            placeholder="Task title"
            disabled={editStatus === "denied"}
          />
          {#if editStatus === "denied"}
            <span class="field-status denied">Trusted users only</span>
          {/if}
        {/if}
        {#if totalReactionCount > 0 || (!readonly && onreact)}
          <button
            class="modal-reaction-trigger"
            class:has-reactions={totalReactionCount > 0}
            bind:this={reactionTriggerEl}
            onmouseenter={handleTriggerEnter}
            onmouseleave={handleTriggerLeave}
            title="{totalReactionCount} reaction{totalReactionCount === 1
              ? ''
              : 's'}"
            tabindex="-1"
          >
            {#if topEmoji}
              {topEmoji.emoji} {topEmoji.count}
            {:else}
              <span class="reaction-trigger-icon">+</span>
            {/if}
          </button>
        {/if}
        <button class="close-btn" onclick={closeModal} tabindex="-1"
          >&times;</button
        >
      </div>
    </div>

    <div class="modal-body">
      {#if readonly}
        {#if renderedDescription}
          <div class="rendered-description">{@html renderedDescription}</div>
        {:else}
          <p class="no-description">No description</p>
        {/if}

        {#if taskLabelsForDisplay.length > 0}
          <div class="labels-section">
            <div class="labels-header">
              <label>Labels</label>
            </div>
            <div class="label-pills">
              {#each taskLabelsForDisplay as lbl (lbl.id)}
                <span
                  class="label-pill"
                  style="background: {lbl.color}20; color: {lbl.color}; border-color: {lbl.color}40;"
                >
                  {lbl.name}
                </span>
              {/each}
            </div>
          </div>
        {/if}
      {:else}
        <div class="field">
          {#if editStatus === "denied"}
            <div class="field-header">
              <span class="field-status denied">Trusted users only</span>
            </div>
          {/if}
          <div class="editor-area">
            {#if editStatus !== "denied"}
              <BlockInsertMenu {editorView} />
            {/if}
            <div
              class="editor-wrapper"
              class:disabled={editStatus === "denied"}
              bind:this={editorContainer}
            ></div>
          </div>
        </div>

        <div class="labels-section">
          <div class="labels-header">
            <!-- svelte-ignore a11y_label_has_associated_control -->
            <label>Labels</label>
            {#if editStatus === "denied"}
              <span class="field-status denied">Trusted users only</span>
            {/if}
          </div>
          <div class="label-picker" class:disabled={editStatus === "denied"}>
            {#each boardLabels as lbl (lbl.id)}
              <button
                class="label-toggle"
                class:selected={editLabelIds.includes(lbl.id)}
                style="--label-color: {lbl.color};"
                onclick={() => toggleLabel(lbl.id)}
                disabled={editStatus === "denied"}
              >
                <span class="label-dot" style="background: {lbl.color};"></span>
                {lbl.name}
              </button>
            {/each}
            {#if isBoardOwner && editStatus !== "denied" && !showAddLabel}
              <button
                class="label-toggle add-new-label"
                onclick={() => (showAddLabel = true)}>+</button
              >
            {/if}
          </div>
          {#if showAddLabel && isBoardOwner}
            <div class="add-label-form">
              <span class="add-label-dot" style="background: {newLabelColor};"
              ></span>
              <input
                class="add-label-input"
                type="text"
                bind:value={newLabelName}
                placeholder="Label name"
                onkeydown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addBoardLabel();
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    showAddLabel = false;
                    newLabelName = "";
                  }
                }}
              />
              <select bind:value={newLabelColor} class="add-label-color">
                {#each LABEL_COLORS as c}
                  <option value={c.value}>{c.name}</option>
                {/each}
              </select>
              <button
                class="add-label-confirm"
                onclick={addBoardLabel}
                disabled={!newLabelName.trim()}>Add</button
              >
              <button
                class="add-label-cancel"
                onclick={() => {
                  showAddLabel = false;
                  newLabelName = "";
                }}>&times;</button
              >
            </div>
          {/if}
        </div>
      {/if}

      {#if links.length > 0 || !readonly}
        <div class="links-section">
          <div class="links-header">
            <label>Links ({links.length})</label>
            {#if !readonly}
              <button
                class="add-link-btn"
                onclick={() => (showAddLink = !showAddLink)}
              >
                {showAddLink ? "Cancel" : "+ Add link"}
              </button>
            {/if}
          </div>

          {#if showAddLink}
            <div class="add-link-form">
              <select bind:value={newLinkType} class="link-type-select">
                <option value="relates_to">relates to</option>
                <option value="blocks">blocks</option>
                <option value="duplicates">duplicates</option>
              </select>
              <select bind:value={newLinkTargetRkey} class="link-target-select">
                <option value="">Select a task...</option>
                {#each linkableTaskOptions as opt}
                  <option value={opt.rkey}>{opt.title}</option>
                {/each}
              </select>
              <button
                class="add-link-confirm"
                onclick={handleAddLink}
                disabled={!newLinkTargetRkey}>Add</button
              >
            </div>
          {/if}

          {#if links.length > 0}
            <div class="links-list">
              {#each links as link}
                <div class="link-item">
                  <span class="link-type-label">{getLinkLabel(link)}</span>
                  <span class="link-task-title">{getLinkedTaskTitle(link)}</span
                  >
                  {#if !readonly && (link.did === currentUserDid || currentUserDid === boardOwnerDid)}
                    <button
                      class="link-delete-btn"
                      onclick={() => handleDeleteLink(link)}
                      title="Remove link">&times;</button
                    >
                  {/if}
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {/if}

      {#if taskComments.length > 0 || (!readonly && commentStatus !== "denied")}
        <div class="comments-section">
          <div class="comments-header">
            <label>Comments ({taskComments.length})</label>
          </div>
          {#if !readonly && commentStatus !== "denied"}
            <form
              class="comment-form"
              onsubmit={(e) => {
                e.preventDefault();
                submitComment();
              }}
            >
              <MentionTextarea
                bind:value={commentText}
                placeholder={commentStatus === "pending"
                  ? "Add a comment (pending approval)..."
                  : "Add a comment..."}
                maxlength={10240}
                disabled={submittingComment}
                onsubmit={submitComment}
              />
              <button
                class="comment-submit-btn"
                type="submit"
                disabled={!commentText.trim() || submittingComment}
              >
                Comment
              </button>
            </form>
          {/if}
          {#if taskComments.length > 0}
            <div class="comments-list">
              {#each taskComments as comment (comment.id)}
                <div class="comment">
                  <div class="comment-header">
                    <AuthorBadge
                      did={comment.did}
                      isCurrentUser={comment.did === currentUserDid}
                    />
                    <span
                      class="comment-time"
                      title={new Date(comment.createdAt).toLocaleString()}
                      >{relativeTime(comment.createdAt)}</span
                    >
                    {#if comment.syncStatus === "pending"}
                      <span
                        class="comment-sync-dot pending"
                        title="Pending sync"
                      ></span>
                    {:else if comment.syncStatus === "error"}
                      <span class="comment-sync-dot error" title="Sync error"
                      ></span>
                    {/if}
                    {#if comment.did === currentUserDid}
                      <button
                        class="comment-delete-btn"
                        onclick={() => handleDeleteComment(comment)}
                        title="Delete comment">&times;</button
                      >
                    {/if}
                  </div>
                  <div class="comment-text rendered-description">
                    {@html DOMPurify.sanitize(
                      markedInstance.parse(comment.text) as string,
                    )}
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    </div>

    <div class="modal-footer">
      <div class="footer-left">
        <AuthorBadge did={task.ownerDid} isCurrentUser={isOwned} />
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
        {#if !readonly && !isOwned && editStatus === "allowed"}
          <span class="op-notice">Changes will be proposed</span>
        {:else if !readonly && !isOwned && editStatus === "denied"}
          <span class="op-notice denied">Trusted users only</span>
        {/if}
      </div>
      <div class="footer-right">
        {#if !readonly && onmove && moveStatus !== "denied" && columns.length > 0}
          <div class="move-wrapper">
            <button
              class="move-btn"
              onclick={() => (showMoveMenu = !showMoveMenu)}
            >
              Move
            </button>
            {#if showMoveMenu}
              <div class="move-menu">
                {#each columns as col, i (col.id)}
                  <button
                    class="move-option"
                    class:current={col.id === task.effectiveColumnId}
                    onclick={() => handleMove(col.id)}
                  >
                    {#if i < 9}
                      <kbd class="move-key">{i + 1}</kbd>
                    {:else}
                      <span class="move-key-spacer"></span>
                    {/if}
                    {col.name}
                    {#if col.id === task.effectiveColumnId}
                      <span class="current-indicator">(current)</span>
                    {/if}
                  </button>
                {/each}
              </div>
            {/if}
          </div>
        {/if}
        {#if !readonly && isOwned}
          <button class="delete-btn" onclick={deleteTask}>Delete</button>
        {/if}
      </div>
    </div>
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
    max-width: 640px;
    max-height: 90vh;
    overflow-y: auto;
    box-shadow: var(--shadow-lg);
    display: flex;
    flex-direction: column;
  }

  .modal-header {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 1rem 1.25rem;
    border-bottom: 1px solid var(--color-border-light);
  }

  .modal-header-top {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .modal-reaction-trigger {
    display: inline-flex;
    align-items: center;
    gap: 0.125rem;
    padding: 0.125rem 0.375rem;
    border-radius: var(--radius-sm);
    border: none;
    background: none;
    font-size: 0.8125rem;
    cursor: pointer;
    color: var(--color-text-secondary);
    line-height: 1.4;
    transition:
      background 0.15s,
      color 0.15s;
  }

  .modal-reaction-trigger:hover {
    background: var(--color-border-light);
  }

  .modal-reaction-trigger.has-reactions {
    background: var(--color-border-light);
    font-weight: 600;
  }

  .reaction-trigger-icon {
    font-size: 0.875rem;
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
    z-index: 200;
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

  .edit-title {
    flex: 1;
    border: none;
    font-size: 1.125rem;
    font-weight: 600;
    color: var(--color-text);
    background: transparent;
    padding: 0.25rem 0;
  }

  .view-title {
    flex: 1;
    font-size: 1.125rem;
    font-weight: 600;
    color: var(--color-text);
    padding: 0.25rem 0;
  }

  .edit-title:focus {
    outline: none;
  }

  .edit-title::placeholder {
    color: var(--color-text-secondary);
    font-weight: 400;
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
    padding: 1.25rem 0;
    flex: 1;
    overflow-y: auto;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    padding: 0 0.75rem 0 0.5rem;
  }

  .field label {
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--color-text-secondary);
  }

  .editor-area {
    display: flex;
    position: relative;
  }

  .editor-area .editor-wrapper {
    flex: 1;
    min-width: 0;
  }

  .editor-wrapper {
    overflow: hidden;
    min-height: 150px;
  }

  .modal-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem 1.25rem;
    border-top: 1px solid var(--color-border-light);
    gap: 0.75rem;
  }

  .footer-left {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .field-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .field-status {
    font-size: 0.6875rem;
    font-weight: 500;
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
  }

  .field-status.denied {
    color: var(--color-text-secondary);
    font-style: italic;
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

  .op-notice {
    font-size: 0.75rem;
    color: var(--color-warning);
    font-weight: 500;
  }

  .op-notice.denied {
    color: var(--color-text-secondary);
    font-style: italic;
  }

  .edit-title:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .editor-wrapper.disabled {
    opacity: 0.6;
    pointer-events: none;
  }

  .footer-right {
    display: flex;
    gap: 0.5rem;
  }

  .move-wrapper {
    position: relative;
  }

  .move-btn {
    padding: 0.5rem 1rem;
    background: var(--color-surface);
    color: var(--color-text-secondary);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    font-size: 0.875rem;
    cursor: pointer;
    transition:
      background 0.15s,
      color 0.15s;
  }

  .move-btn:hover {
    background: var(--color-bg);
    color: var(--color-text);
  }

  .move-menu {
    position: absolute;
    bottom: calc(100% + 4px);
    right: 0;
    min-width: 160px;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-lg);
    z-index: 10;
    padding: 0.25rem 0;
  }

  .move-option {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    width: 100%;
    padding: 0.4375rem 0.75rem;
    border: none;
    background: none;
    color: var(--color-text);
    font-size: 0.8125rem;
    text-align: left;
    cursor: pointer;
    transition: background 0.1s;
  }

  .move-option:hover {
    background: var(--color-bg);
  }

  .move-option.current {
    font-weight: 600;
    color: var(--color-primary);
  }

  .move-key {
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

  .move-key-spacer {
    width: 18px;
    flex-shrink: 0;
  }

  .current-indicator {
    font-weight: 400;
    font-size: 0.6875rem;
    color: var(--color-text-secondary);
  }

  .delete-btn {
    padding: 0.5rem 1rem;
    background: var(--color-error-bg);
    color: var(--color-error);
    border: 1px solid transparent;
    border-radius: var(--radius-md);
    font-size: 0.875rem;
    cursor: pointer;
  }

  .delete-btn:hover {
    border-color: var(--color-error);
  }

  .rendered-description {
    font-size: 0.875rem;
    line-height: 1.6;
    color: var(--color-text);
    word-break: break-word;
  }

  .modal-body > .rendered-description {
    padding: 0 1.25rem;
  }

  .rendered-description :global(p) {
    margin: 0 0 0.75em;
  }

  .rendered-description :global(h1),
  .rendered-description :global(h2),
  .rendered-description :global(h3),
  .rendered-description :global(h4),
  .rendered-description :global(h5),
  .rendered-description :global(h6) {
    margin: 0 0 0.5em;
    font-weight: 600;
  }

  .rendered-description :global(ul),
  .rendered-description :global(ol) {
    margin: 0 0 0.75em;
    padding-left: 1.5em;
  }

  .rendered-description :global(code) {
    font-size: 0.8125rem;
    background: var(--color-border-light);
    padding: 0.15em 0.35em;
    border-radius: var(--radius-sm);
  }

  .rendered-description :global(pre) {
    margin: 0.5em 0;
    padding: 0.75em 1em;
    background: var(--color-border-light);
    border-radius: var(--radius-md);
    overflow-x: auto;
  }

  .rendered-description :global(pre code) {
    background: none;
    padding: 0;
  }

  .rendered-description :global(blockquote) {
    margin: 0.5em 0;
    padding-left: 0.75em;
    border-left: 3px solid var(--color-border);
    color: var(--color-text-secondary);
  }

  .rendered-description :global(:last-child) {
    margin-bottom: 0;
  }

  .rendered-description :global(a) {
    color: var(--color-primary);
    text-decoration: underline;
    cursor: pointer;
  }

  .rendered-description :global(input[type="checkbox"]) {
    margin: 0 4px 0 0;
    vertical-align: middle;
    position: relative;
    top: -1px;
  }

  .rendered-description :global(.mention) {
    color: var(--color-primary);
    background: var(--color-primary-alpha, rgba(0, 102, 204, 0.1));
    font-weight: 500;
    border-radius: 2px;
    padding: 0 1px;
  }

  .no-description {
    font-size: 0.875rem;
    color: var(--color-text-secondary);
    font-style: italic;
    padding: 0 1.25rem;
  }

  .labels-section {
    margin-top: 1rem;
    padding: 0 1.25rem;
  }

  .labels-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.375rem;
  }

  .labels-header label {
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--color-text-secondary);
  }

  .label-pills {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
  }

  .label-pill {
    font-size: 0.75rem;
    font-weight: 600;
    padding: 0.125rem 0.5rem;
    border-radius: var(--radius-sm);
    border: 1px solid;
    line-height: 1.4;
  }

  .add-new-label {
    color: var(--color-text-secondary) !important;
    border-style: dashed !important;
    padding: 0.25rem 0.5rem !important;
    font-size: 0.875rem !important;
  }

  .add-new-label:hover {
    color: var(--color-primary) !important;
    border-color: var(--color-primary) !important;
  }

  .add-label-form {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    margin-top: 0.375rem;
  }

  .add-label-dot {
    width: 0.75rem;
    height: 0.75rem;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .add-label-input {
    flex: 1;
    padding: 0.3rem 0.5rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    font-size: 0.8125rem;
    background: var(--color-bg);
    color: var(--color-text);
  }

  .add-label-input:focus {
    outline: none;
    border-color: var(--color-primary);
  }

  .add-label-color {
    padding: 0.3rem 0.25rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    font-size: 0.75rem;
    background: var(--color-surface);
    color: var(--color-text);
    cursor: pointer;
  }

  .add-label-confirm {
    padding: 0.3rem 0.625rem;
    background: var(--color-primary);
    color: white;
    border: none;
    border-radius: var(--radius-md);
    font-size: 0.8125rem;
    cursor: pointer;
  }

  .add-label-confirm:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .add-label-cancel {
    background: none;
    border: none;
    font-size: 1rem;
    color: var(--color-text-secondary);
    cursor: pointer;
    padding: 0 0.25rem;
    line-height: 1;
  }

  .label-picker {
    display: flex;
    flex-wrap: wrap;
    gap: 0.375rem;
  }

  .label-picker.disabled {
    opacity: 0.6;
    pointer-events: none;
  }

  .label-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.25rem 0.625rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    color: var(--color-text);
    font-size: 0.8125rem;
    cursor: pointer;
    transition: all 0.15s;
  }

  .label-toggle:hover:not(:disabled) {
    border-color: var(--label-color);
  }

  .label-toggle.selected {
    background: color-mix(in srgb, var(--label-color) 12%, transparent);
    border-color: color-mix(in srgb, var(--label-color) 40%, transparent);
    color: var(--label-color);
    font-weight: 500;
  }

  .label-dot {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .links-section {
    margin-top: 0.75rem;
    border-top: 1px solid var(--color-border-light);
    padding: 0.75rem 1.25rem 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .links-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .links-header label {
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--color-text-secondary);
  }

  .add-link-btn {
    background: none;
    border: none;
    font-size: 0.75rem;
    color: var(--color-primary);
    cursor: pointer;
    font-weight: 500;
  }

  .add-link-btn:hover {
    text-decoration: underline;
  }

  .add-link-form {
    display: flex;
    align-items: center;
    gap: 0.375rem;
  }

  .link-type-select,
  .link-target-select {
    padding: 0.3rem 0.5rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    font-size: 0.8125rem;
    background: var(--color-surface);
    color: var(--color-text);
  }

  .link-target-select {
    flex: 1;
    min-width: 0;
  }

  .add-link-confirm {
    padding: 0.3rem 0.625rem;
    background: var(--color-primary);
    color: white;
    border: none;
    border-radius: var(--radius-md);
    font-size: 0.8125rem;
    cursor: pointer;
  }

  .add-link-confirm:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .links-list {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .link-item {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.25rem 0.5rem;
    background: var(--color-bg);
    border-radius: var(--radius-sm);
    font-size: 0.8125rem;
  }

  .link-type-label {
    color: var(--color-text-secondary);
    font-weight: 500;
    font-size: 0.75rem;
    flex-shrink: 0;
  }

  .link-task-title {
    color: var(--color-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  .link-delete-btn {
    margin-left: auto;
    background: none;
    border: none;
    font-size: 1rem;
    color: var(--color-text-secondary);
    cursor: pointer;
    padding: 0 0.25rem;
    line-height: 1;
    flex-shrink: 0;
  }

  .link-delete-btn:hover {
    color: var(--color-error);
  }

  .comments-section {
    margin-top: 0.75rem;
    border-top: 1px solid var(--color-border-light);
    padding: 0.75rem 1.25rem 0;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .comments-header label {
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--color-text-secondary);
  }

  .comments-list {
    display: flex;
    flex-direction: column;
    gap: 0.625rem;
  }

  .comment {
    background: var(--color-bg);
    border-radius: var(--radius-md);
    padding: 0.625rem 0.75rem;
  }

  .comment-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.25rem;
  }

  .comment-time {
    font-size: 0.6875rem;
    color: var(--color-text-secondary);
  }

  .comment-sync-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .comment-sync-dot.pending {
    background: var(--color-warning);
  }

  .comment-sync-dot.error {
    background: var(--color-error);
  }

  .comment-delete-btn {
    margin-left: auto;
    background: none;
    border: none;
    font-size: 1rem;
    color: var(--color-text-secondary);
    cursor: pointer;
    padding: 0 0.25rem;
    line-height: 1;
  }

  .comment-delete-btn:hover {
    color: var(--color-error);
  }

  .comment-text {
    font-size: 0.8125rem;
    line-height: 1.5;
    color: var(--color-text);
    word-break: break-word;
  }

  .comment-form {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }

  .comment-submit-btn {
    align-self: flex-end;
    padding: 0.375rem 0.75rem;
    background: var(--color-primary);
    color: white;
    border: none;
    border-radius: var(--radius-md);
    font-size: 0.8125rem;
    font-weight: 500;
    cursor: pointer;
  }

  .comment-submit-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
