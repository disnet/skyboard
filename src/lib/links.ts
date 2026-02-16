import { db } from "./db.js";
import { generateTID, LINK_COLLECTION } from "./tid.js";
import { getAuth } from "./auth.svelte.js";
import type { Link, LinkRecord } from "./types.js";

export async function createLink(
  authorDid: string,
  sourceTaskUri: string,
  targetTaskUri: string,
  boardUri: string,
  linkType: string,
): Promise<void> {
  await db.links.add({
    rkey: generateTID(),
    did: authorDid,
    sourceTaskUri,
    targetTaskUri,
    boardUri,
    linkType,
    createdAt: new Date().toISOString(),
    syncStatus: "pending",
  });
}

export async function deleteLink(link: Link): Promise<void> {
  if (!link.id) return;

  if (link.syncStatus === "synced") {
    const auth = getAuth();
    if (auth.agent) {
      try {
        await auth.agent.com.atproto.repo.deleteRecord({
          repo: link.did,
          collection: LINK_COLLECTION,
          rkey: link.rkey,
        });
      } catch (err) {
        console.error("Failed to delete link from PDS:", err);
      }
    }
  }

  await db.links.delete(link.id);
}

export function linkToRecord(link: Link): LinkRecord {
  return {
    $type: "dev.skyboard.link",
    sourceTaskUri: link.sourceTaskUri,
    targetTaskUri: link.targetTaskUri,
    boardUri: link.boardUri,
    linkType: link.linkType,
    createdAt: link.createdAt,
  };
}
