import type { Agent } from "@atproto/api";
import { db } from "./db.js";
import {
  BOARD_COLLECTION,
  TASK_COLLECTION,
  OP_COLLECTION,
  TRUST_COLLECTION,
  COMMENT_COLLECTION,
  APPROVAL_COLLECTION,
  REACTION_COLLECTION,
  buildAtUri,
} from "./tid.js";
import type {
  Board,
  Task,
  Op,
  Trust,
  Comment,
  Approval,
  Reaction,
  BoardRecord,
  TaskRecord,
} from "./types.js";
import { opToRecord } from "./ops.js";
import { trustToRecord } from "./trust.js";
import { commentToRecord } from "./comments.js";
import { approvalToRecord } from "./approvals.js";
import { reactionToRecord } from "./reactions.js";

let syncInterval: ReturnType<typeof setInterval> | null = null;

function boardToRecord(board: Board): BoardRecord {
  return {
    $type: "dev.skyboard.board",
    name: board.name,
    ...(board.description ? { description: board.description } : {}),
    columns: board.columns,
    ...(board.labels && board.labels.length > 0
      ? { labels: board.labels }
      : {}),
    ...(board.open ? { open: board.open } : {}),
    createdAt: board.createdAt,
  };
}

function taskToRecord(task: Task): TaskRecord {
  return {
    $type: "dev.skyboard.task",
    title: task.title,
    ...(task.description ? { description: task.description } : {}),
    columnId: task.columnId,
    boardUri: task.boardUri,
    ...(task.position ? { position: task.position } : {}),
    ...(task.labelIds && task.labelIds.length > 0
      ? { labelIds: task.labelIds }
      : {}),
    order: task.order ?? 0,
    createdAt: task.createdAt,
    ...(task.updatedAt ? { updatedAt: task.updatedAt } : {}),
  };
}

function isNetworkError(err: unknown): boolean {
  if (err instanceof TypeError && err.message === "Failed to fetch")
    return true;
  const name = (err as { name?: string })?.name;
  return name === "FetchRequestError" || name === "_FetchRequestError";
}

