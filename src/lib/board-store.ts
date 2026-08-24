/**
 * Dexie write layer for board data fetched from the network.
 *
 * Both read paths funnel through here so they share one set of rules:
 *   - local records with `syncStatus: "pending"` always win over remote data
 *     (this also swallows the echo of the user's own in-flight writes)
 *   - unchanged records are not rewritten, so `liveQuery` doesn't churn
 *   - a full snapshot is applied in a single transaction, so subscribers see
 *     one update at commit instead of one per record
 */

import { db } from "./db.js";
import type { Table } from "dexie";
import {
  BOARD_COLLECTION,
  TASK_COLLECTION,
  OP_COLLECTION,
  TRUST_COLLECTION,
  COMMENT_COLLECTION,
  APPROVAL_COLLECTION,
  REACTION_COLLECTION,
  buildAtUri,
} from "./tid.js";
import { validateRecord } from "./record-schemas.js";
import type {
  Board,
  Task,
  Op,
  Trust,
  Comment,
  Approval,
  Reaction,
  OpFields,
  Column,
  Label,
  SyncStatus,
} from "./types.js";

/** Collections that hang off a board via their `boardUri` field. */
export const BOARD_CHILD_COLLECTIONS = [
  TASK_COLLECTION,
  OP_COLLECTION,
  TRUST_COLLECTION,
  COMMENT_COLLECTION,
  APPROVAL_COLLECTION,
  REACTION_COLLECTION,
] as const;

export interface RawRecord {
  did: string;
  rkey: string;
  value: Record<string, unknown>;
}

export interface BoardSnapshot {
  /** The board record itself, straight from the owner's PDS. */
  boardValue: Record<string, unknown>;
  /** Child records keyed by collection, already filtered to this board. */
  records: Map<string, RawRecord[]>;
  /**
   * (did, collection) pairs whose repo listing succeeded. Only these are
   * pruned — a participant whose PDS was unreachable keeps their local data.
   */
  hydrated: Array<{ did: string; collection: string }>;
  /** Rows that existed before this snapshot's network reads began. */
  pruneCandidates: Map<string, Set<string>>;
}

/** A row in any of the board-child tables. */
interface ChildRow {
  id?: number;
  did: string;
  rkey: string;
  boardUri: string;
  syncStatus: SyncStatus;
}

function childTable(collection: string): Table<ChildRow, number> | null {
  switch (collection) {
    case TASK_COLLECTION:
      return db.tasks as unknown as Table<ChildRow, number>;
    case OP_COLLECTION:
      return db.ops as unknown as Table<ChildRow, number>;
    case TRUST_COLLECTION:
      return db.trusts as unknown as Table<ChildRow, number>;
    case COMMENT_COLLECTION:
      return db.comments as unknown as Table<ChildRow, number>;
    case APPROVAL_COLLECTION:
      return db.approvals as unknown as Table<ChildRow, number>;
    case REACTION_COLLECTION:
      return db.reactions as unknown as Table<ChildRow, number>;
    default:
      return null;
  }
}

function writeTables() {
  return [
    db.boards,
    db.tasks,
    db.ops,
    db.trusts,
    db.comments,
    db.approvals,
    db.reactions,
  ];
}

/**
 * Compare two records on the given fields. Uses JSON.stringify for
 * array/object fields so deep equality is checked.
 */
function recordsEqual(
  existing: unknown,
  incoming: unknown,
  fields: string[],
): boolean {
  const ea = existing as Record<string, unknown>;
  const eb = incoming as Record<string, unknown>;
  for (const f of fields) {
    const va = ea[f];
    const vb = eb[f];
    if (va === vb) continue;
    if (
      typeof va === "object" &&
      typeof vb === "object" &&
      JSON.stringify(va) === JSON.stringify(vb)
    )
      continue;
    return false;
  }
  return true;
}

/**
 * Infer the `open` flag from a record that may still carry the old
 * `permissions` field but no `open` field.
 */
function inferOpen(value: Record<string, unknown>): boolean | undefined {
  if (value.open !== undefined) return (value.open as boolean) || undefined;
  const perms = value.permissions as
    | { rules?: Array<{ scope?: string }> }
    | undefined;
  if (perms?.rules?.some((r) => r.scope === "anyone")) return true;
  return undefined;
}

