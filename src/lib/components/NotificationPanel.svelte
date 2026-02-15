<script lang="ts">
  import { db } from "$lib/db.js";
  import { useLiveQuery } from "$lib/db.svelte.js";
  import type { Notification, Board } from "$lib/types.js";
  import {
    markAsRead,
    markAllAsRead,
    clearNotification,
    clearAllNotifications,
  } from "$lib/notifications.js";
  import { timeAgo } from "$lib/time.js";
  import { buildAtUri, BOARD_COLLECTION } from "$lib/tid.js";
  import AuthorBadge from "./AuthorBadge.svelte";
  import { goto } from "$app/navigation";

  let { onclose }: { onclose: () => void } = $props();

  const notifications = useLiveQuery<Notification[]>(() =>
    db.notifications.orderBy("createdAt").reverse().limit(50).toArray(),
  );

  const boards = useLiveQuery<Board[]>(() => db.boards.toArray());

  const boardNameByUri = $derived.by(() => {
    const map = new Map<string, string>();
    for (const b of boards.current ?? []) {
      const uri = buildAtUri(b.did, BOARD_COLLECTION, b.rkey);
      map.set(uri, b.name);
    }
    return map;
  });

  const items = $derived(notifications.current ?? []);

  function descriptionForType(n: Notification): string {
    switch (n.type) {
      case "task_created":
        return "created a task";
      case "comment_added":
        return "commented";
      case "mention":
        return "mentioned you";
    }
  }

  function notificationPath(n: Notification): string {
    // boardUri format: at://did:plc:xxx/dev.skyboard.board/rkey
    const parts = n.boardUri.replace("at://", "").split("/");
    const did = parts[0];
    const boardRkey = parts[parts.length - 1];
    let path = `/board/${did}/${boardRkey}`;

    // taskUri format: at://did:plc:xxx/dev.skyboard.task/rkey
    if (n.taskUri) {
      const taskRkey = n.taskUri.split("/").pop();
      if (taskRkey) path += `#task-${taskRkey}`;
    }
    return path;
  }

  async function handleClick(n: Notification) {
    if (n.id && !n.read) {
      await markAsRead(n.id);
    }
    const path = notificationPath(n);
    const hashIndex = path.indexOf("#task-");
    const pathname = hashIndex >= 0 ? path.slice(0, hashIndex) : path;
    const taskRkey = hashIndex >= 0 ? path.slice(hashIndex + 6) : null;

    onclose();

    if (window.location.pathname === pathname && taskRkey) {
      // Already on this board — dispatch event so the board page opens the task directly
      window.dispatchEvent(
        new CustomEvent("skyboard:open-task", { detail: taskRkey }),
      );
    } else {
      goto(path);
    }
  }

  async function handleMarkAllRead() {
    await markAllAsRead();
  }
</script>

