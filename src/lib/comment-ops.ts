import { db } from "./db.js";
import { generateTID } from "./tid.js";
import type { CommentOp, CommentOpFields, CommentOpRecord } from "./types.js";
import { notifyPendingWrite } from "./sync.js";

export async function createCommentOp(
  authorDid: string,
  targetCommentUri: string,
  fields: CommentOpFields,
): Promise<void> {
  await db.commentOps.add({
    rkey: generateTID(),
    did: authorDid,
    targetCommentUri,
    fields,
    createdAt: new Date().toISOString(),
    syncStatus: "pending",
  });
  notifyPendingWrite();
}

export function commentOpToRecord(op: CommentOp): CommentOpRecord {
  return {
    $type: "dev.skyboard.commentOp",
    targetCommentUri: op.targetCommentUri,
    fields: op.fields,
    createdAt: op.createdAt,
  };
}
