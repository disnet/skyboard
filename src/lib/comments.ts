import { db } from "./db.js";
import { generateTID, COMMENT_COLLECTION } from "./tid.js";
import { getAuth } from "./auth.svelte.js";
import type { Comment, CommentRecord } from "./types.js";
import { notifyPendingWrite } from "./sync.js";

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
  notifyPendingWrite();
}

export async function deleteComment(comment: Comment): Promise<void> {
  if (!comment.id) return;

  if (comment.syncStatus === "synced") {
    const auth = getAuth();
    if (auth.agent) {
      try {
        await auth.agent.com.atproto.repo.deleteRecord({
          repo: comment.did,
          collection: COMMENT_COLLECTION,
          rkey: comment.rkey,
        });
      } catch (err) {
        console.error("Failed to delete comment from PDS:", err);
      }
    }
  }

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
