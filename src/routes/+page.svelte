<script lang="ts">
  import { goto } from "$app/navigation";
  import { db } from "$lib/db.js";
  import { useLiveQuery } from "$lib/db.svelte.js";
  import { getAuth } from "$lib/auth.svelte.js";
  import { generateTID, BOARD_COLLECTION, buildAtUri } from "$lib/tid.js";
  import type { Board, Column } from "$lib/types.js";
  import { loadBoardFromAppview } from "$lib/appview.js";
  import { grantTrust } from "$lib/trust.js";
  import BoardCard from "$lib/components/BoardCard.svelte";

  const auth = getAuth();

  // Show all boards — both owned and joined
  const boards = useLiveQuery<Board[]>(() => db.boards.toArray());

  let newBoardName = $state("");
  let newBoardDescription = $state("");
  let creating = $state(false);
  let joinUri = $state("");
  let joining = $state(false);
  let joinError = $state("");

  async function createBoard(e: Event) {
    e.preventDefault();
    const name = newBoardName.trim();
    if (!name || !auth.did) return;

    creating = true;
    try {
      const rkey = generateTID();
      const now = new Date().toISOString();
      const defaultColumns: Column[] = [
        { id: generateTID(), name: "To Do", order: 0 },
        { id: generateTID(), name: "In Progress", order: 1 },
        { id: generateTID(), name: "Done", order: 2 },
      ];

      const description = newBoardDescription.trim() || undefined;

      await db.boards.add({
        rkey,
        did: auth.did,
        name,
        description,
        columns: defaultColumns,
        createdAt: now,
        syncStatus: "pending",
      });

      newBoardName = "";
      newBoardDescription = "";
    } catch (err) {
      console.error("Failed to create board:", err);
    } finally {
      creating = false;
    }
  }

  function parseBoardInput(
    input: string,
  ): { ownerDid: string; rkey: string } | null {
    // Try AT URI: at://did/collection/rkey
    const atMatch = input.match(/^at:\/\/([^/]+)\/([^/]+)\/([^/]+)$/);
    if (atMatch) {
      const [, did, collection, rkey] = atMatch;
      if (collection !== BOARD_COLLECTION) return null;
      return { ownerDid: did, rkey };
    }

    // Try web URL: https://host/board/did/rkey
    const urlMatch = input.match(/\/board\/(did:[^/]+)\/([^/]+)\/?$/);
    if (urlMatch) {
      return { ownerDid: urlMatch[1], rkey: urlMatch[2] };
    }

    return null;
  }

  async function joinBoard(e: Event) {
    e.preventDefault();
    const uri = joinUri.trim();
    if (!uri) return;

    joinError = "";
    joining = true;

    try {
      const parsed = parseBoardInput(uri);
      if (!parsed) {
        joinError = "Invalid format. Paste a board link or AT URI.";
        return;
      }

      const { ownerDid, rkey } = parsed;

      // Check if we already have this board
      const existing = await db.boards.where("rkey").equals(rkey).first();
      if (existing) {
        goto(`/board/${ownerDid}/${rkey}`);
        return;
      }

      // Fetch the board from the appview
      const boardAtUri = buildAtUri(ownerDid, BOARD_COLLECTION, rkey);
      const ok = await loadBoardFromAppview(ownerDid, rkey, boardAtUri);
      if (!ok) {
        joinError = "Could not fetch board. Check the URI and try again.";
        return;
      }

      // Auto-trust the board owner
      if (auth.did && ownerDid !== auth.did) {
        await grantTrust(auth.did, ownerDid, boardAtUri);
      }

      joinUri = "";
      goto(`/board/${ownerDid}/${rkey}`);
    } catch (err) {
      console.error("Failed to join board:", err);
      joinError = "Failed to join board.";
    } finally {
      joining = false;
    }
  }
</script>

<div class="page">
  <div class="page-header">
    <h2>Your Boards</h2>
  </div>

  <form class="create-board-form" onsubmit={createBoard}>
    <div class="create-board-fields">
      <input
        type="text"
        bind:value={newBoardName}
        placeholder="New board name..."
        disabled={creating}
        required
      />
      <textarea
        bind:value={newBoardDescription}
        placeholder="Description (optional)"
        disabled={creating}
        rows="2"
      ></textarea>
    </div>
    <button type="submit" disabled={creating || !newBoardName.trim()}>
      {creating ? "Creating..." : "Create Board"}
    </button>
  </form>

  <form class="join-board-form" onsubmit={joinBoard}>
    <input
      type="text"
      bind:value={joinUri}
      placeholder="Paste a board link or AT URI to join..."
      disabled={joining}
    />
    <button type="submit" disabled={joining || !joinUri.trim()}>
      {joining ? "Joining..." : "Join Board"}
    </button>
  </form>
  {#if joinError}
    <p class="join-error">{joinError}</p>
  {/if}

  <div class="board-grid">
    {#if boards.current && boards.current.length > 0}
      {#each boards.current as board (board.id)}
        <BoardCard {board} />
      {/each}
    {:else if boards.current}
      <p class="empty">
        No boards yet. Create one above or paste a board link to join.
      </p>
    {/if}
  </div>
</div>

<style>
  .page {
    max-width: 900px;
    margin: 0 auto;
    padding: 2rem 1.5rem;
  }

  .page-header {
    margin-bottom: 1.5rem;
  }

  .page-header h2 {
    margin: 0;
    font-size: 1.25rem;
    font-weight: 600;
  }

  .create-board-form,
  .join-board-form {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
  }

  .create-board-fields {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }

  .create-board-form textarea {
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    font-size: 0.8125rem;
    background: var(--color-surface);
    color: var(--color-text);
    resize: vertical;
    font-family: inherit;
  }

  .create-board-form textarea:focus {
    outline: none;
    border-color: var(--color-primary);
    box-shadow: 0 0 0 2px var(--color-primary-alpha);
  }

  .join-board-form {
    margin-bottom: 1.5rem;
  }

  .create-board-form {
    align-items: flex-start;
  }

  .create-board-form input,
  .join-board-form input {
    flex: 1;
    padding: 0.625rem 0.75rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    font-size: 0.875rem;
    background: var(--color-surface);
    color: var(--color-text);
  }

  .create-board-form input:focus,
  .join-board-form input:focus {
    outline: none;
    border-color: var(--color-primary);
    box-shadow: 0 0 0 2px var(--color-primary-alpha);
  }

  .create-board-form button,
  .join-board-form button {
    padding: 0.625rem 1.25rem;
    background: var(--color-primary);
    color: white;
    border: none;
    border-radius: var(--radius-md);
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.15s;
  }

  .create-board-form button:hover:not(:disabled),
  .join-board-form button:hover:not(:disabled) {
    background: var(--color-primary-hover);
  }

  .create-board-form button:disabled,
  .join-board-form button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .join-error {
    color: var(--color-error);
    font-size: 0.8125rem;
    margin: -0.5rem 0 1rem;
  }

  .board-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 1rem;
  }

  .empty {
    grid-column: 1 / -1;
    text-align: center;
    color: var(--color-text-secondary);
    padding: 3rem 0;
  }
</style>