export async function syncPendingToPDS(
  agent: Agent,
  did: string,
): Promise<void> {
  if (!navigator.onLine) return;

  const pendingBoards = await db.boards
    .where("syncStatus")
    .equals("pending")
    .filter((b) => b.did === did)
    .toArray();

  for (const board of pendingBoards) {
    try {
      await agent.com.atproto.repo.putRecord({
        repo: did,
        collection: BOARD_COLLECTION,
        rkey: board.rkey,
        record: boardToRecord(board),
        validate: false,
      });
      if (board.id) {
        await db.boards.update(board.id, { syncStatus: "synced" });
      }
    } catch (err) {
      console.error("Failed to sync board to PDS:", err);
      if (board.id && !isNetworkError(err)) {
        await db.boards.update(board.id, { syncStatus: "error" });
      }
    }
  }

  const pendingTasks = await db.tasks
    .where("syncStatus")
    .equals("pending")
    .filter((t) => t.did === did && t.title !== "")
    .toArray();

  for (const task of pendingTasks) {
    try {
      await agent.com.atproto.repo.putRecord({
        repo: did,
        collection: TASK_COLLECTION,
        rkey: task.rkey,
        record: taskToRecord(task),
        validate: false,
      });
      if (task.id) {
        await db.tasks.update(task.id, { syncStatus: "synced" });
      }
    } catch (err) {
      console.error("Failed to sync task to PDS:", err);
      if (task.id && !isNetworkError(err)) {
        await db.tasks.update(task.id, { syncStatus: "error" });
      }
    }
  }

  // Sync pending ops
  const pendingOps = await db.ops
    .where("syncStatus")
    .equals("pending")
    .filter((o) => o.did === did)
    .toArray();

  for (const op of pendingOps) {
    try {
      await agent.com.atproto.repo.putRecord({
        repo: did,
        collection: OP_COLLECTION,
        rkey: op.rkey,
        record: opToRecord(op),
        validate: false,
      });
      if (op.id) {
        await db.ops.update(op.id, { syncStatus: "synced" });
      }
    } catch (err) {
      console.error("Failed to sync op to PDS:", err);
      if (op.id && !isNetworkError(err)) {
        await db.ops.update(op.id, { syncStatus: "error" });
      }
    }
  }

  // Sync pending trusts
  const pendingTrusts = await db.trusts
    .where("syncStatus")
    .equals("pending")
    .filter((t) => t.did === did)
    .toArray();

  for (const trust of pendingTrusts) {
    try {
      await agent.com.atproto.repo.putRecord({
        repo: did,
        collection: TRUST_COLLECTION,
        rkey: trust.rkey,
        record: trustToRecord(trust),
        validate: false,
      });
      if (trust.id) {
        await db.trusts.update(trust.id, { syncStatus: "synced" });
      }
    } catch (err) {
      console.error("Failed to sync trust to PDS:", err);
      if (trust.id && !isNetworkError(err)) {
        await db.trusts.update(trust.id, { syncStatus: "error" });
      }
    }
  }

  // Sync pending comments
  const pendingComments = await db.comments
    .where("syncStatus")
    .equals("pending")
    .filter((c) => c.did === did)
    .toArray();

  for (const comment of pendingComments) {
    try {
      await agent.com.atproto.repo.putRecord({
        repo: did,
        collection: COMMENT_COLLECTION,
        rkey: comment.rkey,
        record: commentToRecord(comment),
        validate: false,
      });
      if (comment.id) {
        await db.comments.update(comment.id, { syncStatus: "synced" });
      }
    } catch (err) {
      console.error("Failed to sync comment to PDS:", err);
      if (comment.id && !isNetworkError(err)) {
        await db.comments.update(comment.id, { syncStatus: "error" });
      }
    }
  }

  // Sync pending approvals
  const pendingApprovals = await db.approvals
    .where("syncStatus")
    .equals("pending")
    .filter((a) => a.did === did)
    .toArray();

  for (const approval of pendingApprovals) {
    try {
      await agent.com.atproto.repo.putRecord({
        repo: did,
        collection: APPROVAL_COLLECTION,
        rkey: approval.rkey,
        record: approvalToRecord(approval),
        validate: false,
      });
      if (approval.id) {
        await db.approvals.update(approval.id, { syncStatus: "synced" });
      }
    } catch (err) {
      console.error("Failed to sync approval to PDS:", err);
      if (approval.id && !isNetworkError(err)) {
        await db.approvals.update(approval.id, { syncStatus: "error" });
      }
    }
  }

  // Sync pending reactions
  const pendingReactions = await db.reactions
    .where("syncStatus")
    .equals("pending")
    .filter((r) => r.did === did)
    .toArray();

  for (const reaction of pendingReactions) {
    try {
      await agent.com.atproto.repo.putRecord({
        repo: did,
        collection: REACTION_COLLECTION,
        rkey: reaction.rkey,
        record: reactionToRecord(reaction),
        validate: false,
      });
      if (reaction.id) {
        await db.reactions.update(reaction.id, { syncStatus: "synced" });
      }
    } catch (err) {
      console.error("Failed to sync reaction to PDS:", err);
      if (reaction.id && !isNetworkError(err)) {
        await db.reactions.update(reaction.id, { syncStatus: "error" });
      }
    }
  }
}

export async function deleteBoardFromPDS(
  agent: Agent,
  did: string,
  board: Board,
): Promise<void> {
  // Delete tasks from PDS first
  const boardUri = buildAtUri(did, BOARD_COLLECTION, board.rkey);
  const tasks = await db.tasks.where("boardUri").equals(boardUri).toArray();

  for (const task of tasks) {
    if (task.syncStatus === "synced") {
      try {
        await agent.com.atproto.repo.deleteRecord({
          repo: did,
          collection: TASK_COLLECTION,
          rkey: task.rkey,
        });
      } catch (err) {
        console.error("Failed to delete task from PDS:", err);
      }
    }
  }

  // Delete comments from PDS
  const comments = await db.comments
    .where("boardUri")
    .equals(boardUri)
    .filter((c) => c.did === did)
    .toArray();

  for (const comment of comments) {
    if (comment.syncStatus === "synced") {
      try {
        await agent.com.atproto.repo.deleteRecord({
          repo: did,
          collection: COMMENT_COLLECTION,
          rkey: comment.rkey,
        });
      } catch (err) {
        console.error("Failed to delete comment from PDS:", err);
      }
    }
  }

  // Delete approvals from PDS
  const approvals = await db.approvals
    .where("boardUri")
    .equals(boardUri)
    .filter((a) => a.did === did)
    .toArray();

  for (const approval of approvals) {
    if (approval.syncStatus === "synced") {
      try {
        await agent.com.atproto.repo.deleteRecord({
          repo: did,
          collection: APPROVAL_COLLECTION,
          rkey: approval.rkey,
        });
      } catch (err) {
        console.error("Failed to delete approval from PDS:", err);
      }
    }
  }

  // Delete reactions from PDS
  const reactions = await db.reactions
    .where("boardUri")
    .equals(boardUri)
    .filter((r) => r.did === did)
    .toArray();

  for (const reaction of reactions) {
    if (reaction.syncStatus === "synced") {
      try {
        await agent.com.atproto.repo.deleteRecord({
          repo: did,
          collection: REACTION_COLLECTION,
          rkey: reaction.rkey,
        });
      } catch (err) {
        console.error("Failed to delete reaction from PDS:", err);
      }
    }
  }

  // Delete board from PDS
  if (board.syncStatus === "synced") {
    try {
      await agent.com.atproto.repo.deleteRecord({
        repo: did,
        collection: BOARD_COLLECTION,
        rkey: board.rkey,
      });
    } catch (err) {
      console.error("Failed to delete board from PDS:", err);
    }
  }
}

