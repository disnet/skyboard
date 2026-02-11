<script lang="ts">
  import { untrack } from "svelte";
  import { db } from "$lib/db.js";
  import type { MaterializedTask, Comment, Label } from "$lib/types.js";
  import { createOp } from "$lib/ops.js";
  import { createComment, deleteComment } from "$lib/comments.js";
  import { getActionStatus, isContentVisible } from "$lib/permissions.js";
  import type { PermissionStatus } from "$lib/permissions.js";
  import { COMMENT_COLLECTION, buildAtUri, generateTID } from "$lib/tid.js";
  import AuthorBadge from "./AuthorBadge.svelte";
  import MentionText from "./MentionText.svelte";
  import MentionTextarea from "./MentionTextarea.svelte";
  import { EditorView, basicSetup } from "codemirror";
  import { EditorState } from "@codemirror/state";
  import { markdown } from "@codemirror/lang-markdown";
  import { languages } from "@codemirror/language-data";
  import { indentWithTab } from "@codemirror/commands";
  import { keymap, placeholder } from "@codemirror/view";
  import { autocompletion } from "@codemirror/autocomplete";
  import { mentionCompletionSource } from "$lib/mention-completions.js";
  import { markdownLivePreview } from "$lib/markdown-live-preview.js";
  import { Marked } from "marked";
  import { mentionExtension } from "$lib/mention-markdown.js";
  import DOMPurify from "dompurify";

  const markedInstance = new Marked(mentionExtension());

  let {
    task,
    currentUserDid,
    boardOwnerDid,
    boardOpen,
    ownerTrustedDids,
    approvedUris,
    comments = [],
    boardLabels = [],
    boardUri = "",
    onclose,
    readonly = false,
  }: {
    task: MaterializedTask;
    currentUserDid: string;
    boardOwnerDid: string;
    boardOpen: boolean;
    ownerTrustedDids: Set<string>;
    approvedUris: Set<string>;
    comments?: Comment[];
    boardLabels?: Label[];
    boardUri?: string;
    onclose: () => void;
    readonly?: boolean;
  } = $props();

  const renderedDescription = $derived(
    task.effectiveDescription
      ? DOMPurify.sanitize(
          markedInstance.parse(task.effectiveDescription) as string,
        )
      : "",
  );

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

    const newLabel: Label = { id: generateTID(), name: labelName, color: newLabelColor };
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

  let editorContainer: HTMLDivElement | undefined = $state();
  let editorView: EditorView | undefined;

  $effect(() => {
    if (!editorContainer) return;

    const initialDoc = untrack(() => editDescription);
    const state = EditorState.create({
      doc: initialDoc,
      extensions: [
        basicSetup,
        markdown({ codeLanguages: languages }),
        EditorView.lineWrapping,
        keymap.of([indentWithTab]),
        placeholder("Write a description using markdown..."),
        autocompletion({ override: [mentionCompletionSource] }),
        markdownLivePreview,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            editDescription = update.state.doc.toString();
          }
        }),
        EditorView.theme({
          "&": {
            fontSize: "0.875rem",
            maxHeight: "50vh",
          },
          ".cm-scroller": {
            overflow: "auto",
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

    return () => {
      editorView?.destroy();
      editorView = undefined;
    };
  });

  async function save() {
    const title = editTitle.trim();
    if (!title) return;

    const description = editDescription.trim() || undefined;

    const fields: Record<string, unknown> = {};
    if (title !== task.effectiveTitle) fields.title = title;
    if (description !== task.effectiveDescription)
      fields.description = description;
    const sortedEditLabelIds = [...editLabelIds].sort();
    const sortedEffectiveLabelIds = [...task.effectiveLabelIds].sort();
    if (JSON.stringify(sortedEditLabelIds) !== JSON.stringify(sortedEffectiveLabelIds))
      fields.labelIds = [...editLabelIds];
    if (Object.keys(fields).length > 0) {
      await createOp(currentUserDid, task.sourceTask, task.boardUri, fields);
    }
    onclose();
  }

  async function deleteTask() {
    if (!isOwned || !task.sourceTask.id) return;
    if (!confirm("Delete this task?")) return;
    await db.tasks.delete(task.sourceTask.id);
    onclose();
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) onclose();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      if (editorView?.hasFocus) {
        editorView.contentDOM.blur();
      } else {
        onclose();
      }
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
<div class="modal-backdrop" onclick={handleBackdropClick}>
  <div
    class="modal"
    role="dialog"
    aria-label={readonly ? "View Task" : "Edit Task"}
  >
    <div class="modal-header">
      {#if readonly}
        <span class="view-title">{task.effectiveTitle}</span>
      {:else}
        <input
          class="edit-title"
          type="text"
          bind:value={editTitle}
          placeholder="Task title"
          disabled={editStatus === "denied"}
        />
        {#if editStatus === "denied"}
          <span class="field-status denied">Trusted users only</span>
        {/if}
      {/if}
      <button class="close-btn" onclick={onclose}>&times;</button>
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
                <span
                  class="label-dot"
                  style="background: {lbl.color};"
                ></span>
                {lbl.name}
              </button>
            {/each}
            {#if isBoardOwner && editStatus !== "denied" && !showAddLabel}
              <button
                class="label-toggle add-new-label"
                onclick={() => (showAddLabel = true)}
              >+</button>
            {/if}
          </div>
          {#if showAddLabel && isBoardOwner}
            <div class="add-label-form">
              <span
                class="add-label-dot"
                style="background: {newLabelColor};"
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
                disabled={!newLabelName.trim()}
              >Add</button>
              <button
                class="add-label-cancel"
                onclick={() => { showAddLabel = false; newLabelName = ""; }}
              >&times;</button>
            </div>
          {/if}
        </div>

        <div class="field">
          <div class="field-header">
            <label>Description</label>
            {#if editStatus === "denied"}
              <span class="field-status denied">Trusted users only</span>
            {/if}
          </div>
          <div
            class="editor-wrapper"
            class:disabled={editStatus === "denied"}
            bind:this={editorContainer}
          ></div>
          <span
            class="char-count"
            class:over-limit={editDescription.length > 10240}
          >
            {editDescription.length.toLocaleString()} / 10,240
          </span>
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
              />
              {#if commentText.trim()}
                <button
                  class="comment-submit-btn"
                  type="submit"
                  disabled={submittingComment}
                >
                  Comment
                </button>
              {/if}
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
                    <span class="comment-time" title={new Date(comment.createdAt).toLocaleString()}
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
                  <div class="comment-text"><MentionText text={comment.text} /></div>
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
        {#if !readonly && !isOwned && editStatus === "allowed"}
          <span class="op-notice">Changes will be proposed</span>
        {:else if !readonly && !isOwned && editStatus === "denied"}
          <span class="op-notice denied">Trusted users only</span>
        {/if}
      </div>
      <div class="footer-right">
        {#if !readonly && isOwned}
          <button class="delete-btn" onclick={deleteTask}>Delete</button>
        {/if}
        <button class="cancel-btn" onclick={onclose}
          >{readonly ? "Close" : "Cancel"}</button
        >
        {#if !readonly && editStatus !== "denied"}
          <button
            class="save-btn"
            onclick={save}
            disabled={!editTitle.trim() || editDescription.length > 10240}
          >
            {isOwned ? "Save" : "Propose"}
          </button>
        {/if}
      </div>
    </div>
  </div>
</div>

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
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
    align-items: center;
    gap: 0.5rem;
    padding: 1rem 1.25rem;
    border-bottom: 1px solid var(--color-border-light);
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
    padding: 1.25rem;
    flex: 1;
    overflow-y: auto;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }

  .field label {
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--color-text-secondary);
  }

  .editor-wrapper {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    overflow: hidden;
    min-height: 150px;
    background: var(--color-bg);
  }

  .editor-wrapper:focus-within {
    border-color: var(--color-primary);
  }

  .char-count {
    font-size: 0.6875rem;
    color: var(--color-text-secondary);
    text-align: right;
  }

  .char-count.over-limit {
    color: var(--color-error);
    font-weight: 500;
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

  .save-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
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
  }

  .labels-section {
    margin-top: 1rem;
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

  .comments-section {
    margin-top: 1.25rem;
    border-top: 1px solid var(--color-border-light);
    padding-top: 1rem;
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
    white-space: pre-wrap;
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
