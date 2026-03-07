import { db } from "./db.js";
import { revokeTrust } from "./trust.js";
import { buildAtUri, BOARD_COLLECTION } from "./tid.js";
import type { Board } from "./types.js";

/**
 * Leave a joined board: revoke trust records from PDS and remove all local data.
 * The board won't reappear in discovery since the trust record is deleted.
 */
export async function leaveBoard(board: Board, userDid: string): Promise<void> {
  const boardUri = buildAtUri(board.did, BOARD_COLLECTION, board.rkey);

  // Revoke all trust records the current user has for this board
  const userTrusts = await db.trusts
    .where("boardUri")
    .equals(boardUri)
    .filter((t) => t.did === userDid)
    .toArray();

  for (const trust of userTrusts) {
    await revokeTrust(userDid, trust.trustedDid, boardUri);
  }

  // Delete all local data for this board
  await db.transaction(
    "rw",
    [
      db.boards,
      db.tasks,
      db.ops,
      db.trusts,
      db.comments,
      db.approvals,
      db.reactions,
      db.notifications,
      db.filterViews,
    ],
    async () => {
      await db.tasks.where("boardUri").equals(boardUri).delete();
      await db.ops.where("boardUri").equals(boardUri).delete();
      await db.trusts.where("boardUri").equals(boardUri).delete();
      await db.comments.where("boardUri").equals(boardUri).delete();
      await db.approvals.where("boardUri").equals(boardUri).delete();
      await db.reactions.where("boardUri").equals(boardUri).delete();
      await db.notifications.where("boardUri").equals(boardUri).delete();
      await db.filterViews.where("boardUri").equals(boardUri).delete();
      if (board.id) {
        await db.boards.delete(board.id);
      }
    },
  );
}

/**
 * Archive an owned board — hides it from the dashboard locally.
 * The board record stays in PDS (local-only operation).
 */
export async function archiveBoard(board: Board): Promise<void> {
  if (!board.id) return;
  await db.boards.update(board.id, { archived: true });
}

/**
 * Unarchive a board — restores it to the main dashboard list.
 */
export async function unarchiveBoard(board: Board): Promise<void> {
  if (!board.id) return;
  await db.boards.update(board.id, { archived: false });
}
