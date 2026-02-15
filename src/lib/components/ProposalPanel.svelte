<script lang="ts">
  import type { Task, Comment } from "$lib/types.js";
  import { grantTrust } from "$lib/trust.js";
  import { createApproval } from "$lib/approvals.js";
  import { blockUser } from "$lib/block.js";
  import { getAuth } from "$lib/auth.svelte.js";
  import { TASK_COLLECTION, COMMENT_COLLECTION, buildAtUri } from "$lib/tid.js";
  import AuthorBadge from "./AuthorBadge.svelte";

  let {
    untrustedTasks,
    untrustedComments = [],
    allTasks = [],
    boardUri,
    onclose,
  }: {
    untrustedTasks: Task[];
    untrustedComments?: Comment[];
    allTasks?: Task[];
    boardUri: string;
    onclose: () => void;
  } = $props();

  const taskTitleByUri = $derived.by(() => {
    const map = new Map<string, string>();
    for (const t of allTasks) {
      const uri = buildAtUri(t.did, TASK_COLLECTION, t.rkey);
      map.set(uri, t.title);
    }
    return map;
  });

  const auth = getAuth();

  type ProposalItem =
    | { kind: "task"; task: Task; did: string }
    | { kind: "comment"; comment: Comment; did: string };

  const proposals = $derived.by(() => {
    const items: ProposalItem[] = [];
    for (const task of untrustedTasks) {
      items.push({ kind: "task", task, did: task.did });
    }
    for (const comment of untrustedComments) {
      items.push({ kind: "comment", comment, did: comment.did });
    }
    return items;
  });

  async function trustUser(trustedDid: string) {
    if (!auth.did) return;
    await grantTrust(auth.did, trustedDid, boardUri);
  }

  async function acceptTask(task: Task) {
    if (!auth.did) return;
    const taskUri = buildAtUri(task.did, TASK_COLLECTION, task.rkey);
    await createApproval(auth.did, taskUri, boardUri);
  }

  async function acceptComment(comment: Comment) {
    if (!auth.did) return;
    const commentUri = buildAtUri(
      comment.did,
      COMMENT_COLLECTION,
      comment.rkey,
    );
    await createApproval(auth.did, commentUri, boardUri);
  }

  async function block(blockedDid: string) {
    if (!auth.did) return;
    await blockUser(auth.did, blockedDid, boardUri);
  }
</script>

<div class="panel-backdrop" onclick={onclose} role="presentation">
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="panel" onclick={(e) => e.stopPropagation()} onkeydown={() => {}}>
    <div class="panel-header">
      <h3>Proposals</h3>
      <button class="close-btn" onclick={onclose}>Close</button>
    </div>

    {#if proposals.length === 0}
      <p class="empty">No pending proposals.</p>
    {:else}
      {#each proposals as item}
        <div class="proposal-card">
          <div class="proposal-header">
            <AuthorBadge did={item.did} />
            <div class="proposal-actions">
              <button
                class="action-btn block-btn"
                onclick={() => block(item.did)}
              >
                Block User
              </button>
              <button
                class="action-btn trust-btn"
                onclick={() => trustUser(item.did)}
              >
                Trust User
              </button>
              {#if item.kind === "task"}
                <button
                  class="action-btn accept-btn"
                  onclick={() => acceptTask(item.task)}
                >
                  Accept
                </button>
              {:else}
                <button
                  class="action-btn accept-btn"
                  onclick={() => acceptComment(item.comment)}
                >
                  Accept
                </button>
              {/if}
            </div>
          </div>
          {#if item.kind === "task"}
            <div class="proposal-body">
              <span class="proposal-label">Task</span>
              <span class="proposal-title">{item.task.title}</span>
            </div>
          {:else}
            <div class="proposal-body">
              <div class="comment-context">
                on <strong
                  >{taskTitleByUri.get(item.comment.targetTaskUri) ??
                    "unknown card"}</strong
                >
              </div>
              <div class="comment-box">{item.comment.text}</div>
            </div>
          {/if}
        </div>
      {/each}
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

  .proposal-card {
    margin-bottom: 0.625rem;
    padding: 0.625rem;
    background: var(--color-bg);
    border-radius: var(--radius-md);
  }

  .proposal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }

  .proposal-actions {
    display: flex;
    gap: 0.375rem;
  }

  .action-btn {
    padding: 0.25rem 0.625rem;
    border-radius: var(--radius-sm);
    font-size: 0.6875rem;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
  }

  .block-btn {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    color: var(--color-text-secondary);
  }

  .block-btn:hover {
    background: var(--color-danger, #dc3545);
    color: white;
    border-color: var(--color-danger, #dc3545);
  }

  .trust-btn {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    color: var(--color-text-secondary);
  }

  .trust-btn:hover {
    background: var(--color-primary);
    color: white;
    border-color: var(--color-primary);
  }

  .accept-btn {
    background: var(--color-primary);
    color: white;
    border: 1px solid var(--color-primary);
  }

  .accept-btn:hover {
    background: var(--color-primary-hover);
    border-color: var(--color-primary-hover);
  }

  .proposal-body {
    font-size: 0.75rem;
  }

  .proposal-label {
    font-size: 0.6875rem;
    font-weight: 600;
    color: var(--color-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.03em;
    margin-right: 0.375rem;
  }

  .proposal-title {
    color: var(--color-text);
  }

  .comment-context {
    font-size: 0.6875rem;
    color: var(--color-text-secondary);
    margin-bottom: 0.375rem;
  }

  .comment-box {
    background: var(--color-surface);
    border: 1px solid var(--color-border-light);
    border-radius: var(--radius-sm);
    padding: 0.5rem;
    color: var(--color-text);
    font-size: 0.75rem;
    line-height: 1.4;
    white-space: pre-wrap;
    word-break: break-word;
  }
</style>
