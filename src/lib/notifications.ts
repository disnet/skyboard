import { db } from "./db.js";
import { TASK_COLLECTION, COMMENT_COLLECTION, OP_COLLECTION } from "./tid.js";
import type { JetstreamCommitEvent } from "./jetstream.js";
import type { NotificationType } from "./types.js";

const MENTION_RE =
  /@((?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,})/g;

export function parseMentions(text: string): string[] {
  const matches: string[] = [];
  let m: RegExpExecArray | null;
  MENTION_RE.lastIndex = 0;
  while ((m = MENTION_RE.exec(text)) !== null) {
    matches.push(m[1].toLowerCase());
  }
  return [...new Set(matches)];
}

async function dedupeInsert(
  type: NotificationType,
  dedupeKey: string,
  data: {
    actorDid: string;
    boardUri: string;
    taskUri?: string;
    commentRkey?: string;
    text?: string;
    createdAt: string;
  },
): Promise<void> {
  const existing = await db.notifications
    .where("dedupeKey")
    .equals(dedupeKey)
    .first();
  if (existing) return;

  await db.notifications.add({
    type,
    dedupeKey,
    actorDid: data.actorDid,
    boardUri: data.boardUri,
    taskUri: data.taskUri,
    commentRkey: data.commentRkey,
    text: data.text,
    read: 0,
    createdAt: data.createdAt,
  });
}

export async function generateNotificationFromEvent(
  event: JetstreamCommitEvent,
  currentUserDid: string,
  currentUserHandle: string | undefined,
): Promise<void> {
  const { did, commit } = event;
  if (did === currentUserDid) return;
  if (commit.operation !== "create" || !commit.record) return;

  const record = commit.record;
  const boardUri = record.boardUri as string | undefined;
  if (!boardUri) return;

  // Only generate notifications for boards the user has locally
  const boardRkey = boardUri.split("/").pop();
  if (!boardRkey) return;
  const localBoard = await db.boards.where("rkey").equals(boardRkey).first();
  if (!localBoard) return;

  if (commit.collection === TASK_COLLECTION) {
    const title = (record.title as string) ?? "";
    await dedupeInsert("task_created", `task:${did}:${commit.rkey}`, {
      actorDid: did,
      boardUri,
      taskUri: `at://${did}/${TASK_COLLECTION}/${commit.rkey}`,
      text: title.slice(0, 100),
      createdAt: (record.createdAt as string) ?? new Date().toISOString(),
    });
  } else if (commit.collection === COMMENT_COLLECTION) {
    const text = (record.text as string) ?? "";
    const mentions = parseMentions(text);
    const handle = currentUserHandle?.toLowerCase();
    const isMentioned = handle ? mentions.includes(handle) : false;

    // Single notification: mention takes priority over comment_added
    const type: NotificationType = isMentioned ? "mention" : "comment_added";
    const key = isMentioned
      ? `mention:${did}:${commit.rkey}`
      : `comment:${did}:${commit.rkey}`;

    await dedupeInsert(type, key, {
      actorDid: did,
      boardUri,
      taskUri: record.targetTaskUri as string | undefined,
      commentRkey: commit.rkey,
      text: text.slice(0, 100),
      createdAt: (record.createdAt as string) ?? new Date().toISOString(),
    });
  } else if (commit.collection === OP_COLLECTION) {
    const fields = record.fields as Record<string, unknown> | undefined;
    if (!fields) return;

    // Check for mentions in description updates
    const desc = (fields.description as string) ?? "";
    const title = (fields.title as string) ?? "";
    const combined = `${desc} ${title}`;
    const mentions = parseMentions(combined);
    const handle = currentUserHandle?.toLowerCase();
    if (!handle || !mentions.includes(handle)) return;

    await dedupeInsert("mention", `mention:op:${did}:${commit.rkey}`, {
      actorDid: did,
      boardUri,
      taskUri: record.targetTaskUri as string | undefined,
      text: (desc || title).slice(0, 100),
      createdAt: (record.createdAt as string) ?? new Date().toISOString(),
    });
  }
}