<div class="panel-backdrop" onclick={onclose} role="presentation">
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="panel" onclick={(e) => e.stopPropagation()} onkeydown={() => {}}>
    <div class="panel-header">
      <h3>Notifications</h3>
      <div class="header-actions">
        {#if items.some((n) => !n.read)}
          <button class="mark-read-btn" onclick={handleMarkAllRead}
            >Mark all read</button
          >
        {/if}
        {#if items.length > 0}
          <button class="clear-all-btn" onclick={clearAllNotifications}
            >Clear all</button
          >
        {/if}
        <button class="close-btn" onclick={onclose}>Close</button>
      </div>
    </div>

    {#if items.length === 0}
      <p class="empty">No notifications yet</p>
    {:else}
      <div class="notification-list">
        {#each items as n (n.id)}
          <div
            class="notification-item"
            class:unread={!n.read}
            class:mention={n.type === "mention"}
          >
            <button class="notification-body" onclick={() => handleClick(n)}>
              <div class="notification-row">
                {#if !n.read}
                  <span class="unread-dot"></span>
                {/if}
                <div class="notification-content">
                  <div class="notification-header">
                    <AuthorBadge did={n.actorDid} />
                    <span class="notification-action"
                      >{descriptionForType(n)}</span
                    >
                  </div>
                  {#if n.text}
                    <div class="notification-text">{n.text}</div>
                  {/if}
                  <div class="notification-meta">
                    {#if boardNameByUri.get(n.boardUri)}
                      <span class="notification-board"
                        >{boardNameByUri.get(n.boardUri)}</span
                      >
                    {/if}
                    <span class="notification-time">{timeAgo(n.createdAt)}</span
                    >
                  </div>
                </div>
              </div>
            </button>
            <button
              class="notification-clear-btn"
              title="Remove"
              onclick={() => n.id && clearNotification(n.id)}>&times;</button
            >
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .panel-backdrop {
    position: fixed;
    inset: 0;
    background: var(--color-overlay-light);
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

  .header-actions {
    display: flex;
    gap: 0.375rem;
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

  .mark-read-btn {
    padding: 0.25rem 0.5rem;
    border: 1px solid var(--color-primary);
    border-radius: var(--radius-sm);
    background: var(--color-surface);
    color: var(--color-primary);
    font-size: 0.75rem;
    cursor: pointer;
    font-weight: 500;
  }

  .mark-read-btn:hover {
    background: var(--color-primary);
    color: white;
  }

  .clear-all-btn {
    padding: 0.25rem 0.5rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-surface);
    color: var(--color-text-secondary);
    font-size: 0.75rem;
    cursor: pointer;
  }

  .clear-all-btn:hover {
    background: var(--color-error-bg, #fef2f2);
    color: var(--color-error);
    border-color: var(--color-error);
  }

  .empty {
    color: var(--color-text-secondary);
    font-size: 0.8125rem;
    text-align: center;
    padding: 2rem 0;
  }

  .notification-list {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .notification-item {
    display: flex;
    align-items: flex-start;
    background: var(--color-bg);
    border-radius: var(--radius-md);
    transition: background 0.15s;
    position: relative;
  }

  .notification-item:hover {
    background: var(--color-border-light);
  }

  .notification-body {
    flex: 1;
    min-width: 0;
    display: block;
    text-align: left;
    padding: 0.625rem;
    background: none;
    border: none;
    cursor: pointer;
    font-family: inherit;
  }

  .notification-clear-btn {
    background: none;
    border: none;
    color: var(--color-text-secondary);
    cursor: pointer;
    padding: 0.375rem 0.5rem;
    font-size: 1rem;
    line-height: 1;
    opacity: 0;
    transition:
      opacity 0.15s,
      color 0.15s;
    flex-shrink: 0;
  }

  .notification-item:hover .notification-clear-btn {
    opacity: 1;
  }

  .notification-clear-btn:hover {
    color: var(--color-error);
  }

  .notification-item.mention {
    border-left: 3px solid var(--color-primary);
    background: var(--color-primary-alpha, rgba(0, 102, 204, 0.04));
  }

  .notification-item.mention:hover {
    background: rgba(0, 102, 204, 0.08);
  }

  .notification-row {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
  }

  .unread-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--color-primary);
    flex-shrink: 0;
    margin-top: 0.25rem;
  }

  .notification-content {
    flex: 1;
    min-width: 0;
  }

  .notification-header {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    flex-wrap: wrap;
  }

  .notification-action {
    font-size: 0.75rem;
    color: var(--color-text-secondary);
  }

  .notification-text {
    font-size: 0.75rem;
    color: var(--color-text);
    margin-top: 0.25rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .notification-meta {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    margin-top: 0.25rem;
  }

  .notification-board {
    font-size: 0.625rem;
    color: var(--color-primary);
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .notification-time {
    font-size: 0.625rem;
    color: var(--color-text-secondary);
    white-space: nowrap;
  }
</style>
