import { db } from "./db.js";
import { generateTID, LABEL_COLLECTION } from "./tid.js";
import { getAuth } from "./auth.svelte.js";
import type { Label, LabelRecord } from "./types.js";
import { notifyPendingWrite } from "./sync.js";

export async function createLabel(
  authorDid: string,
  name: string,
  color: string,
  description?: string,
): Promise<Label> {
  const label: Label = {
    rkey: generateTID(),
    did: authorDid,
    name,
    color,
    description,
    createdAt: new Date().toISOString(),
    syncStatus: "pending",
  };
  const id = await db.labels.add(label);
  label.id = id as number;
  notifyPendingWrite();
  return label;
}

export async function deleteLabel(label: Label): Promise<void> {
  if (!label.id) return;

  if (label.syncStatus === "synced") {
    const auth = getAuth();
    if (auth.agent) {
      try {
        await auth.agent.com.atproto.repo.deleteRecord({
          repo: label.did,
          collection: LABEL_COLLECTION,
          rkey: label.rkey,
        });
      } catch (err) {
        console.error("Failed to delete label from PDS:", err);
      }
    }
  }

  await db.labels.delete(label.id);
}

export function labelToRecord(label: Label): LabelRecord {
  return {
    $type: "dev.skyboard.label",
    name: label.name,
    color: label.color,
    ...(label.description ? { description: label.description } : {}),
    createdAt: label.createdAt,
  };
}
