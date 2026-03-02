import { db } from "./db.js";
import { generateTID } from "./tid.js";
import type { BoardOp, BoardOpFields, BoardOpRecord } from "./types.js";
import { notifyPendingWrite } from "./sync.js";

export async function createBoardOp(
  authorDid: string,
  targetBoardUri: string,
  fields: BoardOpFields,
): Promise<void> {
  await db.boardOps.add({
    rkey: generateTID(),
    did: authorDid,
    targetBoardUri,
    fields,
    createdAt: new Date().toISOString(),
    syncStatus: "pending",
  });
  notifyPendingWrite();
}

export function boardOpToRecord(op: BoardOp): BoardOpRecord {
  return {
    $type: "dev.skyboard.boardOp",
    targetBoardUri: op.targetBoardUri,
    fields: op.fields,
    createdAt: op.createdAt,
  };
}