async function upsertBoard(
  did: string,
  rkey: string,
  value: Record<string, unknown>,
): Promise<void> {
  const validated = validateRecord(BOARD_COLLECTION, value);
  if (!validated) return;

  const boardData: Omit<Board, "id"> = {
    rkey,
    did,
    name: validated.name as string,
    description: (validated.description as string | undefined) ?? undefined,
    columns: validated.columns as Column[],
    labels: validated.labels as Label[] | undefined,
    open: inferOpen(value),
    createdAt: validated.createdAt as string,
    syncStatus: "synced",
  };

  const existing = await db.boards.where("rkey").equals(rkey).first();
  if (existing?.id) {
    if (existing.syncStatus === "pending") return;
    if (
      !recordsEqual(existing, boardData, [
        "name",
        "description",
        "columns",
        "labels",
        "open",
        "createdAt",
      ])
    ) {
      await db.boards.update(existing.id, boardData);
    }
  } else {
    await db.boards.add(boardData as Board);
  }
}

async function upsertTask(
  did: string,
  rkey: string,
  value: Record<string, unknown>,
  boardUri: string,
): Promise<void> {
  const v = validateRecord(TASK_COLLECTION, value);
  if (!v) return;

  const taskData: Omit<Task, "id"> = {
    rkey,
    did,
    title: v.title as string,
    description: (v.description as string | undefined) ?? undefined,
    columnId: v.columnId as string,
    boardUri,
    parentTaskUri: (v.parentTaskUri as string | undefined) ?? undefined,
    position: (v.position as string | undefined) ?? undefined,
    labelIds: (v.labelIds as string[] | undefined) ?? undefined,
    order: (v.order as number | undefined) ?? 0,
    createdAt: v.createdAt as string,
    updatedAt: (v.updatedAt as string | undefined) ?? undefined,
    syncStatus: "synced",
  };

  const existing = await db.tasks
    .where("[did+rkey]")
    .equals([did, rkey])
    .first();
  if (existing?.id) {
    if (existing.syncStatus === "pending") return;
    if (
      !recordsEqual(existing, taskData, [
        "title",
        "description",
        "columnId",
        "parentTaskUri",
        "position",
        "labelIds",
        "order",
        "createdAt",
        "updatedAt",
      ])
    ) {
      await db.tasks.update(existing.id, taskData);
    }
  } else {
    await db.tasks.add(taskData as Task);
  }
}

async function upsertOp(
  did: string,
  rkey: string,
  value: Record<string, unknown>,
  boardUri: string,
): Promise<void> {
  const v = validateRecord(OP_COLLECTION, value);
  if (!v) return;

  const opData: Omit<Op, "id"> = {
    rkey,
    did,
    targetTaskUri: v.targetTaskUri as string,
    boardUri,
    fields: v.fields as OpFields,
    createdAt: v.createdAt as string,
    syncStatus: "synced",
  };

  const existing = await db.ops.where("[did+rkey]").equals([did, rkey]).first();
  if (existing?.id) {
    if (existing.syncStatus === "pending") return;
    if (
      !recordsEqual(existing, opData, ["targetTaskUri", "fields", "createdAt"])
    ) {
      await db.ops.update(existing.id, opData);
    }
  } else {
    await db.ops.add(opData as Op);
  }
}

async function upsertTrust(
  did: string,
  rkey: string,
  value: Record<string, unknown>,
  boardUri: string,
): Promise<void> {
  const v = validateRecord(TRUST_COLLECTION, value);
  if (!v) return;

  const trustData: Omit<Trust, "id"> = {
    rkey,
    did,
    trustedDid: v.trustedDid as string,
    boardUri,
    createdAt: v.createdAt as string,
    syncStatus: "synced",
  };

  const existing = await db.trusts
    .where("[did+boardUri+trustedDid]")
    .equals([did, boardUri, trustData.trustedDid])
    .first();
  if (existing?.id) {
    if (existing.syncStatus === "pending") return;
    if (!recordsEqual(existing, trustData, ["trustedDid", "createdAt"])) {
      await db.trusts.update(existing.id, trustData);
    }
  } else {
    await db.trusts.add(trustData as Trust);
  }
}

