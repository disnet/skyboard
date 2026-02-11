<script lang="ts">
  import { page } from "$app/stores";
  import { onDestroy } from "svelte";
  import { db } from "$lib/db.js";
  import { useLiveQuery } from "$lib/db.svelte.js";
  import { getAuth } from "$lib/auth.svelte.js";
  import {
    buildAtUri,
    BOARD_COLLECTION,
    TASK_COLLECTION,
    OP_COLLECTION,
    TRUST_COLLECTION,
    COMMENT_COLLECTION,
    APPROVAL_COLLECTION,
    REACTION_COLLECTION,
  } from "$lib/tid.js";
  import { materializeTasks } from "$lib/materialize.js";
  import { isTrusted, isContentVisible } from "$lib/permissions.js";
  import {
    JetstreamClient,
    loadJetstreamCursor,
    processJetstreamEvent,
  } from "$lib/jetstream.js";
  import {
    fetchRemoteBoard,
    fetchRemoteTasks,
    fetchRemoteOps,
    fetchRemoteTrusts,
    fetchRemoteComments,
    fetchRemoteApprovals,
    fetchRemoteReactions,
    seedParticipantsFromTrusts,
    fetchAllKnownParticipants,
    addKnownParticipant,
  } from "$lib/remote-sync.js";
  import type {
    Board,
    Task,
    Op,
    Trust,
    Comment,
    Approval,
    Reaction,
    Block,
    MaterializedTask,
  } from "$lib/types.js";
  import Column from "$lib/components/Column.svelte";
  import {
    getSelectedPos,
    setSelectedPos,
    clearSelection,
  } from "$lib/board-nav.svelte.js";
  import BoardSettingsModal from "$lib/components/BoardSettingsModal.svelte";
  import PermissionsModal from "$lib/components/PermissionsModal.svelte";
  import ProposalPanel from "$lib/components/ProposalPanel.svelte";
  import OpsPanel from "$lib/components/OpsPanel.svelte";
  import TaskEditModal from "$lib/components/TaskEditModal.svelte";
  import { goto, replaceState } from "$app/navigation";
  import { logout } from "$lib/auth.svelte.js";
  import { getProfile } from "$lib/profile-cache.svelte.js";
  import { generateNotificationFromEvent } from "$lib/notifications.js";
  import { toggleReaction } from "$lib/reactions.js";

  const auth = getAuth();

  const ownerDid = $derived($page.params.did ?? "");
  const rkey = $derived($page.params.rkey ?? "");
  const boardUri = $derived(
    ownerDid && rkey ? buildAtUri(ownerDid, BOARD_COLLECTION, rkey) : "",
  );

  let loading = $state(true);
  let error = $state<string | null>(null);

  // Fetch board data from PDS on load (for share links / first visit)
  $effect(() => {
    if (!ownerDid || !rkey) return;

    loading = true;
    error = null;

    (async () => {
      try {
        // Fetch the board record
        const boardData = await fetchRemoteBoard(
          ownerDid,
          BOARD_COLLECTION,
          rkey,
        );
        if (!boardData) {
          error = "Board not found";
          loading = false;
          return;
        }

        // Store board in Dexie
        const existing = await db.boards.where("rkey").equals(rkey).first();
        if (existing?.id) {
          await db.boards.update(existing.id, {
            name: boardData.name,
            description: boardData.description,
            columns: boardData.columns,
            labels: boardData.labels,
            open: boardData.open,
            createdAt: boardData.createdAt,
            syncStatus: boardData.syncStatus,
          });
        } else {
          await db.boards.add(boardData as Board);
        }

        // Fetch trusts, then seed participants from them
        await fetchRemoteTrusts(ownerDid, boardUri);
        await seedParticipantsFromTrusts(boardUri);

        // Fetch owner's tasks, ops, comments, approvals, and reactions
        await Promise.all([
          fetchRemoteTasks(ownerDid, boardUri),
          fetchRemoteOps(ownerDid, boardUri),
          fetchRemoteComments(ownerDid, boardUri),
          fetchRemoteApprovals(ownerDid, boardUri),
          fetchRemoteReactions(ownerDid, boardUri),
        ]);

        // Fetch all known participants' data
        await fetchAllKnownParticipants(boardUri);

        loading = false;
      } catch (err) {
        console.error("Failed to load board:", err);
        error = "Failed to load board";
        loading = false;
      }
    })();
  });

  // Reactive queries from Dexie
  const board = useLiveQuery<Board | undefined>(() => {
    if (!rkey) return undefined;
    return db.boards.where("rkey").equals(rkey).first();
  });

  const allTasks = useLiveQuery<Task[]>(() => {
    if (!boardUri) return [];
    return db.tasks.where("boardUri").equals(boardUri).toArray();
  });

  const allOps = useLiveQuery<Op[]>(() => {
    if (!boardUri) return [];
    return db.ops.where("boardUri").equals(boardUri).toArray();
  });

  const ownerTrusts = useLiveQuery<Trust[]>(() => {
    if (!boardUri || !ownerDid) return [];
    return db.trusts
      .where("did")
      .equals(ownerDid)
      .filter((t) => t.boardUri === boardUri)
      .toArray();
  });

  const allComments = useLiveQuery<Comment[]>(() => {
    if (!boardUri) return [];
    return db.comments.where("boardUri").equals(boardUri).toArray();
  });

  const allApprovals = useLiveQuery<Approval[]>(() => {
    if (!boardUri) return [];
    return db.approvals.where("boardUri").equals(boardUri).toArray();
  });

  const allReactions = useLiveQuery<Reaction[]>(() => {
    if (!boardUri) return [];
    return db.reactions.where("boardUri").equals(boardUri).toArray();
  });

  const allBlocks = useLiveQuery<Block[]>(() => {
    if (!boardUri || !auth.did) return [];
    return db.blocks
      .where("did")
      .equals(auth.did)
      .filter((b) => b.boardUri === boardUri)
      .toArray();
  });

  const blockedDids = $derived(
    new Set((allBlocks.current ?? []).map((b) => b.blockedDid)),
  );

  const ownerTrustedDids = $derived(
    new Set((ownerTrusts.current ?? []).map((t) => t.trustedDid)),
  );

  const boardOpen = $derived(board.current?.open ?? false);

  const approvedUris = $derived(
    new Set((allApprovals.current ?? []).map((a) => a.targetUri)),
  );

  const isBoardOwner = $derived(
    auth.isLoggedIn && board.current?.did === auth.did,
  );

  // Detect if approvals are failing to sync (likely a scope/auth issue requiring re-login)
  const hasApprovalSyncErrors = $derived(
    (allApprovals.current ?? []).some((a) => a.syncStatus === "error"),
  );

  // Comment counts grouped by targetTaskUri — only count visible comments
  const commentCountsByTask = $derived.by(() => {
    const map = new Map<string, number>();
    if (!board.current) return map;
    for (const comment of allComments.current ?? []) {
      const commentUri = buildAtUri(comment.did, COMMENT_COLLECTION, comment.rkey);
      if (
        isContentVisible(
          comment.did,
          auth.did ?? "",
          board.current.did,
          ownerTrustedDids,
          boardOpen,
          approvedUris,
          commentUri,
        )
      ) {
        map.set(
          comment.targetTaskUri,
          (map.get(comment.targetTaskUri) ?? 0) + 1,
        );
      }
    }
    return map;
  });

  // Reactions grouped by task → emoji → {count, userReacted}
  const reactionsByTask = $derived.by(() => {
    const map = new Map<string, Map<string, { count: number; userReacted: boolean }>>();
    for (const reaction of allReactions.current ?? []) {
      let emojiMap = map.get(reaction.targetTaskUri);
      if (!emojiMap) {
        emojiMap = new Map();
        map.set(reaction.targetTaskUri, emojiMap);
      }
      const existing = emojiMap.get(reaction.emoji);
      if (existing) {
        existing.count++;
        if (reaction.did === auth.did) existing.userReacted = true;
      } else {
        emojiMap.set(reaction.emoji, {
          count: 1,
          userReacted: reaction.did === auth.did,
        });
      }
    }
    return map;
  });

  // Materialized view with LWW merge
  const materializedTasks = $derived.by(() => {
    if (!allTasks.current || !allOps.current || !board.current) return [];
    return materializeTasks(
      allTasks.current,
      allOps.current,
      ownerTrustedDids,
      auth.did ?? "",
      board.current.did,
    );
  });

  // Untrusted tasks on open boards (not yet approved) — shown in Proposals panel
  const untrustedTasks = $derived.by(() => {
    if (!board.current || !isBoardOwner) return [];
    return (allTasks.current ?? []).filter((t) => {
      if (t.did === auth.did) return false;
      if (t.did === board.current!.did) return false;
      if (blockedDids.has(t.did)) return false;
      if (isTrusted(t.did, board.current!.did, ownerTrustedDids)) return false;
      const taskUri = buildAtUri(t.did, TASK_COLLECTION, t.rkey);
      return !approvedUris.has(taskUri);
    });
  });

  // Untrusted comments on open boards (not yet approved) — shown in Proposals panel
  const untrustedComments = $derived.by(() => {
    if (!board.current || !isBoardOwner) return [];
    return (allComments.current ?? []).filter((c) => {
      if (c.did === auth.did) return false;
      if (c.did === board.current!.did) return false;
      if (blockedDids.has(c.did)) return false;
      if (isTrusted(c.did, board.current!.did, ownerTrustedDids)) return false;
      const commentUri = buildAtUri(c.did, COMMENT_COLLECTION, c.rkey);
      return !approvedUris.has(commentUri);
    });
  });

  // Group materialized tasks by effective column — filter by visibility
  const tasksByColumn = $derived.by(() => {
    const map = new Map<string, MaterializedTask[]>();
    if (!board.current) return map;
    for (const col of board.current.columns) {
      map.set(col.id, []);
    }
    for (const task of materializedTasks) {
      const taskUri = buildAtUri(task.did, TASK_COLLECTION, task.rkey);
      if (
        isContentVisible(
          task.ownerDid,
          auth.did ?? "",
          board.current.did,
          ownerTrustedDids,
          boardOpen,
          approvedUris,
          taskUri,
        )
      ) {
        const list = map.get(task.effectiveColumnId);
        if (list) list.push(task);
      }
    }
    return map;
  });

  const sortedColumns = $derived(
    board.current
      ? [...board.current.columns].sort((a, b) => a.order - b.order)
      : [],
  );

  // Sorted tasks per column (same sort as Column.svelte uses)
  const sortedTasksByColumn = $derived.by(() => {
    const result: MaterializedTask[][] = [];
    for (const col of sortedColumns) {
      const tasks = tasksByColumn.get(col.id) ?? [];
      result.push(
        [...tasks].sort((a, b) => {
          if (a.effectivePosition < b.effectivePosition) return -1;
          if (a.effectivePosition > b.effectivePosition) return 1;
          return (a.rkey + a.did).localeCompare(b.rkey + b.did);
        }),
      );
    }
    return result;
  });

  // Clear selection when leaving the board
  onDestroy(() => clearSelection());

  function handleBoardKeydown(e: KeyboardEvent) {
    // Skip when a modal is open
    if (editingTask || showSettings || showPermissions || showProposals || showOpsPanel) return;

    // Skip when focus is inside an input, textarea, or contenteditable
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if ((e.target as HTMLElement)?.isContentEditable) return;

    const pos = getSelectedPos();
    const numCols = sortedColumns.length;
    if (numCols === 0) return;

    switch (e.key) {
      case "ArrowLeft":
      case "h": {
        e.preventDefault();
        if (!pos) {
          setSelectedPos({ col: 0, row: 0 });
        } else {
          const newCol = Math.max(0, pos.col - 1);
          const maxRow = Math.max(0, (sortedTasksByColumn[newCol]?.length ?? 1) - 1);
          setSelectedPos({ col: newCol, row: Math.min(pos.row, maxRow) });
        }
        break;
      }
      case "ArrowRight":
      case "l": {
        e.preventDefault();
        if (!pos) {
          setSelectedPos({ col: 0, row: 0 });
        } else {
          const newCol = Math.min(numCols - 1, pos.col + 1);
          const maxRow = Math.max(0, (sortedTasksByColumn[newCol]?.length ?? 1) - 1);
          setSelectedPos({ col: newCol, row: Math.min(pos.row, maxRow) });
        }
        break;
      }
      case "ArrowUp":
      case "k": {
        e.preventDefault();
        if (!pos) {
          setSelectedPos({ col: 0, row: 0 });
        } else {
          setSelectedPos({ col: pos.col, row: Math.max(0, pos.row - 1) });
        }
        break;
      }
      case "ArrowDown":
      case "j": {
        e.preventDefault();
        if (!pos) {
          setSelectedPos({ col: 0, row: 0 });
        } else {
          const maxRow = Math.max(0, (sortedTasksByColumn[pos.col]?.length ?? 1) - 1);
          setSelectedPos({ col: pos.col, row: Math.min(maxRow, pos.row + 1) });
        }
        break;
      }
      case "Enter": {
        if (!pos) return;
        const task = sortedTasksByColumn[pos.col]?.[pos.row];
        if (task) {
          e.preventDefault();
          openTaskEditor(task);
        }
        break;
      }
      case "Escape": {
        if (pos) {
          e.preventDefault();
          clearSelection();
        }
        break;
      }
    }
  }

  let showSettings = $state(false);
  let showPermissions = $state(false);
  let showProposals = $state(false);
  let showOpsPanel = $state(false);
  let editingTask = $state<MaterializedTask | null>(null);

  function openTaskEditor(task: MaterializedTask) {
    editingTask = task;
    replaceState(`${$page.url.pathname}#task-${task.rkey}`, $page.state);
  }

  function closeTaskEditor() {
    editingTask = null;
    replaceState($page.url.pathname, $page.state);
  }

  // Open task from URL hash on load, navigation, or when tasks become available.
  // Only depends on urlHash and materializedTasks — not editingTask — so that
  // closeTaskEditor (which nulls editingTask) doesn't re-trigger this effect
  // before replaceState has cleared the hash.
  const urlHash = $derived($page.url.hash);
  $effect(() => {
    if (!urlHash.startsWith("#task-")) return;
    const taskRkey = urlHash.slice(6);
    const task = materializedTasks.find((t) => t.rkey === taskRkey);
    if (task) {
      editingTask = task;
    }
  });

  // Listen for direct open-task events from the notification panel
  // (needed because goto with hash-only changes on the same page
  // doesn't reliably update $page.url in SvelteKit)
  $effect(() => {
    const tasks = materializedTasks;

    function handler(e: Event) {
      const rkey = (e as CustomEvent<string>).detail;
      const task = tasks.find((t) => t.rkey === rkey);
      if (task) {
        openTaskEditor(task);
      }
    }

    window.addEventListener("skyboard:open-task", handler);
    return () => window.removeEventListener("skyboard:open-task", handler);
  });

  // --- Jetstream lifecycle ---
  let jetstreamClient: JetstreamClient | null = null;

  $effect(() => {
    if (!boardUri) return;

    // Cold start: fetch from known participants
    fetchAllKnownParticipants(boardUri).catch(console.error);

    loadJetstreamCursor().then((cursor) => {
      if (!cursor) {
        fetchAllKnownParticipants(boardUri).catch(console.error);
      }

      jetstreamClient = new JetstreamClient({
        wantedCollections: [
          TASK_COLLECTION,
          OP_COLLECTION,
          TRUST_COLLECTION,
          COMMENT_COLLECTION,
          APPROVAL_COLLECTION,
          REACTION_COLLECTION,
        ],
        cursor,
        onEvent: async (event) => {
          if (event.did === auth.did) return;
          const result = await processJetstreamEvent(event);
          if (result) {
            addKnownParticipant(result.did, result.boardUri).catch(
              console.error,
            );
            // Generate notification for new tasks and comments
            if (event.commit.operation === "create" && auth.did) {
              const handle = getProfile(auth.did)?.data?.handle;
              generateNotificationFromEvent(event, auth.did, handle).catch(
                console.error,
              );
            }
          }
        },
        onConnect: () => {
          console.log("Jetstream connected");
        },
        onReconnect: () => {
          console.log("Jetstream reconnected, backfilling from PDS");
          fetchAllKnownParticipants(boardUri).catch(console.error);
        },
        onError: (err) => {
          console.warn("Jetstream error:", err);
        },
      });
      jetstreamClient.connect();
    });

    const handleBeforeUnload = () => {
      jetstreamClient?.disconnect();
    };
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      jetstreamClient?.disconnect();
      jetstreamClient = null;
    };
  });

  function handleReact(taskUri: string, emoji: string) {
    if (!auth.did || !boardUri) return;
    toggleReaction(auth.did, taskUri, boardUri, emoji);
  }

  let shareCopied = $state(false);
  async function shareBoardUri() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      shareCopied = true;
      setTimeout(() => (shareCopied = false), 2000);
    } catch {
      window.prompt("Copy this link to share:", window.location.href);
    }
  }

  async function deleteBoard() {
    if (!board.current?.id || !isBoardOwner) return;
    if (!confirm("Delete this board and all its tasks?")) return;

    const boardId = board.current.id;
    const uri = boardUri;

    await db.tasks.where("boardUri").equals(uri).delete();
    await db.ops.where("boardUri").equals(uri).delete();
    await db.comments.where("boardUri").equals(uri).delete();
    await db.approvals.where("boardUri").equals(uri).delete();
    await db.reactions.where("boardUri").equals(uri).delete();
    await db.boards.delete(boardId);

    goto("/");
  }
