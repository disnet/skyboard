import { db } from "./db.js";
import { generateTID } from "./tid.js";
import type { Comment, CommentRecord } from "./types.js";

export async function createComment(
  authorDid: string,
  targetTaskUri: string,
  boardUri: string,
  text: string,
): Promise<void> {
  await db.comments.add({
    rkey: generateTID(),
    did: authorDid,
    targetTaskUri,
    boardUri,
    text,
    createdAt: new Date().toISOString(),
    syncStatus: "pending",
  });
}

export async function deleteComment(comment: Comment): Promise<void> {
  if (!comment.id) return;
  await db.comments.delete(comment.id);
}

export function commentToRecord(comment: Comment): CommentRecord {
  return {
    $type: "dev.skyboard.comment",
    targetTaskUri: comment.targetTaskUri,
    boardUri: comment.boardUri,
    text: comment.text,
    createdAt: comment.createdAt,
  };
}
