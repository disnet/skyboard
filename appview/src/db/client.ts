import { Database } from "bun:sqlite";
import { readFileSync } from "fs";
import { mkdirSync } from "fs";
import { dirname } from "path";
import { config } from "../config.js";
import { buildAtUri } from "../shared/collections.js";

let _db: Database | null = null;

export function getDb(): Database {
  if (!_db) {
    mkdirSync(dirname(config.dbPath), { recursive: true });
    _db = new Database(config.dbPath);
    _db.exec("PRAGMA journal_mode = WAL");
    _db.exec("PRAGMA foreign_keys = ON");
    _db.exec("PRAGMA busy_timeout = 5000");

    // Run schema migration
    const schemaPath = new URL("schema.sql", import.meta.url).pathname;
    const schema = readFileSync(schemaPath, "utf-8");
    _db.exec(schema);

    // Additive migrations for existing databases
    const migrations = [`ALTER TABLE tasks ADD COLUMN assigneeDid TEXT`];
    for (const sql of migrations) {
      try {
        _db.exec(sql);
      } catch {
        // Column already exists — ignore
      }
    }
  }
  return _db;
}

// --- Board ---

export interface BoardRow {
  uri: string;
  did: string;
  rkey: string;
  name: string;
  description: string | null;
  columns: string;
  labels: string;
  open: number;
  createdAt: string;
}

export function upsertBoard(
  did: string,
  rkey: string,
  record: {
    name: string;
    description?: string;
    columns: unknown[];
    labels?: unknown[];
    open?: boolean;
    createdAt: string;
  },
): void {
  const db = getDb();
  const uri = buildAtUri(did, "dev.skyboard.board", rkey);
  db.run(
    `INSERT INTO boards (uri, did, rkey, name, description, columns, labels, open, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(uri) DO UPDATE SET
       name=excluded.name, description=excluded.description,
       columns=excluded.columns, labels=excluded.labels,
       open=excluded.open, createdAt=excluded.createdAt`,
    [
      uri,
      did,
      rkey,
      record.name,
      record.description ?? null,
      JSON.stringify(record.columns),
      JSON.stringify(record.labels ?? []),
      record.open ? 1 : 0,
      record.createdAt,
    ],
  );
}

export function getBoard(did: string, rkey: string): BoardRow | null {
  const db = getDb();
  const uri = buildAtUri(did, "dev.skyboard.board", rkey);
  return db
    .query<BoardRow, [string]>("SELECT * FROM boards WHERE uri = ?")
    .get(uri);
}

export function getAllBoards(): BoardRow[] {
  const db = getDb();
  return db.query<BoardRow, []>("SELECT * FROM boards").all();
}

export function deleteBoard(did: string, rkey: string): void {
  const db = getDb();
  const uri = buildAtUri(did, "dev.skyboard.board", rkey);
  db.run("DELETE FROM boards WHERE uri = ?", [uri]);
}

// --- Task ---

export interface TaskRow {
  uri: string;
  did: string;
  rkey: string;
  title: string;
  description: string | null;
  columnId: string;
  boardUri: string;
  position: string | null;
  labelIds: string | null;
  assigneeDid: string | null;
  order: number | null;
  createdAt: string;
  updatedAt: string | null;
}

export function upsertTask(
  did: string,
  rkey: string,
  record: {
    title: string;
    description?: string;
    columnId: string;
    boardUri: string;
    position?: string;
    labelIds?: string[];
    assigneeDid?: string;
    order?: number;
    createdAt: string;
    updatedAt?: string;
  },
): void {
  const db = getDb();
  const uri = buildAtUri(did, "dev.skyboard.task", rkey);
  db.run(
    `INSERT INTO tasks (uri, did, rkey, title, description, columnId, boardUri, position, labelIds, assigneeDid, "order", createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(uri) DO UPDATE SET
       title=excluded.title, description=excluded.description,
       columnId=excluded.columnId, boardUri=excluded.boardUri,
       position=excluded.position, labelIds=excluded.labelIds,
       assigneeDid=excluded.assigneeDid,
       "order"=excluded."order", createdAt=excluded.createdAt,
       updatedAt=excluded.updatedAt`,
    [
      uri,
      did,
      rkey,
      record.title,
      record.description ?? null,
      record.columnId,
      record.boardUri,
      record.position ?? null,
      record.labelIds ? JSON.stringify(record.labelIds) : null,
      record.assigneeDid ?? null,
      record.order ?? null,
      record.createdAt,
      record.updatedAt ?? null,
    ],
  );
}

export function getTasksByBoard(boardUri: string): TaskRow[] {
  const db = getDb();
  return db
    .query<TaskRow, [string]>("SELECT * FROM tasks WHERE boardUri = ?")
    .all(boardUri);
}

