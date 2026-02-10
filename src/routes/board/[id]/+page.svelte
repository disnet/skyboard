<script lang="ts">
  import { page } from "$app/stores";
  import { goto } from "$app/navigation";
  import { db } from "$lib/db.js";
  import { useLiveQuery } from "$lib/db.svelte.js";
  import type { Board } from "$lib/types.js";

  const rkey = $derived($page.params.id);

  const board = useLiveQuery<Board | undefined>(() => {
    if (!rkey) return undefined;
    return db.boards.where("rkey").equals(rkey).first();
  });

  // Redirect to the canonical /board/[did]/[rkey] URL
  $effect(() => {
    if (board.current) {
      goto(`/board/${board.current.did}/${board.current.rkey}`, {
        replaceState: true,
      });
    }
  });
</script>

<div class="loading-state">
  <div class="spinner"></div>
  <p>Loading board...</p>
</div>

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
</style>
