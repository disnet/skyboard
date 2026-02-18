import { db } from "./db.js";
import { generateTID, REACTION_COLLECTION } from "./tid.js";
import { getAuth } from "./auth.svelte.js";
import type { Reaction, ReactionRecord } from "./types.js";
import { notifyPendingWrite } from "./sync.js";

export async function toggleReaction(
  did: string,
  targetTaskUri: string,
  boardUri: string,
  emoji: string,
): Promise<void> {
  const existing = await db.reactions
    .where("[did+targetTaskUri+emoji]")
    .equals([did, targetTaskUri, emoji])
    .first();

  if (existing) {
    await deleteReaction(existing);
  } else {
    await db.reactions.add({
      rkey: generateTID(),
      did,
      targetTaskUri,
      boardUri,
      emoji,
      createdAt: new Date().toISOString(),
      syncStatus: "pending",
    });
    notifyPendingWrite();
  }
}

export async function deleteReaction(reaction: Reaction): Promise<void> {
  if (!reaction.id) return;

  if (reaction.syncStatus === "synced") {
    const auth = getAuth();
    if (auth.agent) {
      try {
        await auth.agent.com.atproto.repo.deleteRecord({
          repo: reaction.did,
          collection: REACTION_COLLECTION,
          rkey: reaction.rkey,
        });
      } catch (err) {
        console.error("Failed to delete reaction from PDS:", err);
      }
    }
  }

  await db.reactions.delete(reaction.id);
}

export function reactionToRecord(reaction: Reaction): ReactionRecord {
  return {
    $type: "dev.skyboard.reaction",
    targetTaskUri: reaction.targetTaskUri,
    boardUri: reaction.boardUri,
    emoji: reaction.emoji,
    createdAt: reaction.createdAt,
  };
}
