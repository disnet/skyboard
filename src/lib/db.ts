import Dexie, { type EntityTable } from "dexie";
import type {
  Board,
  Task,
  Op,
  Trust,
  Comment,
  KnownParticipant,
} from "./types.js";

type SkyboardDb = Dexie & {
  boards: EntityTable<Board, "id">;
  tasks: EntityTable<Task, "id">;
  ops: EntityTable<Op, "id">;
  trusts: EntityTable<Trust, "id">;
  comments: EntityTable<Comment, "id">;
  knownParticipants: EntityTable<KnownParticipant, "id">;
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
