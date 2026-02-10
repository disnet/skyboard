<script lang="ts">
  import type { Op, Task } from "$lib/types.js";
  import { buildAtUri, TASK_COLLECTION } from "$lib/tid.js";
  import AuthorBadge from "./AuthorBadge.svelte";

  let {
    ops,
    tasks,
    onclose,
  }: {
    ops: Op[];
    tasks: Task[];
    onclose: () => void;
  } = $props();

  interface ActivityEntry {
    kind: "task-created" | "task-updated" | "op";
    did: string;
    timestamp: string;
    taskTitle: string;
    description: string;
    key: string;
  }

  // Build a lookup map from task AT URI to task title
  const taskTitleByUri = $derived.by(() => {
    const map = new Map<string, string>();
    for (const task of tasks) {
      const uri = buildAtUri(task.did, TASK_COLLECTION, task.rkey);
      map.set(uri, task.title);
    }
    return map;
  });

  function describeOp(op: Op): string {
    const parts: string[] = [];
    if (op.fields.title !== undefined)
      parts.push(`title to "${op.fields.title}"`);
    if (op.fields.description !== undefined) parts.push("description");
    if (op.fields.columnId !== undefined) parts.push("column");
    if (op.fields.order !== undefined) parts.push("order");
    return parts.length > 0 ? `Changed ${parts.join(", ")}` : "Unknown change";
  }

  // Build a combined activity feed from tasks + ops
  const activity = $derived.by(() => {
    const entries: ActivityEntry[] = [];

    // Task creation events
    for (const task of tasks) {
      entries.push({
        kind: "task-created",
        did: task.did,
        timestamp: task.createdAt,
        taskTitle: task.title,
        description: `Created task`,
        key: `task-created-${task.did}-${task.rkey}`,
      });

      // If the owner updated the task after creation, show that too
      if (task.updatedAt && task.updatedAt !== task.createdAt) {
        entries.push({
          kind: "task-updated",
          did: task.did,
          timestamp: task.updatedAt,
          taskTitle: task.title,
          description: "Updated task",
          key: `task-updated-${task.did}-${task.rkey}`,
        });
      }
    }

    // Op events (cross-user edits)
    for (const op of ops) {
      entries.push({
        kind: "op",
        did: op.did,
        timestamp: op.createdAt,
        taskTitle: taskTitleByUri.get(op.targetTaskUri) ?? "Unknown task",
        description: describeOp(op),
        key: `op-${op.did}-${op.rkey}`,
      });
    }

    // Sort newest-first
    entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    return entries;
  });

  function formatTime(iso: string): string {
    const date = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return "just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDay = Math.floor(diffHr / 24);
    if (diffDay < 7) return `${diffDay}d ago`;
    return date.toLocaleDateString();
  }
</script>

<div class="panel-backdrop" onclick={onclose} role="presentation">
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="panel" onclick={(e) => e.stopPropagation()} onkeydown={() => {}}>
    <div class="panel-header">
      <h3>Activity</h3>
      <button class="close-btn" onclick={onclose}>Close</button>
    </div>

    {#if activity.length === 0}
      <p class="empty">No activity yet.</p>
    {:else}
      <ul class="ops-list">
        {#each activity as entry (entry.key)}
          <li class="op-entry">
            <div class="op-author-row">
              <AuthorBadge did={entry.did} />
              <span class="op-time">{formatTime(entry.timestamp)}</span>
            </div>
            <div class="op-target">
              {entry.taskTitle}
            </div>
            <div class="op-desc">{entry.description}</div>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</div>

<style>
  .panel-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.3);
    z-index: 100;
    display: flex;
    justify-content: flex-end;
  }

  .panel {
    width: 360px;
    max-width: 90vw;
    height: 100%;
    background: var(--color-surface);
    box-shadow: var(--shadow-lg);
    overflow-y: auto;
    padding: 1rem;
  }

  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 1rem;
    padding-bottom: 0.75rem;
    border-bottom: 1px solid var(--color-border-light);
  }

  .panel-header h3 {
    margin: 0;
    font-size: 0.9375rem;
    font-weight: 600;
  }

  .close-btn {
    padding: 0.25rem 0.5rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-surface);
    color: var(--color-text-secondary);
    font-size: 0.75rem;
    cursor: pointer;
  }

  .empty {
    color: var(--color-text-secondary);
    font-size: 0.8125rem;
    text-align: center;
    padding: 2rem 0;
  }

  .ops-list {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .op-entry {
    padding: 0.625rem 0.75rem;
    margin-bottom: 0.5rem;
    background: var(--color-bg);
    border-radius: var(--radius-md);
  }

  .op-author-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    margin-bottom: 0.25rem;
  }

  .op-time {
    font-size: 0.625rem;
    color: var(--color-text-secondary);
    white-space: nowrap;
  }

  .op-target {
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--color-text);
    margin-bottom: 0.125rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .op-desc {
    font-size: 0.6875rem;
    color: var(--color-text-secondary);
  }
</style>
