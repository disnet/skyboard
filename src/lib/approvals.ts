import { db } from "./db.js";
import { generateTID } from "./tid.js";
import type { Approval, ApprovalRecord } from "./types.js";

export async function createApproval(
  ownerDid: string,
  targetUri: string,
  boardUri: string,
): Promise<void> {
  await db.approvals.add({
    rkey: generateTID(),
    did: ownerDid,
    targetUri,
    boardUri,
    createdAt: new Date().toISOString(),
    syncStatus: "pending",
  });
}

export async function deleteApproval(approval: Approval): Promise<void> {
  if (approval.id) {
    await db.approvals.delete(approval.id);
  }
}

export function approvalToRecord(approval: Approval): ApprovalRecord {
  return {
    $type: "dev.skyboard.approval",
    targetUri: approval.targetUri,
    boardUri: approval.boardUri,
    createdAt: approval.createdAt,
  };
}
