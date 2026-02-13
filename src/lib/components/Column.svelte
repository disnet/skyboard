<script lang="ts">
  import { db } from "$lib/db.js";
  import { generateKeyBetween } from "fractional-indexing";
  import type { Column, Label, MaterializedTask } from "$lib/types.js";
  import { createOp } from "$lib/ops.js";
  import { getActionStatus } from "$lib/permissions.js";
  import type { PermissionStatus } from "$lib/permissions.js";
  import { TASK_COLLECTION, buildAtUri } from "$lib/tid.js";
  import {
    getDraggedCard,
    registerColumn,
    unregisterColumn,
  } from "$lib/drag-state.svelte.js";
  import TaskCard from "./TaskCard.svelte";

  let {
    column,
    tasks,
    boardUri,
    did,
    boardOwnerDid,
    boardOpen,
    ownerTrustedDids,
    approvedUris,
    commentCounts = new Map(),
    reactionsByTask = new Map(),
    boardLabels = [],
    onedit,
    onreact,
    readonly = false,
    selectedTaskIndex = null,
    editingTaskIndex = null,
    onsavetitle,
    onpastelines,
    onaddtask,
    onhover,
    ondiscarderrors,
  }: {
    column: Column;
    tasks: MaterializedTask[];
    boardUri: string;
    did: string;
    boardOwnerDid: string;
    boardOpen: boolean;
    ownerTrustedDids: Set<string>;
    approvedUris: Set<string>;
    commentCounts?: Map<string, number>;
    reactionsByTask?: Map<string, Map<string, { count: number; userReacted: boolean }>>;
    boardLabels?: Label[];
    onedit: (task: MaterializedTask) => void;
    onreact?: (taskUri: string, emoji: string) => void;
    readonly?: boolean;
    selectedTaskIndex?: number | null;
    editingTaskIndex?: number | null;
    onsavetitle?: (task: MaterializedTask, title: string) => void;
    onpastelines?: (task: MaterializedTask, lines: string[]) => void;
    onaddtask?: () => void;
    onhover?: (taskIndex: number) => void;
    ondiscarderrors?: (task: MaterializedTask) => void;
  } = $props();

  const createStatus: PermissionStatus = $derived(
    getActionStatus(did, boardOwnerDid, ownerTrustedDids, boardOpen, "create_task"),
  );

  const moveStatus: PermissionStatus = $derived(
    getActionStatus(did, boardOwnerDid, ownerTrustedDids, boardOpen, "move"),
  );

  let dropIndex = $state<number | null>(null);
  let taskListEl: HTMLElement | undefined = $state();
  let columnEl: HTMLElement | undefined = $state();

  const sortedTasks = $derived(
    [...tasks].sort((a, b) => {
      if (a.effectivePosition < b.effectivePosition) return -1;
      if (a.effectivePosition > b.effectivePosition) return 1;
      return (a.rkey + a.did).localeCompare(b.rkey + b.did);
    }),
  );

  function handleDragOver(e: DragEvent) {
    if (readonly || moveStatus === "denied") return;
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = "move";
    }

    if (!taskListEl) {
      dropIndex = sortedTasks.length;
      return;
    }

    const dragged = getDraggedCard();
    const children = Array.from(
      taskListEl.querySelectorAll(":scope > .card-slot"),
    ) as HTMLElement[];
    let newDropIndex = children.length;

    for (let i = 0; i < children.length; i++) {
      const rect = children[i].getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      if (e.clientY < midY) {
        newDropIndex = i;
        break;
      }
    }

    // If dragging within the same column and hovering over the card's own position, no gap needed
    if (dragged) {
      const draggedIndex = sortedTasks.findIndex(
        (t) => t.sourceTask.id === dragged.id && t.ownerDid === dragged.did,
      );
      if (
        draggedIndex !== -1 &&
        (newDropIndex === draggedIndex || newDropIndex === draggedIndex + 1)
      ) {
        dropIndex = null;
        return;
      }
    }

    dropIndex = newDropIndex;
  }

  function isTaskPending(task: MaterializedTask): boolean {
    if (task.ownerDid === boardOwnerDid) return false;
    if (ownerTrustedDids.has(task.ownerDid)) return false;
    // On open boards, check if the task has been approved
    const taskUri = buildAtUri(task.ownerDid, TASK_COLLECTION, task.rkey);
    if (boardOpen && approvedUris.has(taskUri)) return false;
    return true;
  }

  function handleDragLeave(e: DragEvent) {
    if (readonly) return;
    const relatedTarget = e.relatedTarget as Node | null;
    const currentTarget = e.currentTarget as HTMLElement;
    if (relatedTarget && currentTarget.contains(relatedTarget)) return;
    dropIndex = null;
  }

  async function executeDrop(
    taskId: number,
    taskDid: string,
    currentDropIdx: number | null,
  ) {
    if (readonly) return;

    const filtered = sortedTasks.filter(
      (t) => !(t.sourceTask.id === taskId && t.ownerDid === taskDid),
    );
    let insertIdx = currentDropIdx ?? filtered.length;

    const draggedIndex = sortedTasks.findIndex(
      (t) => t.sourceTask.id === taskId && t.ownerDid === taskDid,
    );
    if (
      draggedIndex !== -1 &&
      currentDropIdx !== null &&
      currentDropIdx > draggedIndex
    ) {
      insertIdx = currentDropIdx - 1;
    }
    insertIdx = Math.max(0, Math.min(insertIdx, filtered.length));

    if (
      draggedIndex !== -1 &&
      (currentDropIdx === null || insertIdx === draggedIndex)
    )
      return;

    const before = filtered[insertIdx - 1]?.effectivePosition ?? null;
    const after = filtered[insertIdx]?.effectivePosition ?? null;
    const newPosition = generateKeyBetween(before, after);
    const task = await db.tasks.get(taskId);
    if (task) {
      await createOp(did, task, boardUri, {
        columnId: column.id,
        position: newPosition,
      });
    }
  }

  async function handleDrop(e: DragEvent) {
    if (readonly) return;
    e.preventDefault();
    const currentDropIdx = dropIndex;
    dropIndex = null;

    if (!e.dataTransfer) return;
    const raw = e.dataTransfer.getData("application/x-skyboard-task");
    if (!raw) return;

    let data: { id: number; did: string };
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }

    await executeDrop(data.id, data.did, currentDropIdx);
  }

  function handleTouchDragOver(index: number) {
    if (readonly || moveStatus === "denied") return;
    const dragged = getDraggedCard();
    if (dragged) {
      const draggedIndex = sortedTasks.findIndex(
        (t) => t.sourceTask.id === dragged.id && t.ownerDid === dragged.did,
      );
      if (
        draggedIndex !== -1 &&
        (index === draggedIndex || index === draggedIndex + 1)
      ) {
        dropIndex = null;
        return;
      }
    }
    dropIndex = index;
  }

  function handleTouchDrop(
    taskId: number,
    taskDid: string,
    touchDropIndex: number,
  ) {
    dropIndex = null;
    executeDrop(taskId, taskDid, touchDropIndex);
  }

  // Register column for touch drag coordination
  $effect(() => {
    if (columnEl) {
      registerColumn(column.id, {
        element: columnEl,
        onDrop: handleTouchDrop,
        setDropIndex: handleTouchDragOver,
        clearDropIndex: () => {
          dropIndex = null;
        },
      });
      return () => unregisterColumn(column.id);
    }
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="column"
  class:drag-over={dropIndex !== null}
  data-column-id={column.id}
  bind:this={columnEl}
  ondragover={handleDragOver}
  ondragleave={handleDragLeave}
  ondrop={handleDrop}
>
  <div class="column-header">
    <h3>{column.name}</h3>
    <span class="task-count">{tasks.length}</span>
  </div>

  <div class="task-list" bind:this={taskListEl}>
    {#each sortedTasks as task, i (task.rkey + task.did)}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="card-slot" class:drop-above={dropIndex === i} onmouseenter={() => onhover?.(i)}>
        <TaskCard
          {task}
          currentUserDid={did}
          pending={isTaskPending(task)}
          commentCount={commentCounts.get(
            `at://${task.ownerDid}/dev.skyboard.task/${task.rkey}`,
          ) ?? 0}
          reactions={reactionsByTask.get(
            `at://${task.ownerDid}/dev.skyboard.task/${task.rkey}`,
          )}
          {onreact}
          taskUri={`at://${task.ownerDid}/dev.skyboard.task/${task.rkey}`}
          {boardLabels}
          {onedit}
          {readonly}
          selected={selectedTaskIndex === i}
          editing={editingTaskIndex === i}
          {onsavetitle}
          {onpastelines}
          {ondiscarderrors}
        />
      </div>
    {/each}
    {#if dropIndex !== null && dropIndex >= sortedTasks.length}
      <div class="drop-indicator-end"></div>
    {/if}
  </div>

  {#if !readonly}
    {#if createStatus !== "denied"}
      <button class="add-task-btn" onclick={() => onaddtask?.()}>
        + {createStatus === "pending" ? "Add a task (pending approval)" : "Add a task"}
      </button>
    {:else}
      <div class="permission-notice denied">
        <span>Trusted users only</span>
      </div>
    {/if}
  {/if}
</div>

<style>
  .column {
    background: var(--color-column-bg);
    border-radius: var(--radius-lg);
    padding: 0.75rem;
    min-width: 280px;
    max-width: 340px;
    width: 100%;
    display: flex;
    flex-direction: column;
    max-height: calc(100vh - 140px);
    transition: background 0.15s;
  }

  .column.drag-over {
    background: var(--color-drag-over);
  }

  .column-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 0.25rem 0.625rem;
  }

  .column-header h3 {
    margin: 0;
    font-size: 0.8125rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--color-text-secondary);
  }

  .task-count {
    font-size: 0.75rem;
    color: var(--color-text-secondary);
    background: var(--color-surface);
    padding: 0.0625rem 0.375rem;
    border-radius: var(--radius-sm);
    font-weight: 500;
  }

  .task-list {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    min-height: 40px;
    padding: 4px;
    margin: -4px;
  }

  .card-slot {
    transition: margin-top 0.15s ease;
  }

  .card-slot.drop-above {
    margin-top: 3rem;
    position: relative;
  }

  .card-slot.drop-above::before {
    content: "";
    position: absolute;
    top: -1.625rem;
    left: 0.5rem;
    right: 0.5rem;
    height: 2px;
    background: var(--color-primary);
    border-radius: 1px;
  }

  .drop-indicator-end {
    height: 2px;
    margin: 0.5rem 0.5rem 0;
    background: var(--color-primary);
    border-radius: 1px;
  }

  .add-task-btn {
    width: 100%;
    margin-top: 0.5rem;
    padding: 0.4375rem 0.625rem;
    border: none;
    border-radius: var(--radius-md);
    font-size: 0.8125rem;
    background: transparent;
    color: var(--color-text-secondary);
    cursor: pointer;
    text-align: left;
    transition: background 0.15s, color 0.15s;
  }

  .add-task-btn:hover {
    background: var(--color-surface);
    color: var(--color-text);
  }

  .permission-notice {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    margin-top: 0.5rem;
    padding: 0.375rem 0.625rem;
    border-radius: var(--radius-md);
    font-size: 0.75rem;
  }

  .permission-notice.denied {
    color: var(--color-text-secondary);
    font-style: italic;
    justify-content: center;
  }
</style>