export function deleteTask(did: string, rkey: string): string | null {
  const db = getDb();
  const uri = buildAtUri(did, "dev.skyboard.task", rkey);
  const existing = db
    .query<
      { boardUri: string },
      [string]
    >("SELECT boardUri FROM tasks WHERE uri = ?")
    .get(uri);
  if (existing) {
    db.run("DELETE FROM tasks WHERE uri = ?", [uri]);
    return existing.boardUri;
  }
  return null;
}

// --- Op ---

export interface OpRow {
  uri: string;
  did: string;
  rkey: string;
  targetTaskUri: string;
  boardUri: string;
  fields: string;
  createdAt: string;
}

export function upsertOp(
  did: string,
  rkey: string,
  record: {
    targetTaskUri: string;
    boardUri: string;
    fields: unknown;
    createdAt: string;
  },
): void {
  const db = getDb();
  const uri = buildAtUri(did, "dev.skyboard.op", rkey);
  db.run(
    `INSERT INTO ops (uri, did, rkey, targetTaskUri, boardUri, fields, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(uri) DO UPDATE SET
       targetTaskUri=excluded.targetTaskUri, boardUri=excluded.boardUri,
       fields=excluded.fields, createdAt=excluded.createdAt`,
    [
      uri,
      did,
      rkey,
      record.targetTaskUri,
      record.boardUri,
      JSON.stringify(record.fields),
      record.createdAt,
    ],
  );
}

export function getOpsByBoard(boardUri: string): OpRow[] {
  const db = getDb();
  return db
    .query<OpRow, [string]>("SELECT * FROM ops WHERE boardUri = ?")
    .all(boardUri);
}

export function deleteOp(did: string, rkey: string): string | null {
  const db = getDb();
  const uri = buildAtUri(did, "dev.skyboard.op", rkey);
  const existing = db
    .query<
      { boardUri: string },
      [string]
    >("SELECT boardUri FROM ops WHERE uri = ?")
    .get(uri);
  if (existing) {
    db.run("DELETE FROM ops WHERE uri = ?", [uri]);
    return existing.boardUri;
  }
  return null;
}

// --- Trust ---

export interface TrustRow {
  uri: string;
  did: string;
  rkey: string;
  trustedDid: string;
  boardUri: string;
  createdAt: string;
}

export function upsertTrust(
  did: string,
  rkey: string,
  record: {
    trustedDid: string;
    boardUri: string;
    createdAt: string;
  },
): void {
  const db = getDb();
  const uri = buildAtUri(did, "dev.skyboard.trust", rkey);
  db.run(
    `INSERT INTO trusts (uri, did, rkey, trustedDid, boardUri, createdAt)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(uri) DO UPDATE SET
       trustedDid=excluded.trustedDid, boardUri=excluded.boardUri,
       createdAt=excluded.createdAt`,
    [uri, did, rkey, record.trustedDid, record.boardUri, record.createdAt],
  );
}

export function getTrustsByBoard(boardUri: string): TrustRow[] {
  const db = getDb();
  return db
    .query<TrustRow, [string]>("SELECT * FROM trusts WHERE boardUri = ?")
    .all(boardUri);
}

export function deleteTrust(did: string, rkey: string): string | null {
  const db = getDb();
  const uri = buildAtUri(did, "dev.skyboard.trust", rkey);
  const existing = db
    .query<
      { boardUri: string },
      [string]
    >("SELECT boardUri FROM trusts WHERE uri = ?")
    .get(uri);
  if (existing) {
    db.run("DELETE FROM trusts WHERE uri = ?", [uri]);
    return existing.boardUri;
  }
  return null;
}

// --- Comment ---

export interface CommentRow {
  uri: string;
  did: string;
  rkey: string;
  targetTaskUri: string;
  boardUri: string;
  text: string;
  createdAt: string;
}

export function upsertComment(
  did: string,
  rkey: string,
  record: {
    targetTaskUri: string;
    boardUri: string;
    text: string;
    createdAt: string;
  },
): void {
  const db = getDb();
  const uri = buildAtUri(did, "dev.skyboard.comment", rkey);
  db.run(
    `INSERT INTO comments (uri, did, rkey, targetTaskUri, boardUri, text, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(uri) DO UPDATE SET
       targetTaskUri=excluded.targetTaskUri, boardUri=excluded.boardUri,
       text=excluded.text, createdAt=excluded.createdAt`,
    [
      uri,
      did,
      rkey,
      record.targetTaskUri,
      record.boardUri,
      record.text,
      record.createdAt,
    ],
  );
}

export function getCommentsByBoard(boardUri: string): CommentRow[] {
  const db = getDb();
  return db
    .query<CommentRow, [string]>("SELECT * FROM comments WHERE boardUri = ?")
    .all(boardUri);
}

export function deleteComment(did: string, rkey: string): string | null {
  const db = getDb();
  const uri = buildAtUri(did, "dev.skyboard.comment", rkey);
  const existing = db
    .query<
      { boardUri: string },
      [string]
    >("SELECT boardUri FROM comments WHERE uri = ?")
    .get(uri);
  if (existing) {
    db.run("DELETE FROM comments WHERE uri = ?", [uri]);
    return existing.boardUri;
  }
  return null;
}

