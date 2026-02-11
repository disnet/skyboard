import Dexie, { type EntityTable } from "dexie";
import type {
  Board,
  Task,
  Op,
  Trust,
  Comment,
  Approval,
  Reaction,
  Block,
  KnownParticipant,
  Notification,
  FilterView,
} from "./types.js";

type SkyboardDb = Dexie & {
  boards: EntityTable<Board, "id">;
  tasks: EntityTable<Task, "id">;
  ops: EntityTable<Op, "id">;
  trusts: EntityTable<Trust, "id">;
  comments: EntityTable<Comment, "id">;
  approvals: EntityTable<Approval, "id">;
  reactions: EntityTable<Reaction, "id">;
  blocks: EntityTable<Block, "id">;
  knownParticipants: EntityTable<KnownParticipant, "id">;
  notifications: EntityTable<Notification, "id">;
  filterViews: EntityTable<FilterView, "id">;
};

function createDb(name: string): SkyboardDb {
  const d = new Dexie(name) as SkyboardDb;

  d.version(1).stores({
    boards: "++id, rkey, did, syncStatus",
    tasks: "++id, rkey, did, columnId, boardUri, order, syncStatus",
  });

  d.version(2).stores({
    boards: "++id, rkey, did, syncStatus",
    tasks: "++id, rkey, did, columnId, boardUri, order, syncStatus, [did+rkey]",
    ops: "++id, rkey, did, targetTaskUri, boardUri, createdAt, syncStatus, [did+rkey]",
    trusts:
      "++id, rkey, did, trustedDid, boardUri, syncStatus, [did+boardUri+trustedDid]",
    knownParticipants: "++id, did, boardUri, [did+boardUri]",
  });

  d.version(3).stores({
    boards: "++id, rkey, did, syncStatus",
    tasks: "++id, rkey, did, columnId, boardUri, order, syncStatus, [did+rkey]",
    ops: "++id, rkey, did, targetTaskUri, boardUri, createdAt, syncStatus, [did+rkey]",
    trusts:
      "++id, rkey, did, trustedDid, boardUri, syncStatus, [did+boardUri+trustedDid], [did+rkey]",
    knownParticipants: "++id, did, boardUri, [did+boardUri]",
  });

  d.version(4).stores({
    boards: "++id, rkey, did, syncStatus",
    tasks: "++id, rkey, did, columnId, boardUri, order, syncStatus, [did+rkey]",
    ops: "++id, rkey, did, targetTaskUri, boardUri, createdAt, syncStatus, [did+rkey]",
    trusts:
      "++id, rkey, did, trustedDid, boardUri, syncStatus, [did+boardUri+trustedDid], [did+rkey]",
    comments:
      "++id, rkey, did, targetTaskUri, boardUri, createdAt, syncStatus, [did+rkey]",
    knownParticipants: "++id, did, boardUri, [did+boardUri]",
  });

  d.version(5)
    .stores({
      boards: "++id, rkey, did, syncStatus",
      tasks: "++id, rkey, did, columnId, boardUri, order, syncStatus, [did+rkey]",
      ops: "++id, rkey, did, targetTaskUri, boardUri, createdAt, syncStatus, [did+rkey]",
      trusts:
        "++id, rkey, did, trustedDid, boardUri, syncStatus, [did+boardUri+trustedDid], [did+rkey]",
      comments:
        "++id, rkey, did, targetTaskUri, boardUri, createdAt, syncStatus, [did+rkey]",
      approvals:
        "++id, rkey, did, targetUri, boardUri, syncStatus, [did+rkey]",
      knownParticipants: "++id, did, boardUri, [did+boardUri]",
    })
    .upgrade((tx) => {
      // Migrate old permissions to the new open/closed model.
      // If any rule had "anyone" scope → set open: true.
      // Then remove the old permissions field.
      return tx
        .table("boards")
        .toCollection()
        .modify((board: Record<string, unknown>) => {
          if (board.permissions && !board.open) {
            const perms = board.permissions as {
              rules?: Array<{ scope?: string }>;
            };
            const hadAnyone = perms.rules?.some(
              (r) => r.scope === "anyone",
            );
            if (hadAnyone) {
              board.open = true;
              board.syncStatus = "pending";
            }
          }
          delete board.permissions;
        });
    });

  d.version(6).stores({
    boards: "++id, rkey, did, syncStatus",
    tasks: "++id, rkey, did, columnId, boardUri, order, syncStatus, [did+rkey]",
    ops: "++id, rkey, did, targetTaskUri, boardUri, createdAt, syncStatus, [did+rkey]",
    trusts:
      "++id, rkey, did, trustedDid, boardUri, syncStatus, [did+boardUri+trustedDid], [did+rkey]",
    comments:
      "++id, rkey, did, targetTaskUri, boardUri, createdAt, syncStatus, [did+rkey]",
    approvals:
      "++id, rkey, did, targetUri, boardUri, syncStatus, [did+rkey]",
    blocks:
      "++id, did, blockedDid, boardUri, [did+boardUri+blockedDid]",
    knownParticipants: "++id, did, boardUri, [did+boardUri]",
  });

  d.version(7).stores({
    boards: "++id, rkey, did, syncStatus",
    tasks: "++id, rkey, did, columnId, boardUri, order, syncStatus, [did+rkey], createdAt",
    ops: "++id, rkey, did, targetTaskUri, boardUri, createdAt, syncStatus, [did+rkey]",
    trusts:
      "++id, rkey, did, trustedDid, boardUri, syncStatus, [did+boardUri+trustedDid], [did+rkey]",
    comments:
      "++id, rkey, did, targetTaskUri, boardUri, createdAt, syncStatus, [did+rkey]",
    approvals:
      "++id, rkey, did, targetUri, boardUri, syncStatus, [did+rkey]",
    blocks:
      "++id, did, blockedDid, boardUri, [did+boardUri+blockedDid]",
    knownParticipants: "++id, did, boardUri, [did+boardUri]",
    notifications:
      "++id, type, boardUri, read, createdAt, dedupeKey, [read+createdAt]",
  });

  d.version(8).stores({
    boards: "++id, rkey, did, syncStatus",
    tasks: "++id, rkey, did, columnId, boardUri, order, syncStatus, [did+rkey], createdAt",
    ops: "++id, rkey, did, targetTaskUri, boardUri, createdAt, syncStatus, [did+rkey]",
    trusts:
      "++id, rkey, did, trustedDid, boardUri, syncStatus, [did+boardUri+trustedDid], [did+rkey]",
    comments:
      "++id, rkey, did, targetTaskUri, boardUri, createdAt, syncStatus, [did+rkey]",
    approvals:
      "++id, rkey, did, targetUri, boardUri, syncStatus, [did+rkey]",
    reactions:
      "++id, rkey, did, targetTaskUri, boardUri, emoji, syncStatus, [did+rkey], [did+targetTaskUri+emoji]",
    blocks:
      "++id, did, blockedDid, boardUri, [did+boardUri+blockedDid]",
    knownParticipants: "++id, did, boardUri, [did+boardUri]",
    notifications:
      "++id, type, boardUri, read, createdAt, dedupeKey, [read+createdAt]",
  });

  d.version(9).stores({
    boards: "++id, rkey, did, syncStatus",
    tasks: "++id, rkey, did, columnId, boardUri, order, syncStatus, [did+rkey], createdAt",
    ops: "++id, rkey, did, targetTaskUri, boardUri, createdAt, syncStatus, [did+rkey]",
    trusts:
      "++id, rkey, did, trustedDid, boardUri, syncStatus, [did+boardUri+trustedDid], [did+rkey]",
    comments:
      "++id, rkey, did, targetTaskUri, boardUri, createdAt, syncStatus, [did+rkey]",
    approvals:
      "++id, rkey, did, targetUri, boardUri, syncStatus, [did+rkey]",
    reactions:
      "++id, rkey, did, targetTaskUri, boardUri, emoji, syncStatus, [did+rkey], [did+targetTaskUri+emoji]",
    blocks:
      "++id, did, blockedDid, boardUri, [did+boardUri+blockedDid]",
    knownParticipants: "++id, did, boardUri, [did+boardUri]",
    notifications:
      "++id, type, boardUri, read, createdAt, dedupeKey, [read+createdAt]",
    filterViews: "++id, boardUri",
  });

  return d;
}

// eslint-disable-next-line import/no-mutable-exports
export let db: SkyboardDb = createDb("skyboard");

export async function openDb(did: string): Promise<void> {
  if (db.isOpen()) {
    db.close();
  }
  db = createDb(`skyboard-${did}`);
  await db.open();
}

export async function closeDb(): Promise<void> {
  if (db.isOpen()) {
    db.close();
  }
  db = createDb("skyboard");
}
