<script lang="ts">
  import { page } from "$app/stores";
  import { onDestroy } from "svelte";
  import { db } from "$lib/db.js";
  import { useLiveQuery } from "$lib/db.svelte.js";
  import { getAuth } from "$lib/auth.svelte.js";
  import {
    buildAtUri,
    generateTID,
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
    FilterView,
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
  import FilterPanel from "$lib/components/FilterPanel.svelte";
  import QuickLabelPicker from "$lib/components/QuickLabelPicker.svelte";
  import QuickMovePicker from "$lib/components/QuickMovePicker.svelte";
  import { goto, replaceState } from "$app/navigation";
  import { logout } from "$lib/auth.svelte.js";
  import { getProfile } from "$lib/profile-cache.svelte.js";
  import { generateNotificationFromEvent } from "$lib/notifications.js";
  import { toggleReaction } from "$lib/reactions.js";
  import { createOp } from "$lib/ops.js";
  import { generateKeyBetween } from "fractional-indexing";

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

  // Detect if reactions are failing to sync (likely a scope/auth issue requiring re-login)
  const hasReactionSyncErrors = $derived(
    (allReactions.current ?? []).some((r) => r.syncStatus === "error"),
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
        // Apply title filter
        if (filterTitle && !task.effectiveTitle.toLowerCase().includes(filterTitle.toLowerCase())) {
          continue;
        }
        // Apply label filter (OR logic: task must match at least one selected label, or have no labels if "__no_labels__" is selected)
        if (filterLabelIds.length > 0) {
          const matchesNoLabels = filterLabelIds.includes("__no_labels__") && task.effectiveLabelIds.length === 0;
          const matchesLabel = filterLabelIds.some((id) => id !== "__no_labels__" && task.effectiveLabelIds.includes(id));
          if (!matchesNoLabels && !matchesLabel) {
            continue;
          }
        }
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

  // Create a new empty card and start inline editing its title.
  // afterRow: insert after this row index. If undefined, insert at bottom.
  function addNewCard(colIdx: number, afterRow?: number) {
    if (!auth.did) return;
    const colTasks = sortedTasksByColumn[colIdx] ?? [];
    let before: string | null;
    let after: string | null;
    let insertRow: number;
    if (afterRow !== undefined && colTasks.length > 0) {
      before = colTasks[afterRow]?.effectivePosition ?? null;
      after = colTasks[afterRow + 1]?.effectivePosition ?? null;
      insertRow = afterRow + 1;
    } else {
      // Append at bottom
      before = colTasks.at(-1)?.effectivePosition ?? null;
      after = null;
      insertRow = colTasks.length;
    }
    const newPosition = generateKeyBetween(before, after);
    db.tasks.add({
      rkey: generateTID(),
      did: auth.did,
      title: "",
      columnId: sortedColumns[colIdx].id,
      boardUri,
      position: newPosition,
      createdAt: new Date().toISOString(),
      syncStatus: "pending",
    });
    setSelectedPos({ col: colIdx, row: insertRow });
    requestAnimationFrame(() => {
      inlineEditPos = { col: colIdx, row: insertRow };
    });
  }

  function handleBoardKeydown(e: KeyboardEvent) {
    // Skip when a modal is open
    if (editingTask || showSettings || showPermissions || showProposals || showOpsPanel || showFilterPanel || showViewDropdown || showQuickLabel || showQuickMove) return;

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
      case "k":
      case "K": {
        e.preventDefault();
        if (!pos) {
          setSelectedPos({ col: 0, row: 0 });
        } else if (e.shiftKey && auth.did) {
          const colTasks = sortedTasksByColumn[pos.col] ?? [];
          const task = colTasks[pos.row];
          if (task && pos.row > 0) {
            const before = colTasks[pos.row - 2]?.effectivePosition ?? null;
            const after = colTasks[pos.row - 1].effectivePosition;
            const newPos = generateKeyBetween(before, after);
            createOp(auth.did, task.sourceTask, boardUri, { position: newPos });
            setSelectedPos({ col: pos.col, row: pos.row - 1 });
          }
        } else {
          setSelectedPos({ col: pos.col, row: Math.max(0, pos.row - 1) });
        }
        break;
      }
      case "ArrowDown":
      case "j":
      case "J": {
        e.preventDefault();
        if (!pos) {
          setSelectedPos({ col: 0, row: 0 });
        } else if (e.shiftKey && auth.did) {
          const colTasks = sortedTasksByColumn[pos.col] ?? [];
          const task = colTasks[pos.row];
          if (task && pos.row < colTasks.length - 1) {
            const before = colTasks[pos.row + 1].effectivePosition;
            const after = colTasks[pos.row + 2]?.effectivePosition ?? null;
            const newPos = generateKeyBetween(before, after);
            createOp(auth.did, task.sourceTask, boardUri, { position: newPos });
            setSelectedPos({ col: pos.col, row: pos.row + 1 });
          }
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
      case "e": {
        if (!pos || !auth.did) break;
        e.preventDefault();
        inlineEditPos = { col: pos.col, row: pos.row };
        break;
      }
      case ",":
      case ".": {
        if (!pos || !auth.did) break;
        const task = sortedTasksByColumn[pos.col]?.[pos.row];
        if (!task) break;
        const destCol = e.key === "," ? pos.col - 1 : pos.col + 1;
        if (destCol < 0 || destCol >= numCols) break;
        e.preventDefault();
        const destTasks = sortedTasksByColumn[destCol] ?? [];
        const lastPos = destTasks.length > 0 ? destTasks[destTasks.length - 1].effectivePosition : null;
        const newPosition = generateKeyBetween(lastPos, null);
        createOp(auth.did, task.sourceTask, boardUri, {
          columnId: sortedColumns[destCol].id,
          position: newPosition,
        });
        const maxRow = Math.max(0, destTasks.length);
        setSelectedPos({ col: destCol, row: maxRow });
        break;
      }
      case "<":
      case ">":
      case "H":
      case "L": {
        if (!pos || !auth.did) break;
        const taskTop = sortedTasksByColumn[pos.col]?.[pos.row];
        if (!taskTop) break;
        const destColTop = e.key === "<" || e.key === "H" ? pos.col - 1 : pos.col + 1;
        if (destColTop < 0 || destColTop >= numCols) break;
        e.preventDefault();
        const destTasksTop = sortedTasksByColumn[destColTop] ?? [];
        const firstPos = destTasksTop.length > 0 ? destTasksTop[0].effectivePosition : null;
        const newPosTop = generateKeyBetween(null, firstPos);
        createOp(auth.did, taskTop.sourceTask, boardUri, {
          columnId: sortedColumns[destColTop].id,
          position: newPosTop,
        });
        setSelectedPos({ col: destColTop, row: 0 });
        break;
      }
      case "n": {
        if (!auth.did) break;
        e.preventDefault();
        const col = pos ? pos.col : 0;
        const afterRow = pos && (sortedTasksByColumn[col]?.length ?? 0) > 0 ? pos.row : undefined;
        addNewCard(col, afterRow);
        break;
      }
      case "m": {
        if (!pos || !auth.did) break;
        const moveTask = sortedTasksByColumn[pos.col]?.[pos.row];
        if (!moveTask) break;
        e.preventDefault();
        const moveCard = document.querySelector(".task-card.task-selected");
        quickMoveAnchorRect = moveCard?.getBoundingClientRect() ?? null;
        showQuickMove = true;
        break;
      }
      case "t": {
        if (!pos || !auth.did) break;
        const labelTask = sortedTasksByColumn[pos.col]?.[pos.row];
        if (!labelTask) break;
        e.preventDefault();
        const selectedCard = document.querySelector(".task-card.task-selected");
        quickLabelAnchorRect = selectedCard?.getBoundingClientRect() ?? null;
        showQuickLabel = true;
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
  let showFilterPanel = $state(false);
  let showQuickLabel = $state(false);
  let quickLabelAnchorRect = $state<DOMRect | null>(null);
  let showQuickMove = $state(false);
  let quickMoveAnchorRect = $state<DOMRect | null>(null);
  let showMoreMenu = $state(false);
  let filterTitle = $state("");
  let filterLabelIds = $state<string[]>([]);
  let editingTask = $state<MaterializedTask | null>(null);
  let inlineEditPos = $state<{ col: number; row: number } | null>(null);

  // --- Saved filter views ---
  let activeViewId = $state<number | null>(null);
  let viewName = $state("");
  let editingViewId = $state<number | null>(null);
  let showViewDropdown = $state(false);

  const savedViews = useLiveQuery<FilterView[]>(() => {
    if (!boardUri) return [];
    return db.filterViews.where("boardUri").equals(boardUri).toArray();
  });

  const activeViewName = $derived(() => {
    if (activeViewId === null) return "All";
    const view = (savedViews.current ?? []).find((v) => v.id === activeViewId);
    return view?.name ?? "All";
  });

  function selectView(view: FilterView) {
    activeViewId = view.id!;
    filterTitle = view.titleFilter;
    filterLabelIds = [...view.labelIds];
    showViewDropdown = false;
  }

  function selectAllView() {
    activeViewId = null;
    filterTitle = "";
    filterLabelIds = [];
    showViewDropdown = false;
  }

  function openNewView() {
    viewName = "";
    editingViewId = null;
    // Keep current filters so user can save them
    showViewDropdown = false;
    showFilterPanel = true;
  }

  function openEditView(view: FilterView) {
    viewName = view.name;
    editingViewId = view.id!;
    activeViewId = view.id!;
    filterTitle = view.titleFilter;
    filterLabelIds = [...view.labelIds];
    showViewDropdown = false;
    showFilterPanel = true;
  }

  async function handleSaveView() {
    if (!viewName.trim() || !boardUri) return;
    if (editingViewId) {
      await db.filterViews.update(editingViewId, {
        name: viewName.trim(),
        titleFilter: filterTitle,
        labelIds: [...filterLabelIds],
      });
      activeViewId = editingViewId;
    } else {
      const id = await db.filterViews.add({
        boardUri,
        name: viewName.trim(),
        titleFilter: filterTitle,
        labelIds: [...filterLabelIds],
      });
      activeViewId = id as number;
    }
    showFilterPanel = false;
  }

  async function handleDeleteView() {
    if (!editingViewId) return;
    await db.filterViews.delete(editingViewId);
    editingViewId = null;
    activeViewId = null;
    filterTitle = "";
    filterLabelIds = [];
    viewName = "";
    showFilterPanel = false;
  }

  function handleViewDropdownKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      showViewDropdown = false;
    }
  }

  function handleSaveTitle(task: MaterializedTask, title: string, andContinue = false) {
    const pos = inlineEditPos;
    if (!title && !task.effectiveTitle) {
      // Empty title on a new card — discard it
      db.tasks.delete(task.sourceTask.id);
      inlineEditPos = null;
      clearSelection();
      return;
    }
    if (auth.did && title !== task.effectiveTitle) {
      createOp(auth.did, task.sourceTask, boardUri, { title });
    }
    inlineEditPos = null;
    if (andContinue && pos) {
      addNewCard(pos.col, pos.row);
    }
  }

  function handlePasteLines(task: MaterializedTask, lines: string[]) {
    if (!auth.did || !inlineEditPos) return;
    // Cap paste to 100 lines to prevent mass record creation
    const cappedLines = lines.slice(0, 100);
    const colIdx = inlineEditPos.col;
    const colTasks = sortedTasksByColumn[colIdx] ?? [];
    const currentRow = inlineEditPos.row;

    const currentPos = colTasks[currentRow]?.effectivePosition ?? null;
    const afterPos = colTasks[currentRow + 1]?.effectivePosition ?? null;

    let prevPos = currentPos;
    for (const line of cappedLines) {
      const newPosition = generateKeyBetween(prevPos, afterPos);
      const rkey = generateTID();
      const taskData = {
        rkey,
        did: auth.did,
        title: "",
        columnId: sortedColumns[colIdx].id,
        boardUri,
        position: newPosition,
        createdAt: new Date().toISOString(),
        syncStatus: "pending" as const,
      };
      db.tasks.add(taskData).then(() => {
        createOp(auth.did!, taskData as Task, boardUri, { title: line });
      });
      prevPos = newPosition;
    }
  }

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

  function handleMoveTask(task: MaterializedTask, columnId: string) {
    if (!auth.did) return;
    const colIdx = sortedColumns.findIndex((c) => c.id === columnId);
    if (colIdx === -1) return;
    const targetTasks = sortedTasksByColumn[colIdx] ?? [];
    const firstPos =
      targetTasks.length > 0 ? targetTasks[0].effectivePosition : null;
    const newPosition = generateKeyBetween(null, firstPos);
    createOp(auth.did, task.sourceTask, boardUri, {
      columnId,
      position: newPosition,
    });
  }

  function handleReact(taskUri: string, emoji: string) {
    if (!auth.did || !boardUri) return;
    toggleReaction(auth.did, taskUri, boardUri, emoji);
  }

  const quickLabelTask = $derived.by(() => {
    if (!showQuickLabel) return null;
    const pos = getSelectedPos();
    if (!pos) return null;
    return sortedTasksByColumn[pos.col]?.[pos.row] ?? null;
  });

  const quickMoveTask = $derived.by(() => {
    if (!showQuickMove) return null;
    const pos = getSelectedPos();
    if (!pos) return null;
    return sortedTasksByColumn[pos.col]?.[pos.row] ?? null;
  });

  function handleQuickMove(columnId: string) {
    if (!quickMoveTask) return;
    handleMoveTask(quickMoveTask, columnId);
  }

  function handleQuickLabelToggle(labelId: string) {
    if (!auth.did || !quickLabelTask) return;
    const current = [...quickLabelTask.effectiveLabelIds];
    const idx = current.indexOf(labelId);
    if (idx >= 0) {
      current.splice(idx, 1);
    } else {
      current.push(labelId);
    }
    createOp(auth.did, quickLabelTask.sourceTask, boardUri, { labelIds: current });
  }

  // Auto-scroll columns-container during HTML5 drag
  const DRAG_SCROLL_EDGE = 80;
  const DRAG_SCROLL_MAX_SPEED = 20;
  let dragScrollRAF: number | null = null;
  let dragClientX = 0;
  let columnsContainerEl: HTMLElement | undefined = $state();

  function handleContainerDragOver(e: DragEvent) {
    dragClientX = e.clientX;
    if (!dragScrollRAF) {
      dragScrollRAF = requestAnimationFrame(dragAutoScroll);
    }
  }

  function handleContainerDragLeave(e: DragEvent) {
    const related = e.relatedTarget as Node | null;
    const current = e.currentTarget as HTMLElement;
    if (related && current.contains(related)) return;
    stopDragAutoScroll();
  }

  function handleContainerDrop() {
    stopDragAutoScroll();
  }

  function dragAutoScroll() {
    if (!columnsContainerEl) {
      dragScrollRAF = null;
      return;
    }
    const rect = columnsContainerEl.getBoundingClientRect();
    let speed = 0;
    if (dragClientX < rect.left + DRAG_SCROLL_EDGE) {
      const ratio = 1 - (dragClientX - rect.left) / DRAG_SCROLL_EDGE;
      speed = -DRAG_SCROLL_MAX_SPEED * Math.max(0, Math.min(1, ratio));
    } else if (dragClientX > rect.right - DRAG_SCROLL_EDGE) {
      const ratio = 1 - (rect.right - dragClientX) / DRAG_SCROLL_EDGE;
      speed = DRAG_SCROLL_MAX_SPEED * Math.max(0, Math.min(1, ratio));
    }
    if (speed !== 0) {
      columnsContainerEl.scrollLeft += speed;
    }
    dragScrollRAF = requestAnimationFrame(dragAutoScroll);
  }

  function stopDragAutoScroll() {
    if (dragScrollRAF) {
      cancelAnimationFrame(dragScrollRAF);
      dragScrollRAF = null;
    }
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
        {#if auth.isLoggedIn}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="view-dropdown-wrapper" onkeydown={handleViewDropdownKeydown}>
            <button class="view-dropdown-btn" onclick={() => (showViewDropdown = !showViewDropdown)}>
              {activeViewName()}
              <svg width="10" height="6" viewBox="0 0 10 6" fill="none" aria-hidden="true">
                <path d="M1 1L5 5L9 1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
            {#if showViewDropdown}
              <div class="view-dropdown-backdrop" onclick={() => (showViewDropdown = false)} role="presentation"></div>
              <div class="view-dropdown-menu">
                <button class="view-dropdown-item" class:active={activeViewId === null} onclick={selectAllView}>
                  All
                </button>
                {#each savedViews.current ?? [] as view (view.id)}
                  <div class="view-dropdown-item-row">
                    <button class="view-dropdown-item" class:active={activeViewId === view.id} onclick={() => selectView(view)}>
                      {view.name}
                    </button>
                    <button class="view-edit-btn" onclick={() => openEditView(view)} title="Edit view">
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                        <path d="M8.5 1.5L10.5 3.5M1 11L1.5 8.5L9.5 0.5L11.5 2.5L3.5 10.5L1 11Z" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>
                      </svg>
                    </button>
                  </div>
                {/each}
                <div class="view-dropdown-separator"></div>
                <button class="view-dropdown-item view-dropdown-new" onclick={openNewView}>
                  New view...
                </button>
              </div>
            {/if}
          </div>
        {/if}
      </div>
      <div class="board-header-right">
        {#if auth.isLoggedIn}
          <button class="activity-btn header-desktop" onclick={() => (showOpsPanel = true)}>
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
        <button class="share-btn header-desktop" onclick={shareBoardUri}>
          {shareCopied ? "Copied!" : "Share"}
        </button>
        {#if isBoardOwner}
          <button
            class="settings-btn header-desktop"
            onclick={() => (showPermissions = true)}
          >
            Access
            {#if (ownerTrusts.current ?? []).length > 0}
              <span class="access-badge">{(ownerTrusts.current ?? []).length}</span>
            {/if}
          </button>
          <button class="settings-btn header-desktop" onclick={() => (showSettings = true)}>
            Settings
          </button>
          <button class="delete-btn header-desktop" onclick={deleteBoard}>Delete</button>
        {/if}
        <div class="more-wrapper header-mobile">
          <button class="more-btn" onclick={() => (showMoreMenu = !showMoreMenu)}>
            &hellip;
          </button>
          {#if showMoreMenu}
            <div class="more-backdrop" onclick={() => (showMoreMenu = false)} role="presentation"></div>
            <div class="more-menu">
              {#if auth.isLoggedIn}
                <button class="more-item" onclick={() => { showMoreMenu = false; showOpsPanel = true; }}>
                  Activity
                </button>
              {/if}
              <button class="more-item" onclick={() => { showMoreMenu = false; shareBoardUri(); }}>
                {shareCopied ? "Copied!" : "Share"}
              </button>
              {#if isBoardOwner}
                <button class="more-item" onclick={() => { showMoreMenu = false; showPermissions = true; }}>
                  Access
                </button>
                <button class="more-item" onclick={() => { showMoreMenu = false; showSettings = true; }}>
                  Settings
                </button>
                <button class="more-item more-item-danger" onclick={() => { showMoreMenu = false; deleteBoard(); }}>
                  Delete
                </button>
              {/if}
            </div>
          {/if}
        </div>
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

    {#if hasReactionSyncErrors && auth.isLoggedIn}
      <div class="reauth-banner">
        Reaction sync failed. You may need to sign out and re-login to grant updated permissions.
        <button class="reauth-btn" onclick={async () => { await logout(); goto("/"); }}>
          Sign out
        </button>
      </div>
    {/if}

    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="columns-container"
      bind:this={columnsContainerEl}
      ondragover={handleContainerDragOver}
      ondragleave={handleContainerDragLeave}
      ondrop={handleContainerDrop}
    >
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
          editingTaskIndex={inlineEditPos?.col === colIdx ? inlineEditPos.row : null}
          onsavetitle={handleSaveTitle}
          onpastelines={handlePasteLines}
          onaddtask={() => addNewCard(colIdx)}
          onhover={(taskIndex) => setSelectedPos({ col: colIdx, row: taskIndex })}
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

  {#if showFilterPanel}
    <FilterPanel
      labels={board.current.labels ?? []}
      bind:titleFilter={filterTitle}
      bind:selectedLabelIds={filterLabelIds}
      bind:viewName={viewName}
      {editingViewId}
      onsave={handleSaveView}
      ondelete={editingViewId ? handleDeleteView : null}
      onclose={() => (showFilterPanel = false)}
    />
  {/if}

  {#if showQuickLabel && quickLabelTask && board.current && quickLabelAnchorRect}
    <QuickLabelPicker
      labels={board.current.labels ?? []}
      activeLabelIds={quickLabelTask.effectiveLabelIds}
      anchorRect={quickLabelAnchorRect}
      ontogglelabel={handleQuickLabelToggle}
      onclose={() => { showQuickLabel = false; quickLabelAnchorRect = null; }}
    />
  {/if}

  {#if showQuickMove && quickMoveTask && quickMoveAnchorRect}
    <QuickMovePicker
      columns={sortedColumns}
      currentColumnId={quickMoveTask.effectiveColumnId}
      anchorRect={quickMoveAnchorRect}
      onmove={handleQuickMove}
      onclose={() => { showQuickMove = false; quickMoveAnchorRect = null; }}
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
      columns={sortedColumns}
      {boardUri}
      onclose={closeTaskEditor}
      onreact={handleReact}
      onmove={handleMoveTask}
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
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .board-header-left {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
  }

  .back-link {
    font-size: 0.875rem;
    color: var(--color-text-secondary);
    flex-shrink: 0;
  }

  .separator {
    color: var(--color-border);
    flex-shrink: 0;
  }

  .board-header h2 {
    margin: 0;
    font-size: 1.125rem;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  @media (max-width: 600px) {
    .board-header {
      padding: 0.5rem 0.75rem;
    }

    .board-header h2 {
      font-size: 0.9375rem;
    }

    .back-link,
    .separator {
      display: none;
    }
  }

  .shared-badge,
  .readonly-badge,
  .open-badge {
    font-size: 0.6875rem;
    padding: 0.125rem 0.5rem;
    border-radius: var(--radius-sm);
    font-weight: 500;
    flex-shrink: 0;
    white-space: nowrap;
  }

  .shared-badge {
    background: var(--color-primary-alpha, rgba(0, 102, 204, 0.1));
    color: var(--color-primary);
  }

  .readonly-badge {
    background: var(--color-border-light);
    color: var(--color-text-secondary);
  }

  .open-badge {
    background: var(--color-success-alpha);
    color: rgb(22, 163, 74);
  }

  .view-dropdown-wrapper {
    position: relative;
    margin-left: 0.25rem;
  }

  .view-dropdown-btn {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.25rem 0.5rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-surface);
    color: var(--color-text-secondary);
    font-size: 0.8125rem;
    cursor: pointer;
    transition:
      background 0.15s,
      color 0.15s;
  }

  .view-dropdown-btn:hover {
    background: var(--color-bg);
    color: var(--color-text);
  }

  .view-dropdown-backdrop {
    position: fixed;
    inset: 0;
    z-index: 49;
  }

  .view-dropdown-menu {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    min-width: 180px;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-lg);
    z-index: 50;
    padding: 0.25rem 0;
  }

  .view-dropdown-item-row {
    display: flex;
    align-items: center;
  }

  .view-dropdown-item-row .view-dropdown-item {
    flex: 1;
  }

  .view-dropdown-item {
    display: block;
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

  .view-dropdown-item:hover {
    background: var(--color-bg);
  }

  .view-dropdown-item.active {
    font-weight: 600;
    color: var(--color-primary);
  }

  .view-dropdown-new {
    color: var(--color-text-secondary);
  }

  .view-edit-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: none;
    background: none;
    color: var(--color-text-secondary);
    cursor: pointer;
    border-radius: var(--radius-sm);
    flex-shrink: 0;
    margin-right: 0.25rem;
    transition:
      background 0.1s,
      color 0.1s;
  }

  .view-edit-btn:hover {
    background: var(--color-border-light);
    color: var(--color-text);
  }

  .view-dropdown-separator {
    height: 1px;
    background: var(--color-border-light);
    margin: 0.25rem 0;
  }

  .board-header-right {
    display: flex;
    gap: 0.375rem;
    flex-wrap: wrap;
    flex-shrink: 0;
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
    white-space: nowrap;
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
    white-space: nowrap;
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
    white-space: nowrap;
    transition: background 0.15s;
  }

  .proposals-btn:hover {
    background: var(--color-bg);
  }

  .header-mobile {
    display: none;
  }

  .more-wrapper {
    position: relative;
  }

  .more-btn {
    padding: 0.375rem 0.625rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    font-size: 1rem;
    font-weight: 700;
    letter-spacing: 1px;
    cursor: pointer;
    background: var(--color-surface);
    color: var(--color-text-secondary);
    line-height: 1;
    transition:
      background 0.15s,
      color 0.15s;
  }

  .more-btn:hover {
    background: var(--color-bg);
    color: var(--color-text);
  }

  .more-backdrop {
    position: fixed;
    inset: 0;
    z-index: 49;
  }

  .more-menu {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    min-width: 160px;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-lg);
    z-index: 50;
    padding: 0.25rem 0;
  }

  .more-item {
    display: block;
    width: 100%;
    padding: 0.5rem 0.75rem;
    border: none;
    background: none;
    color: var(--color-text);
    font-size: 0.8125rem;
    text-align: left;
    cursor: pointer;
    transition: background 0.1s;
  }

  .more-item:hover {
    background: var(--color-bg);
  }

  .more-item-danger {
    color: var(--color-error);
  }

  .more-item-danger:hover {
    background: var(--color-error-bg);
  }

  @media (max-width: 700px) {
    .header-desktop {
      display: none;
    }

    .header-mobile {
      display: block;
    }

    .proposals-btn {
      padding: 0.3125rem 0.5rem;
      font-size: 0.75rem;
    }
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
    background: var(--color-warning-alpha);
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
    overscroll-behavior-y: none;
    align-items: flex-start;
  }

  @media (max-width: 600px) {
    .columns-container {
      padding: 0.5rem;
      gap: 0.5rem;
    }
  }
</style>