</script>

<svelte:window onkeydown={handleBoardKeydown} />

{#if loading && !board.current}
  <div class="loading-state">
    <div class="spinner"></div>
    <p>Loading board...</p>
  </div>
{:else if error && !board.current}
  <div class="error-state">
    <p>{error}</p>
    <a href="/">Go to Skyboard</a>
  </div>
{:else if board.current}
  <div class="board-page">
    <div class="board-header">
      <div class="board-header-left">
        <a href="/" class="back-link">Boards</a>
        <span class="separator">/</span>
        <h2>{board.current.name}</h2>
        {#if !auth.isLoggedIn}
          <span class="readonly-badge">Read-only</span>
        {:else if !isBoardOwner}
          <span class="shared-badge">Shared</span>
        {/if}
        {#if boardOpen}
          <span class="open-badge">Open</span>
        {/if}
      </div>
      <div class="board-header-right">
        {#if auth.isLoggedIn}
          <button class="activity-btn" onclick={() => (showOpsPanel = true)}>
            Activity
          </button>
          {#if isBoardOwner && (untrustedTasks.length > 0 || untrustedComments.length > 0)}
            <button
              class="proposals-btn"
              onclick={() => (showProposals = true)}
            >
              Proposals
              <span class="badge">
                {untrustedTasks.length + untrustedComments.length}
              </span>
            </button>
          {/if}
        {/if}
        <button class="share-btn" onclick={shareBoardUri}>
          {shareCopied ? "Copied!" : "Share"}
        </button>
        {#if isBoardOwner}
          <button
            class="settings-btn"
            onclick={() => (showPermissions = true)}
          >
            Access
            {#if (ownerTrusts.current ?? []).length > 0}
              <span class="access-badge">{(ownerTrusts.current ?? []).length}</span>
            {/if}
          </button>
          <button class="settings-btn" onclick={() => (showSettings = true)}>
            Settings
          </button>
          <button class="delete-btn" onclick={deleteBoard}>Delete</button>
        {/if}
      </div>
    </div>

    {#if !auth.isLoggedIn}
      <div class="readonly-banner">
        Viewing in read-only mode. <a href="/">Sign in</a> to collaborate.
      </div>
    {/if}

    {#if hasApprovalSyncErrors && isBoardOwner}
      <div class="reauth-banner">
        Approval sync failed. You may need to sign out and re-login to grant updated permissions.
        <button class="reauth-btn" onclick={async () => { await logout(); goto("/"); }}>
          Sign out
        </button>
      </div>
    {/if}

    <div class="columns-container">
      {#each sortedColumns as column, colIdx (column.id)}
        <Column
          {column}
          tasks={tasksByColumn.get(column.id) ?? []}
          {boardUri}
          did={auth.did ?? ""}
          boardOwnerDid={board.current.did}
          {boardOpen}
          {ownerTrustedDids}
          {approvedUris}
          commentCounts={commentCountsByTask}
          {reactionsByTask}
          boardLabels={board.current.labels ?? []}
          onedit={openTaskEditor}
          onreact={handleReact}
          readonly={!auth.isLoggedIn}
          selectedTaskIndex={getSelectedPos()?.col === colIdx ? getSelectedPos()?.row ?? null : null}
        />
      {/each}
    </div>
  </div>

  {#if showSettings && isBoardOwner}
    <BoardSettingsModal
      board={board.current}
      onclose={() => (showSettings = false)}
    />
  {/if}

  {#if showPermissions && isBoardOwner}
    <PermissionsModal
      board={board.current}
      trusts={ownerTrusts.current ?? []}
      {boardUri}
      onclose={() => (showPermissions = false)}
    />
  {/if}

  {#if showProposals && isBoardOwner}
    <ProposalPanel
      {untrustedTasks}
      {untrustedComments}
      allTasks={allTasks.current ?? []}
      {boardUri}
      onclose={() => (showProposals = false)}
    />
  {/if}


  {#if showOpsPanel}
    <OpsPanel
      ops={allOps.current ?? []}
      tasks={allTasks.current ?? []}
      onclose={() => (showOpsPanel = false)}
    />
  {/if}

  {#if editingTask}
    <TaskEditModal
      task={editingTask}
      currentUserDid={auth.did ?? ""}
      boardOwnerDid={board.current.did}
      {boardOpen}
      {ownerTrustedDids}
      {approvedUris}
      comments={allComments.current ?? []}
      reactions={reactionsByTask.get(
        `at://${editingTask.ownerDid}/dev.skyboard.task/${editingTask.rkey}`,
      )}
      boardLabels={board.current.labels ?? []}
      {boardUri}
      onclose={closeTaskEditor}
      onreact={handleReact}
      readonly={!auth.isLoggedIn}
    />
  {/if}
{:else}
  <div class="error-state">
    <p>Board not found.</p>
    <a href="/">Go to Skyboard</a>
  </div>
{/if}

<style>
  .loading-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: calc(100vh - 56px);
    color: var(--color-text-secondary);
  }

  .spinner {
    width: 32px;
    height: 32px;
    border: 3px solid var(--color-border);
    border-top-color: var(--color-primary);
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .error-state {
    text-align: center;
    padding: 3rem;
    color: var(--color-text-secondary);
  }

  .board-page {
    display: flex;
    flex-direction: column;
    height: calc(100vh - 56px);
  }

  .board-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 1.5rem;
    border-bottom: 1px solid var(--color-border-light);
    flex-shrink: 0;
  }

  .board-header-left {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .back-link {
    font-size: 0.875rem;
    color: var(--color-text-secondary);
  }

  .separator {
    color: var(--color-border);
  }

  .board-header h2 {
    margin: 0;
    font-size: 1.125rem;
    font-weight: 600;
  }

  .shared-badge {
    font-size: 0.6875rem;
    background: var(--color-primary-alpha, rgba(0, 102, 204, 0.1));
    color: var(--color-primary);
    padding: 0.125rem 0.5rem;
    border-radius: var(--radius-sm);
    font-weight: 500;
  }

  .readonly-badge {
    font-size: 0.6875rem;
    background: var(--color-border-light);
    color: var(--color-text-secondary);
    padding: 0.125rem 0.5rem;
    border-radius: var(--radius-sm);
    font-weight: 500;
  }

  .open-badge {
    font-size: 0.6875rem;
    background: rgba(34, 197, 94, 0.1);
    color: rgb(22, 163, 74);
    padding: 0.125rem 0.5rem;
    border-radius: var(--radius-sm);
    font-weight: 500;
  }

  .board-header-right {
    display: flex;
    gap: 0.5rem;
  }

  .settings-btn,
  .delete-btn,
  .share-btn {
    padding: 0.375rem 0.75rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    font-size: 0.8125rem;
    cursor: pointer;
    background: var(--color-surface);
    color: var(--color-text-secondary);
    display: flex;
    align-items: center;
    gap: 0.375rem;
    transition:
      background 0.15s,
      color 0.15s;
  }

  .settings-btn:hover,
  .share-btn:hover {
    background: var(--color-bg);
    color: var(--color-text);
  }

  .delete-btn:hover {
    background: var(--color-error-bg);
    color: var(--color-error);
    border-color: var(--color-error);
  }

  .activity-btn {
    padding: 0.375rem 0.75rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    font-size: 0.8125rem;
    cursor: pointer;
    background: var(--color-surface);
    color: var(--color-text-secondary);
    display: flex;
    align-items: center;
    gap: 0.375rem;
    transition:
      background 0.15s,
      color 0.15s;
  }

  .activity-btn:hover {
    background: var(--color-bg);
    color: var(--color-text);
  }

  .proposals-btn {
    padding: 0.375rem 0.75rem;
    border: 1px solid var(--color-warning);
    border-radius: var(--radius-md);
    font-size: 0.8125rem;
    cursor: pointer;
    background: var(--color-surface);
    color: var(--color-warning);
    font-weight: 500;
    display: flex;
    align-items: center;
    gap: 0.375rem;
    transition: background 0.15s;
  }

  .proposals-btn:hover {
    background: var(--color-bg);
  }

  .badge {
    font-size: 0.6875rem;
    background: var(--color-warning);
    color: white;
    padding: 0 0.375rem;
    border-radius: var(--radius-sm);
    font-weight: 600;
    min-width: 1rem;
    text-align: center;
  }

  .access-badge {
    font-size: 0.6875rem;
    background: var(--color-primary);
    color: white;
    padding: 0 0.375rem;
    border-radius: var(--radius-sm);
    font-weight: 600;
    min-width: 1rem;
    text-align: center;
  }

  .readonly-banner {
    padding: 0.5rem 1.5rem;
    font-size: 0.8125rem;
    color: var(--color-text-secondary);
    background: var(--color-column-bg);
    border-bottom: 1px solid var(--color-border-light);
    flex-shrink: 0;
  }

  .readonly-banner a {
    color: var(--color-primary);
    font-weight: 500;
  }

  .reauth-banner {
    padding: 0.5rem 1.5rem;
    font-size: 0.8125rem;
    color: var(--color-warning);
    background: rgba(245, 158, 11, 0.08);
    border-bottom: 1px solid var(--color-border-light);
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .reauth-btn {
    padding: 0.25rem 0.625rem;
    background: var(--color-warning);
    color: white;
    border: none;
    border-radius: var(--radius-sm);
    font-size: 0.75rem;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
  }

  .columns-container {
    flex: 1;
    display: flex;
    gap: 0.75rem;
    padding: 1rem 1.5rem;
    overflow-x: auto;
    align-items: flex-start;
  }
</style>
