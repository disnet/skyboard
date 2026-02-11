import { db } from "./db.js";
import { generateTID, APPROVAL_COLLECTION } from "./tid.js";
import { getAuth } from "./auth.svelte.js";
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
  if (!approval.id) return;

  if (approval.syncStatus === "synced") {
    const auth = getAuth();
    if (auth.agent) {
      try {
        await auth.agent.com.atproto.repo.deleteRecord({
          repo: approval.did,
          collection: APPROVAL_COLLECTION,
          rkey: approval.rkey,
        });
      } catch (err) {
        console.error("Failed to delete approval from PDS:", err);
      }
    }
  }

  await db.approvals.delete(approval.id);
}

export function approvalToRecord(approval: Approval): ApprovalRecord {
  return {
    $type: "dev.skyboard.approval",
    targetUri: approval.targetUri,
    boardUri: approval.boardUri,
    createdAt: approval.createdAt,
  };
}
