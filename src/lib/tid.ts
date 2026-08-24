import { TID } from "@atproto/common-web";

export const BOARD_COLLECTION = "dev.skyboard.board";
export const TASK_COLLECTION = "dev.skyboard.task";
export const OP_COLLECTION = "dev.skyboard.op";
export const TRUST_COLLECTION = "dev.skyboard.trust";
export const COMMENT_COLLECTION = "dev.skyboard.comment";
export const APPROVAL_COLLECTION = "dev.skyboard.approval";
export const REACTION_COLLECTION = "dev.skyboard.reaction";

/** Every collection Skyboard reads, in the order Jetstream wants them. */
export const ALL_COLLECTIONS = [
  BOARD_COLLECTION,
  TASK_COLLECTION,
  OP_COLLECTION,
  TRUST_COLLECTION,
  COMMENT_COLLECTION,
  APPROVAL_COLLECTION,
  REACTION_COLLECTION,
] as const;

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

/** A board identified by its owner, record key, and AT URI. */
export interface BoardRef {
  ownerDid: string;
  rkey: string;
  uri: string;
}

/** Parse `at://did/dev.skyboard.board/rkey`. Returns null for anything else. */
export function parseBoardUri(uri: string): BoardRef | null {
  const match = uri.match(/^at:\/\/([^/]+)\/([^/]+)\/([^/]+)$/);
  if (!match) return null;
  const [, ownerDid, collection, rkey] = match;
  if (collection !== BOARD_COLLECTION) return null;
  return { ownerDid, rkey, uri };
}
