import { db } from "./db.js";
import { generateTID } from "./tid.js";
import type { Reaction, ReactionRecord } from "./types.js";

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
  }
}

export async function deleteReaction(reaction: Reaction): Promise<void> {
  if (!reaction.id) return;
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
