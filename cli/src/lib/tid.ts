// Synced from ../src/lib/tid.ts
import { TID } from "@atproto/common-web";

export const BOARD_COLLECTION = "dev.skyboard.board";
export const TASK_COLLECTION = "dev.skyboard.task";
export const OP_COLLECTION = "dev.skyboard.op";
export const TRUST_COLLECTION = "dev.skyboard.trust";
export const COMMENT_COLLECTION = "dev.skyboard.comment";
export const APPROVAL_COLLECTION = "dev.skyboard.approval";
export const REACTION_COLLECTION = "dev.skyboard.reaction";

export function generateTID(): string {
  return TID.nextStr();
}

export function buildAtUri(
  did: string,
  collection: string,
  rkey: string,
): string {
  return `at://${did}/${collection}/${rkey}`;
}
