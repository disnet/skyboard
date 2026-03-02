import { db } from "./db.js";
import { generateTID } from "./tid.js";
import type { ProjectOp, ProjectOpFields, ProjectOpRecord } from "./types.js";
import { notifyPendingWrite } from "./sync.js";

export async function createProjectOp(
  authorDid: string,
  targetProjectUri: string,
  fields: ProjectOpFields,
): Promise<void> {
  await db.projectOps.add({
    rkey: generateTID(),
    did: authorDid,
    targetProjectUri,
    fields,
    createdAt: new Date().toISOString(),
    syncStatus: "pending",
  });
  notifyPendingWrite();
}

export function projectOpToRecord(op: ProjectOp): ProjectOpRecord {
  return {
    $type: "dev.skyboard.projectOp",
    targetProjectUri: op.targetProjectUri,
    fields: op.fields,
    createdAt: op.createdAt,
  };
}