async function upsertComment(
  did: string,
  rkey: string,
  value: Record<string, unknown>,
  boardUri: string,
): Promise<void> {
  const v = validateRecord(COMMENT_COLLECTION, value);
  if (!v) return;

  const commentData: Omit<Comment, "id"> = {
    rkey,
    did,
    targetTaskUri: v.targetTaskUri as string,
    boardUri,
    text: v.text as string,
    createdAt: v.createdAt as string,
    updatedAt: (v.updatedAt as string | undefined) ?? undefined,
    syncStatus: "synced",
  };

  const existing = await db.comments
    .where("[did+rkey]")
    .equals([did, rkey])
    .first();
  if (existing?.id) {
    if (existing.syncStatus === "pending") return;
    if (
      !recordsEqual(existing, commentData, [
        "targetTaskUri",
        "text",
        "createdAt",
        "updatedAt",
      ])
    ) {
      await db.comments.update(existing.id, commentData);
    }
  } else {
    await db.comments.add(commentData as Comment);
  }
}

async function upsertApproval(
  did: string,
  rkey: string,
  value: Record<string, unknown>,
  boardUri: string,
): Promise<void> {
  const v = validateRecord(APPROVAL_COLLECTION, value);
  if (!v) return;

  const approvalData: Omit<Approval, "id"> = {
    rkey,
    did,
    targetUri: v.targetUri as string,
    boardUri,
    createdAt: v.createdAt as string,
    syncStatus: "synced",
  };

  const existing = await db.approvals
    .where("[did+rkey]")
    .equals([did, rkey])
    .first();
  if (existing?.id) {
    if (existing.syncStatus === "pending") return;
    if (!recordsEqual(existing, approvalData, ["targetUri", "createdAt"])) {
      await db.approvals.update(existing.id, approvalData);
    }
  } else {
    await db.approvals.add(approvalData as Approval);
  }
}

async function upsertReaction(
  did: string,
  rkey: string,
  value: Record<string, unknown>,
  boardUri: string,
): Promise<void> {
  const v = validateRecord(REACTION_COLLECTION, value);
  if (!v) return;

  const reactionData: Omit<Reaction, "id"> = {
    rkey,
    did,
    targetTaskUri: v.targetTaskUri as string,
    boardUri,
    emoji: v.emoji as string,
    createdAt: v.createdAt as string,
    syncStatus: "synced",
  };

  const existing = await db.reactions
    .where("[did+rkey]")
    .equals([did, rkey])
    .first();
  if (existing?.id) {
    if (existing.syncStatus === "pending") return;
    if (
      !recordsEqual(existing, reactionData, [
        "targetTaskUri",
        "emoji",
        "createdAt",
      ])
    ) {
      await db.reactions.update(existing.id, reactionData);
    }
  } else {
    await db.reactions.add(reactionData as Reaction);
  }
}

type ChildUpsert = (
  did: string,
  rkey: string,
  value: Record<string, unknown>,
  boardUri: string,
) => Promise<void>;

const CHILD_UPSERTS: Record<string, ChildUpsert> = {
  [TASK_COLLECTION]: upsertTask,
  [OP_COLLECTION]: upsertOp,
  [TRUST_COLLECTION]: upsertTrust,
  [COMMENT_COLLECTION]: upsertComment,
  [APPROVAL_COLLECTION]: upsertApproval,
  [REACTION_COLLECTION]: upsertReaction,
};

/**
 * Apply a full board snapshot in one transaction.
 *
 * Records that vanished from a participant's repo are pruned locally, but only
 * for the (did, collection) pairs we successfully listed — the appview never
 * pruned, so deletes by other users used to linger forever.
 */