// --- Approval ---

export interface ApprovalRow {
  uri: string;
  did: string;
  rkey: string;
  targetUri: string;
  boardUri: string;
  createdAt: string;
}

export function upsertApproval(
  did: string,
  rkey: string,
  record: {
    targetUri: string;
    boardUri: string;
    createdAt: string;
  },
): void {
  const db = getDb();
  const uri = buildAtUri(did, "dev.skyboard.approval", rkey);
  db.run(
    `INSERT INTO approvals (uri, did, rkey, targetUri, boardUri, createdAt)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(uri) DO UPDATE SET
       targetUri=excluded.targetUri, boardUri=excluded.boardUri,
       createdAt=excluded.createdAt`,
    [uri, did, rkey, record.targetUri, record.boardUri, record.createdAt],
  );
}

export function getApprovalsByBoard(boardUri: string): ApprovalRow[] {
  const db = getDb();
  return db
    .query<ApprovalRow, [string]>("SELECT * FROM approvals WHERE boardUri = ?")
    .all(boardUri);
}

export function deleteApproval(did: string, rkey: string): string | null {
  const db = getDb();
  const uri = buildAtUri(did, "dev.skyboard.approval", rkey);
  const existing = db
    .query<
      { boardUri: string },
      [string]
    >("SELECT boardUri FROM approvals WHERE uri = ?")
    .get(uri);
  if (existing) {
    db.run("DELETE FROM approvals WHERE uri = ?", [uri]);
    return existing.boardUri;
  }
  return null;
}

// --- Reaction ---

export interface ReactionRow {
  uri: string;
  did: string;
  rkey: string;
  targetTaskUri: string;
  boardUri: string;
  emoji: string;
  createdAt: string;
}

export function upsertReaction(
  did: string,
  rkey: string,
  record: {
    targetTaskUri: string;
    boardUri: string;
    emoji: string;
    createdAt: string;
  },
): void {
  const db = getDb();
  const uri = buildAtUri(did, "dev.skyboard.reaction", rkey);
  db.run(
    `INSERT INTO reactions (uri, did, rkey, targetTaskUri, boardUri, emoji, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(uri) DO UPDATE SET
       targetTaskUri=excluded.targetTaskUri, boardUri=excluded.boardUri,
       emoji=excluded.emoji, createdAt=excluded.createdAt`,
    [
      uri,
      did,
      rkey,
      record.targetTaskUri,
      record.boardUri,
      record.emoji,
      record.createdAt,
    ],
  );
}

export function getReactionsByBoard(boardUri: string): ReactionRow[] {
  const db = getDb();
  return db
    .query<ReactionRow, [string]>("SELECT * FROM reactions WHERE boardUri = ?")
    .all(boardUri);
}

export function deleteReaction(did: string, rkey: string): string | null {
  const db = getDb();
  const uri = buildAtUri(did, "dev.skyboard.reaction", rkey);
  const existing = db
    .query<
      { boardUri: string },
      [string]
    >("SELECT boardUri FROM reactions WHERE uri = ?")
    .get(uri);
  if (existing) {
    db.run("DELETE FROM reactions WHERE uri = ?", [uri]);
    return existing.boardUri;
  }
  return null;
}

// --- Board participants ---

export function upsertParticipant(did: string, boardUri: string): void {
  const db = getDb();
  db.run(
    `INSERT INTO board_participants (did, boardUri, discoveredAt)
     VALUES (?, ?, ?)
     ON CONFLICT(did, boardUri) DO NOTHING`,
    [did, boardUri, new Date().toISOString()],
  );
}

export function getParticipants(boardUri: string): string[] {
  const db = getDb();
  return db
    .query<{ did: string }, [string]>(
      "SELECT did FROM board_participants WHERE boardUri = ?",
    )
    .all(boardUri)
    .map((r) => r.did);
}

export function markParticipantFetched(did: string, boardUri: string): void {
  const db = getDb();
  db.run(
    "UPDATE board_participants SET lastFetchedAt = ? WHERE did = ? AND boardUri = ?",
    [new Date().toISOString(), did, boardUri],
  );
}

// --- Jetstream cursor ---

export function getCursor(): number | null {
  const db = getDb();
  const row = db
    .query<
      { cursor: number },
      []
    >("SELECT cursor FROM jetstream_cursor WHERE id = 1")
    .get();
  return row?.cursor ?? null;
}

export function saveCursor(cursor: number): void {
  const db = getDb();
  db.run(
    `INSERT INTO jetstream_cursor (id, cursor) VALUES (1, ?)
     ON CONFLICT(id) DO UPDATE SET cursor = excluded.cursor`,
    [cursor],
  );
}
