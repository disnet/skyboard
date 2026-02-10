import { db } from "./db.js";
import type { Block } from "./types.js";

export async function blockUser(
  did: string,
  blockedDid: string,
  boardUri: string,
): Promise<void> {
  const existing = await db.blocks
    .where("[did+boardUri+blockedDid]")
    .equals([did, boardUri, blockedDid])
    .first();
  if (existing) return;

  await db.blocks.add({
    did,
    blockedDid,
    boardUri,
    createdAt: new Date().toISOString(),
  });
}

export async function unblockUser(
  did: string,
  blockedDid: string,
  boardUri: string,
): Promise<void> {
  const block = await db.blocks
    .where("[did+boardUri+blockedDid]")
    .equals([did, boardUri, blockedDid])
    .first();
  if (!block || !block.id) return;
  await db.blocks.delete(block.id);
}

export async function getBlockedDids(
  did: string,
  boardUri: string,
): Promise<string[]> {
  const blocks = await db.blocks
    .where("did")
    .equals(did)
    .filter((b) => b.boardUri === boardUri)
    .toArray();
  return blocks.map((b) => b.blockedDid);
}