export async function applyBoardSnapshot(
  ownerDid: string,
  rkey: string,
  boardUri: string,
  snapshot: BoardSnapshot,
): Promise<void> {
  await db.transaction("rw", writeTables(), async () => {
    await upsertBoard(ownerDid, rkey, snapshot.boardValue);

    for (const collection of BOARD_CHILD_COLLECTIONS) {
      const upsert = CHILD_UPSERTS[collection];
      for (const record of snapshot.records.get(collection) ?? []) {
        await upsert(record.did, record.rkey, record.value, boardUri);
      }
    }

    // Prune records that are gone upstream. `seen` and `hydratedDids` are both
    // collection -> did -> ... so each table is scanned at most once.
    const seen = new Map<string, Map<string, Set<string>>>();
    for (const [collection, records] of snapshot.records) {
      const byDid = new Map<string, Set<string>>();
      seen.set(collection, byDid);
      for (const record of records) {
        let rkeys = byDid.get(record.did);
        if (!rkeys) byDid.set(record.did, (rkeys = new Set()));
        rkeys.add(record.rkey);
      }
    }

    const hydratedDids = new Map<string, Set<string>>();
    for (const { did, collection } of snapshot.hydrated) {
      let dids = hydratedDids.get(collection);
      if (!dids) hydratedDids.set(collection, (dids = new Set()));
      dids.add(did);
    }

    for (const [collection, dids] of hydratedDids) {
      const table = childTable(collection);
      if (!table) continue;
      const keep = seen.get(collection);
      const rows = await table.where("boardUri").equals(boardUri).toArray();
      for (const row of rows) {
        if (!dids.has(row.did)) continue;
        if (row.syncStatus !== "synced") continue;
        if (keep?.get(row.did)?.has(row.rkey)) continue;
        if (
          !snapshot.pruneCandidates
            .get(collection)
            ?.has(`${row.did}\0${row.rkey}`)
        )
          continue;
        if (row.id !== undefined) await table.delete(row.id);
      }
    }
  });
}

/**
 * What we already hold locally for a board: which collections have synced rows
 * and which DIDs authored them.
 *
 * The read path unions this into what it fetches. Constellation only knows
 * about records that still exist, so a participant who deleted their last task
 * would otherwise drop out of discovery and their stale local rows would never
 * be pruned.
 */
export async function localBoardFootprint(boardUri: string): Promise<{
  collections: Set<string>;
  dids: Set<string>;
  rows: Map<string, Set<string>>;
}> {
  const collections = new Set<string>();
  const dids = new Set<string>();
  const rowIdentities = new Map<string, Set<string>>();

  await Promise.all(
    BOARD_CHILD_COLLECTIONS.map(async (collection) => {
      const table = childTable(collection);
      if (!table) return;
      const rows = await table.where("boardUri").equals(boardUri).toArray();
      for (const row of rows) {
        if (row.syncStatus !== "synced") continue;
        collections.add(collection);
        dids.add(row.did);
        let identities = rowIdentities.get(collection);
        if (!identities)
          rowIdentities.set(collection, (identities = new Set()));
        identities.add(`${row.did}\0${row.rkey}`);
      }
    }),
  );

  return { collections, dids, rows: rowIdentities };
}

/**
 * Apply a single created/updated record (a Jetstream commit carries the full
 * record body, so no hydration round trip is needed).
 *
 * Returns the affected board URI, or null if the record was ignored.
 */
export async function applyRecordUpsert(
  did: string,
  collection: string,
  rkey: string,
  value: Record<string, unknown>,
): Promise<string | null> {
  if (collection === BOARD_COLLECTION) {
    await db.transaction("rw", [db.boards], async () => {
      await upsertBoard(did, rkey, value);
    });
    return buildAtUri(did, BOARD_COLLECTION, rkey);
  }

  const upsert = CHILD_UPSERTS[collection];
  const boardUri = value.boardUri;
  if (!upsert || typeof boardUri !== "string") return null;

  const table = childTable(collection);
  if (!table) return null;
  await db.transaction("rw", [table], async () => {
    await upsert(did, rkey, value, boardUri);
  });
  return boardUri;
}

/**
 * Delete a record by (did, rkey). Jetstream delete events carry no record
 * body, so the local row is the only source for the board it belonged to;
 * that URI is returned so the caller can decide whether it cared.
 */
export async function applyRecordDelete(
  did: string,
  collection: string,
  rkey: string,
): Promise<string | null> {
  if (collection === BOARD_COLLECTION) {
    const existing = await db.boards.where("rkey").equals(rkey).first();
    if (!existing?.id || existing.did !== did) return null;
    if (existing.syncStatus === "pending") return null;
    await db.boards.delete(existing.id);
    return buildAtUri(did, BOARD_COLLECTION, rkey);
  }

  const table = childTable(collection);
  if (!table) return null;

  const existing = await table.where("[did+rkey]").equals([did, rkey]).first();
  if (!existing?.id) return null;
  if (existing.syncStatus === "pending") return null;
  await table.delete(existing.id);
  return existing.boardUri;
}
