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
  } from "$lib/tid.js";
  import { materializeTasks } from "$lib/materialize.js";
  import { getBoardPermissions, hasPermission } from "$lib/permissions.js";
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
    MaterializedTask,
  } from "$lib/types.js";
  import Column from "$lib/components/Column.svelte";
  import BoardSettingsModal from "$lib/components/BoardSettingsModal.svelte";
  import PermissionsModal from "$lib/components/PermissionsModal.svelte";
  import ProposalPanel from "$lib/components/ProposalPanel.svelte";
  import OpsPanel from "$lib/components/OpsPanel.svelte";
  import TrustedUsersPanel from "$lib/components/TrustedUsersPanel.svelte";
  import TaskEditModal from "$lib/components/TaskEditModal.svelte";
  import { goto } from "$app/navigation";

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
            permissions: boardData.permissions,
            createdAt: boardData.createdAt,
            syncStatus: boardData.syncStatus,
          });
        } else {
          await db.boards.add(boardData as Board);
        }

        // Fetch trusts, then seed participants from them
        await fetchRemoteTrusts(ownerDid, boardUri);
        await seedParticipantsFromTrusts(boardUri);

        // Fetch owner's tasks, ops, and comments
        await Promise.all([
          fetchRemoteTasks(ownerDid, boardUri),
          fetchRemoteOps(ownerDid, boardUri),
          fetchRemoteComments(ownerDid, boardUri),
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

  const ownerTrustedDids = $derived(
    new Set((ownerTrusts.current ?? []).map((t) => t.trustedDid)),
  );

  const permissions = $derived(
    board.current
      ? getBoardPermissions(board.current)
      : getBoardPermissions({ permissions: undefined } as any),
  );

  const isBoardOwner = $derived(
    auth.isLoggedIn && board.current?.did === auth.did,
  );

  // Comment counts grouped by targetTaskUri — only count permitted comments
  const commentCountsByTask = $derived.by(() => {
    const map = new Map<string, number>();
    if (!board.current) return map;
    for (const comment of allComments.current ?? []) {
      if (
        comment.did === auth.did ||
        comment.did === board.current.did
      ) {
        map.set(
          comment.targetTaskUri,
          (map.get(comment.targetTaskUri) ?? 0) + 1,
        );
        continue;
      }
      if (
        hasPermission(
          comment.did,
          board.current.did,
          ownerTrustedDids,
          permissions,
          "comment",
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

  // Materialized view with LWW merge
  const materializedTasks = $derived.by(() => {
    if (!allTasks.current || !allOps.current || !board.current) return [];
    return materializeTasks(
      allTasks.current,
      allOps.current,
      ownerTrustedDids,
      auth.did ?? "",
      board.current.did,
      permissions,
    );
  });

  // Pending proposals from untrusted users (logged-in only)
  const pendingProposals = $derived(
    materializedTasks.flatMap((t) => t.pendingOps),
  );

  // Tasks that don't pass create_task permission (shown in Proposals panel)
  const untrustedTasks = $derived.by(() => {
    if (!board.current || !auth.isLoggedIn) return [];
    return (allTasks.current ?? []).filter((t) => {
      if (t.did === auth.did) return false;
      if (t.did === board.current!.did) return false;
      return !hasPermission(
        t.did,
        board.current!.did,
        ownerTrustedDids,
        permissions,
        "create_task",
        t.columnId,
      );
    });
  });

  // Comments from untrusted users (shown in Proposals panel)
  const untrustedComments = $derived.by(() => {
    if (!board.current || !auth.isLoggedIn) return [];
    return (allComments.current ?? []).filter((c) => {
      if (c.did === auth.did) return false;
      if (c.did === board.current!.did) return false;
      return !hasPermission(
        c.did,
        board.current!.did,
        ownerTrustedDids,
        permissions,
        "comment",
      );
    });
  });

  // Group materialized tasks by effective column
  const tasksByColumn = $derived.by(() => {
    const map = new Map<string, MaterializedTask[]>();
    if (!board.current) return map;
    for (const col of board.current.columns) {
      map.set(col.id, []);
    }
    for (const task of materializedTasks) {
      // Board owner and current user tasks always show
      if (
        task.ownerDid === board.current.did ||
        task.ownerDid === auth.did
      ) {
        const list = map.get(task.effectiveColumnId);
        if (list) list.push(task);
        continue;
      }
      // Check create_task permission for the task's original column
      if (
        hasPermission(
          task.ownerDid,
          board.current.did,
          ownerTrustedDids,
          permissions,
          "create_task",
          task.columnId,
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

  let showSettings = $state(false);
  let showPermissions = $state(false);
  let showProposals = $state(false);
  let showOpsPanel = $state(false);
  let showTrustedUsers = $state(false);
  let editingTask = $state<MaterializedTask | null>(null);

  function openTaskEditor(task: MaterializedTask) {
    editingTask = task;
    history.replaceState(null, "", `#task-${task.rkey}`);
  }

  function closeTaskEditor() {
    editingTask = null;
    history.replaceState(null, "", window.location.pathname);
  }

  // Open task from URL hash on load or when tasks become available
  $effect(() => {
    const hash = window.location.hash;
    if (!hash.startsWith("#task-") || editingTask) return;
    const taskRkey = hash.slice(6);
    const task = materializedTasks.find((t) => t.rkey === taskRkey);
    if (task) {
      editingTask = task;
    }
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
        ],
        cursor,
        onEvent: async (event) => {
          if (event.did === auth.did) return;
          const result = await processJetstreamEvent(event);
          if (result) {
            addKnownParticipant(result.did, result.boardUri).catch(
              console.error,
            );
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
    await db.boards.delete(boardId);

    goto("/");
  }
</script>

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
      </div>
      <div class="board-header-right">
        {#if auth.isLoggedIn}
          <button class="activity-btn" onclick={() => (showOpsPanel = true)}>
            Activity
          </button>
          {#if pendingProposals.length > 0 || untrustedTasks.length > 0 || untrustedComments.length > 0}
            <button
              class="proposals-btn"
              onclick={() => (showProposals = true)}
            >
              Proposals
              <span class="badge">
                {pendingProposals.length +
                  untrustedTasks.length +
                  untrustedComments.length}
              </span>
            </button>
          {/if}
        {/if}
        <button class="share-btn" onclick={shareBoardUri}>
          {shareCopied ? "Copied!" : "Share"}
        </button>
        {#if isBoardOwner}
          <button
            class="trusted-btn"
            onclick={() => (showTrustedUsers = true)}
          >
            Trusted
            {#if (ownerTrusts.current ?? []).length > 0}
              <span class="trusted-badge"
                >{(ownerTrusts.current ?? []).length}</span
              >
            {/if}
          </button>
          <button
            class="settings-btn"
            onclick={() => (showPermissions = true)}
          >
            Permissions
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

    <div class="columns-container">
      {#each sortedColumns as column (column.id)}
        <Column
          {column}
          tasks={tasksByColumn.get(column.id) ?? []}
          {boardUri}
          did={auth.did ?? ""}
          boardOwnerDid={board.current.did}
          {permissions}
          {ownerTrustedDids}
          commentCounts={commentCountsByTask}
          onedit={openTaskEditor}
          readonly={!auth.isLoggedIn}
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
      onclose={() => (showPermissions = false)}
    />
  {/if}

  {#if showProposals}
    <ProposalPanel
      proposals={pendingProposals}
      {untrustedTasks}
      {untrustedComments}
      {boardUri}
      onclose={() => (showProposals = false)}
    />
  {/if}

  {#if showTrustedUsers && isBoardOwner}
    <TrustedUsersPanel
      trusts={ownerTrusts.current ?? []}
      {boardUri}
      onclose={() => (showTrustedUsers = false)}
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
      {permissions}
      {ownerTrustedDids}
      comments={allComments.current ?? []}
      {boardUri}
      onclose={closeTaskEditor}
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

  .trusted-btn {
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

  .trusted-btn:hover {
    background: var(--color-bg);
    color: var(--color-text);
  }

  .trusted-badge {
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

  .columns-container {
    flex: 1;
    display: flex;
    gap: 0.75rem;
    padding: 1rem 1.5rem;
    overflow-x: auto;
    align-items: flex-start;
  }

</style>