export async function generateCatchUpNotifications(
  currentUserDid: string,
  currentUserHandle: string | undefined,
): Promise<void> {
  const LAST_SCAN_KEY = "notification-last-scan";
  const lastScan =
    localStorage.getItem(LAST_SCAN_KEY) ?? "1970-01-01T00:00:00Z";
  const now = new Date().toISOString();

  // Scan recent tasks created by others
  const recentTasks = await db.tasks
    .where("createdAt")
    .above(lastScan)
    .toArray();

  for (const task of recentTasks) {
    if (task.did === currentUserDid) continue;

    const boardRkey = task.boardUri.split("/").pop();
    if (!boardRkey) continue;
    const localBoard = await db.boards.where("rkey").equals(boardRkey).first();
    if (!localBoard) continue;

    await dedupeInsert("task_created", `task:${task.did}:${task.rkey}`, {
      actorDid: task.did,
      boardUri: task.boardUri,
      taskUri: `at://${task.did}/${TASK_COLLECTION}/${task.rkey}`,
      text: task.title.slice(0, 100),
      createdAt: task.createdAt,
    });
  }

  // Scan recent comments created by others
  const recentComments = await db.comments
    .where("createdAt")
    .above(lastScan)
    .toArray();

  for (const comment of recentComments) {
    if (comment.did === currentUserDid) continue;

    const boardRkey = comment.boardUri.split("/").pop();
    if (!boardRkey) continue;
    const localBoard = await db.boards.where("rkey").equals(boardRkey).first();
    if (!localBoard) continue;

    const mentions = parseMentions(comment.text);
    const handle = currentUserHandle?.toLowerCase();
    const isMentioned = handle ? mentions.includes(handle) : false;

    const type: NotificationType = isMentioned ? "mention" : "comment_added";
    const key = isMentioned
      ? `mention:${comment.did}:${comment.rkey}`
      : `comment:${comment.did}:${comment.rkey}`;

    await dedupeInsert(type, key, {
      actorDid: comment.did,
      boardUri: comment.boardUri,
      taskUri: comment.targetTaskUri,
      commentRkey: comment.rkey,
      text: comment.text.slice(0, 100),
      createdAt: comment.createdAt,
    });
  }

  // Scan recent ops for @mentions in description/title updates
  const recentOps = await db.ops
    .where("createdAt")
    .above(lastScan)
    .toArray();

  for (const op of recentOps) {
    if (op.did === currentUserDid) continue;

    const boardRkey = op.boardUri.split("/").pop();
    if (!boardRkey) continue;
    const localBoard = await db.boards.where("rkey").equals(boardRkey).first();
    if (!localBoard) continue;

    const desc = op.fields.description ?? "";
    const title = op.fields.title ?? "";
    const combined = `${desc} ${title}`;
    const mentions = parseMentions(combined);
    const handle = currentUserHandle?.toLowerCase();
    if (!handle || !mentions.includes(handle)) continue;

    await dedupeInsert("mention", `mention:op:${op.did}:${op.rkey}`, {
      actorDid: op.did,
      boardUri: op.boardUri,
      taskUri: op.targetTaskUri,
      text: (desc || title).slice(0, 100),
      createdAt: op.createdAt,
    });
  }

  localStorage.setItem(LAST_SCAN_KEY, now);
}

export async function markAsRead(id: number): Promise<void> {
  await db.notifications.update(id, { read: 1 });
}

export async function markAllAsRead(): Promise<void> {
  await db.notifications.where("read").equals(0).modify({ read: 1 });
}

export async function clearNotification(id: number): Promise<void> {
  await db.notifications.delete(id);
}

export async function clearAllNotifications(): Promise<void> {
  await db.notifications.clear();
}