export async function deleteCommentFromPDS(
  agent: Agent,
  did: string,
  comment: Comment,
): Promise<void> {
  if (comment.syncStatus === "synced") {
    try {
      await agent.com.atproto.repo.deleteRecord({
        repo: did,
        collection: COMMENT_COLLECTION,
        rkey: comment.rkey,
      });
    } catch (err) {
      console.error("Failed to delete comment from PDS:", err);
    }
  }
}

export async function deleteTaskFromPDS(
  agent: Agent,
  did: string,
  task: Task,
): Promise<void> {
  if (task.syncStatus === "synced") {
    try {
      await agent.com.atproto.repo.deleteRecord({
        repo: did,
        collection: TASK_COLLECTION,
        rkey: task.rkey,
      });
    } catch (err) {
      console.error("Failed to delete task from PDS:", err);
    }
  }
}

export async function deleteTrustFromPDS(
  agent: Agent,
  did: string,
  trust: Trust,
): Promise<void> {
  if (trust.syncStatus === "synced") {
    try {
      await agent.com.atproto.repo.deleteRecord({
        repo: did,
        collection: TRUST_COLLECTION,
        rkey: trust.rkey,
      });
    } catch (err) {
      console.error("Failed to delete trust from PDS:", err);
    }
  }
}

export async function deleteApprovalFromPDS(
  agent: Agent,
  did: string,
  approval: Approval,
): Promise<void> {
  if (approval.syncStatus === "synced") {
    try {
      await agent.com.atproto.repo.deleteRecord({
        repo: did,
        collection: APPROVAL_COLLECTION,
        rkey: approval.rkey,
      });
    } catch (err) {
      console.error("Failed to delete approval from PDS:", err);
    }
  }
}

export async function deleteReactionFromPDS(
  agent: Agent,
  did: string,
  reaction: Reaction,
): Promise<void> {
  if (reaction.syncStatus === "synced") {
    try {
      await agent.com.atproto.repo.deleteRecord({
        repo: did,
        collection: REACTION_COLLECTION,
        rkey: reaction.rkey,
      });
    } catch (err) {
      console.error("Failed to delete reaction from PDS:", err);
    }
  }
}

async function resetErrorsToPending(did: string): Promise<void> {
  const tables = [
    db.boards,
    db.tasks,
    db.ops,
    db.trusts,
    db.comments,
    db.approvals,
    db.reactions,
  ];
  for (const table of tables) {
    const errored = await (table as any)
      .where("syncStatus")
      .equals("error")
      .filter((r: { did: string }) => r.did === did)
      .toArray();
    for (const record of errored) {
      const id = (record as { id?: number }).id;
      if (id) {
        await table.update(id, { syncStatus: "pending" });
      }
    }
  }
}

let onlineHandler: (() => void) | null = null;

export function startBackgroundSync(agent: Agent, did: string): void {
  stopBackgroundSync();
  syncInterval = setInterval(() => {
    resetErrorsToPending(did).then(() => {
      syncPendingToPDS(agent, did).catch(console.error);
    });
  }, 5_000);
  // Also run immediately
  syncPendingToPDS(agent, did).catch(console.error);

  // When coming back online, reset errors and sync after a brief delay
  // to let the network stabilize (online event can fire before routes are ready)
  onlineHandler = () => {
    setTimeout(() => {
      resetErrorsToPending(did).then(() => {
        syncPendingToPDS(agent, did).catch(console.error);
      });
    }, 1000);
  };
  window.addEventListener("online", onlineHandler);
}

export function stopBackgroundSync(): void {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
  }
  if (onlineHandler) {
    window.removeEventListener("online", onlineHandler);
    onlineHandler = null;
  }
}
