import { db } from "./db.js";
import type { Board, Task, Op, Trust, Comment, Approval, Reaction } from "./types.js";
import { addKnownParticipant } from "./remote-sync.js";

const APPVIEW_URL =
  typeof window !== "undefined" &&
  (window as unknown as Record<string, unknown>).__SKYBOARD_APPVIEW_URL__
    ? String((window as unknown as Record<string, unknown>).__SKYBOARD_APPVIEW_URL__)
    : "https://appview.skyboard.dev";

/**
 * Try to load a board from the appview. Returns true if successful,
 * false if the appview is unavailable or returns an error.
 *
 * On success, populates Dexie with raw tasks, ops, trusts, comments,
 * approvals, and reactions — same as the PDS fetch path.
 */
export async function loadBoardFromAppview(
  ownerDid: string,
  rkey: string,
  boardUri: string,
): Promise<boolean> {
  try {
    const res = await fetch(`${APPVIEW_URL}/board/${ownerDid}/${rkey}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return false;

    const data = await res.json();

    // Store board
    const boardData: Omit<Board, "id"> = {
      rkey: data.board.rkey,
      did: data.board.did,
      name: data.board.name,
      description: data.board.description ?? undefined,
      columns: data.board.columns,
      labels: data.board.labels,
      open: data.board.open || undefined,
      createdAt: data.board.createdAt,
      syncStatus: "synced",
    };

    const existingBoard = await db.boards.where("rkey").equals(rkey).first();
    if (existingBoard?.id) {
      await db.boards.update(existingBoard.id, boardData);
    } else {
      await db.boards.add(boardData as Board);
    }

    // Store raw tasks
    for (const t of data.rawTasks ?? []) {
      const taskData: Omit<Task, "id"> = {
        rkey: t.rkey,
        did: t.did,
        title: t.title,
        description: t.description ?? undefined,
        columnId: t.columnId,
        boardUri: t.boardUri,
        position: t.position ?? undefined,
        labelIds: t.labelIds ?? undefined,
        order: t.order ?? 0,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt ?? undefined,
        syncStatus: "synced",
      };

      const existing = await db.tasks
        .where("[did+rkey]")
        .equals([t.did, t.rkey])
        .first();
      if (existing?.id) {
        await db.tasks.update(existing.id, taskData);
      } else {
        await db.tasks.add(taskData as Task);
      }
      await addKnownParticipant(t.did, boardUri);
    }

    // Store raw ops
    for (const o of data.rawOps ?? []) {
      const opData: Omit<Op, "id"> = {
        rkey: o.rkey,
        did: o.did,
        targetTaskUri: o.targetTaskUri,
        boardUri: o.boardUri,
        fields: o.fields,
        createdAt: o.createdAt,
        syncStatus: "synced",
      };

      const existing = await db.ops
        .where("[did+rkey]")
        .equals([o.did, o.rkey])
        .first();
      if (existing?.id) {
        await db.ops.update(existing.id, opData);
      } else {
        await db.ops.add(opData as Op);
      }
      await addKnownParticipant(o.did, boardUri);
    }

    // Store trusts
    for (const t of data.trusts ?? []) {
      const trustData: Omit<Trust, "id"> = {
        rkey: t.rkey,
        did: t.did,
        trustedDid: t.trustedDid,
        boardUri,
        createdAt: t.createdAt,
        syncStatus: "synced",
      };

      const existing = await db.trusts
        .where("[did+boardUri+trustedDid]")
        .equals([t.did, boardUri, t.trustedDid])
        .first();
      if (existing?.id) {
        await db.trusts.update(existing.id, trustData);
      } else {
        await db.trusts.add(trustData as Trust);
      }
      await addKnownParticipant(t.trustedDid, boardUri);
    }

    // Store comments
    for (const c of data.comments ?? []) {
      const commentData: Omit<Comment, "id"> = {
        rkey: c.rkey,
        did: c.did,
        targetTaskUri: c.targetTaskUri,
        boardUri,
        text: c.text,
        createdAt: c.createdAt,
        syncStatus: "synced",
      };

      const existing = await db.comments
        .where("[did+rkey]")
        .equals([c.did, c.rkey])
        .first();
      if (existing?.id) {
        await db.comments.update(existing.id, commentData);
      } else {
        await db.comments.add(commentData as Comment);
      }
    }

    // Store approvals
    for (const a of data.approvals ?? []) {
      const approvalData: Omit<Approval, "id"> = {
        rkey: a.rkey,
        did: a.did,
        targetUri: a.targetUri,
        boardUri,
        createdAt: a.createdAt,
        syncStatus: "synced",
      };

      const existing = await db.approvals
        .where("[did+rkey]")
        .equals([a.did, a.rkey])
        .first();
      if (existing?.id) {
        await db.approvals.update(existing.id, approvalData);
      } else {
        await db.approvals.add(approvalData as Approval);
      }
    }

    // Store reactions
    for (const r of data.reactions ?? []) {
      const reactionData: Omit<Reaction, "id"> = {
        rkey: r.rkey,
        did: r.did,
        targetTaskUri: r.targetTaskUri,
        boardUri,
        emoji: r.emoji,
        createdAt: r.createdAt,
        syncStatus: "synced",
      };

      const existing = await db.reactions
        .where("[did+rkey]")
        .equals([r.did, r.rkey])
        .first();
      if (existing?.id) {
        await db.reactions.update(existing.id, reactionData);
      } else {
        await db.reactions.add(reactionData as Reaction);
      }
    }

    return true;
  } catch {
    return false;
  }
}
