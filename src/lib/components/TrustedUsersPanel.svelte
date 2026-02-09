<script lang="ts">
  import type { Trust } from "$lib/types.js";
  import { revokeTrust } from "$lib/trust.js";
  import { getAuth } from "$lib/auth.svelte.js";
  import AuthorBadge from "./AuthorBadge.svelte";

  let {
    trusts,
    boardUri,
    onclose,
  }: {
    trusts: Trust[];
    boardUri: string;
    onclose: () => void;
  } = $props();

  const auth = getAuth();

  async function handleRevoke(trust: Trust) {
    if (!auth.did) return;
    if (
      !confirm(`Revoke trust for this user? Their edits will become proposals.`)
    )
      return;
    await revokeTrust(auth.did, trust.trustedDid, boardUri);
  }
</script>

<div class="panel-backdrop" onclick={onclose} role="presentation">
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="panel" onclick={(e) => e.stopPropagation()} onkeydown={() => {}}>
    <div class="panel-header">
      <h3>Trusted Users</h3>
      <button class="close-btn" onclick={onclose}>Close</button>
    </div>

    {#if trusts.length === 0}
      <p class="empty">No trusted users.</p>
    {:else}
      {#each trusts as trust (trust.id)}
        <div class="trust-item">
          <AuthorBadge did={trust.trustedDid} />
          <button class="revoke-btn" onclick={() => handleRevoke(trust)}>
            Revoke
          </button>
        </div>
      {/each}
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

  .trust-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.625rem 0.75rem;
    background: var(--color-bg);
    border-radius: var(--radius-md);
    margin-bottom: 0.5rem;
  }

  .revoke-btn {
    padding: 0.25rem 0.625rem;
    background: var(--color-surface);
    color: var(--color-error);
    border: 1px solid var(--color-error);
    border-radius: var(--radius-sm);
    font-size: 0.6875rem;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
  }

  .revoke-btn:hover {
    background: var(--color-error-bg);
  }
</style>
