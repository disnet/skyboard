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
  status: string | null;
  open: number;
  labelIds: string | null;
  forkedFrom: string | null;
  columnId: string | null;
  boardUri: string | null;
  position: string | null;
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
    status?: string;
    open?: boolean;
    labelIds?: string[];
    forkedFrom?: string;
    columnId?: string;
    boardUri?: string;
    position?: string;
    order?: number;
    createdAt: string;
    updatedAt?: string;
  },
): void {
  const db = getDb();
  const uri = buildAtUri(did, "dev.skyboard.task", rkey);
  db.run(
    `INSERT INTO tasks (uri, did, rkey, title, description, status, open, labelIds, forkedFrom, columnId, boardUri, position, "order", createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(uri) DO UPDATE SET
       title=excluded.title, description=excluded.description,
       status=excluded.status, open=excluded.open,
       labelIds=excluded.labelIds, forkedFrom=excluded.forkedFrom,
       columnId=excluded.columnId, boardUri=excluded.boardUri,
       position=excluded.position, "order"=excluded."order",
       createdAt=excluded.createdAt, updatedAt=excluded.updatedAt`,
    [
      uri,
      did,
      rkey,
      record.title,
      record.description ?? null,
      record.status ?? null,
      record.open ? 1 : 0,
      record.labelIds ? JSON.stringify(record.labelIds) : null,
      record.forkedFrom ?? null,
      record.columnId ?? null,
      record.boardUri ?? null,
      record.position ?? null,
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

export function getTaskByUri(taskUri: string): TaskRow | null {
  const db = getDb();
  return db
    .query<TaskRow, [string]>("SELECT * FROM tasks WHERE uri = ?")
    .get(taskUri);
}

export function getTasksByUris(taskUris: string[]): TaskRow[] {
  if (taskUris.length === 0) return [];
  const db = getDb();
  const placeholders = taskUris.map(() => "?").join(",");
  return db
    .query<
      TaskRow,
      string[]
    >(`SELECT * FROM tasks WHERE uri IN (${placeholders})`)
    .all(...taskUris);
}

export function deleteTask(did: string, rkey: string): string | null {
  const db = getDb();
  const uri = buildAtUri(did, "dev.skyboard.task", rkey);
  const existing = db
    .query<
      { boardUri: string | null },
      [string]
    >("SELECT boardUri FROM tasks WHERE uri = ?")
    .get(uri);
  if (existing) {
    db.run("DELETE FROM tasks WHERE uri = ?", [uri]);
    return existing.boardUri ?? null;
  }
  return null;
}

// --- Op (legacy combined op) ---

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

// --- Trust (board-level) ---

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
  boardUri: string | null;
  text: string;
  createdAt: string;
}

export function upsertComment(
  did: string,
  rkey: string,
  record: {
    targetTaskUri: string;
    boardUri?: string;
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
      record.boardUri ?? null,
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

export function getCommentsByTaskUri(targetTaskUri: string): CommentRow[] {
  const db = getDb();
  return db
    .query<
      CommentRow,
      [string]
    >("SELECT * FROM comments WHERE targetTaskUri = ?")
    .all(targetTaskUri);
}

export function deleteComment(did: string, rkey: string): string | null {
  const db = getDb();
  const uri = buildAtUri(did, "dev.skyboard.comment", rkey);
  const existing = db
    .query<
      { boardUri: string | null },
      [string]
    >("SELECT boardUri FROM comments WHERE uri = ?")
    .get(uri);
  if (existing) {
    db.run("DELETE FROM comments WHERE uri = ?", [uri]);
    return existing.boardUri ?? null;
  }
  return null;
}

// --- Approval ---

export interface ApprovalRow {
  uri: string;
  did: string;
  rkey: string;
  targetUri: string;
  boardUri: string | null;
  taskUri: string | null;
  createdAt: string;
}

export function upsertApproval(
  did: string,
  rkey: string,
  record: {
    targetUri: string;
    boardUri?: string;
    taskUri?: string;
    createdAt: string;
  },
): void {
  const db = getDb();
  const uri = buildAtUri(did, "dev.skyboard.approval", rkey);
  db.run(
    `INSERT INTO approvals (uri, did, rkey, targetUri, boardUri, taskUri, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(uri) DO UPDATE SET
       targetUri=excluded.targetUri, boardUri=excluded.boardUri,
       taskUri=excluded.taskUri, createdAt=excluded.createdAt`,
    [
      uri,
      did,
      rkey,
      record.targetUri,
      record.boardUri ?? null,
      record.taskUri ?? null,
      record.createdAt,
    ],
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
      { boardUri: string | null },
      [string]
    >("SELECT boardUri FROM approvals WHERE uri = ?")
    .get(uri);
  if (existing) {
    db.run("DELETE FROM approvals WHERE uri = ?", [uri]);
    return existing.boardUri ?? null;
  }
  return null;
}

// --- Reaction ---

export interface ReactionRow {
  uri: string;
  did: string;
  rkey: string;
  targetTaskUri: string;
  boardUri: string | null;
  emoji: string;
  createdAt: string;
}

export function upsertReaction(
  did: string,
  rkey: string,
  record: {
    targetTaskUri: string;
    boardUri?: string;
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
      record.boardUri ?? null,
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
      { boardUri: string | null },
      [string]
    >("SELECT boardUri FROM reactions WHERE uri = ?")
    .get(uri);
  if (existing) {
    db.run("DELETE FROM reactions WHERE uri = ?", [uri]);
    return existing.boardUri ?? null;
  }
  return null;
}

// --- Placement (new) ---

export interface PlacementRow {
  uri: string;
  did: string;
  rkey: string;
  taskUri: string;
  boardUri: string;
  columnId: string;
  position: string;
  createdAt: string;
}

export function upsertPlacement(
  did: string,
  rkey: string,
  record: {
    taskUri: string;
    boardUri: string;
    columnId: string;
    position: string;
    createdAt: string;
  },
): void {
  const db = getDb();
  const uri = buildAtUri(did, "dev.skyboard.placement", rkey);
  db.run(
    `INSERT INTO placements (uri, did, rkey, taskUri, boardUri, columnId, position, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(uri) DO UPDATE SET
       taskUri=excluded.taskUri, boardUri=excluded.boardUri,
       columnId=excluded.columnId, position=excluded.position,
       createdAt=excluded.createdAt`,
    [
      uri,
      did,
      rkey,
      record.taskUri,
      record.boardUri,
      record.columnId,
      record.position,
      record.createdAt,
    ],
  );
}

export function getPlacementsByBoard(boardUri: string): PlacementRow[] {
  const db = getDb();
  return db
    .query<
      PlacementRow,
      [string]
    >("SELECT * FROM placements WHERE boardUri = ?")
    .all(boardUri);
}

export function deletePlacement(did: string, rkey: string): string | null {
  const db = getDb();
  const uri = buildAtUri(did, "dev.skyboard.placement", rkey);
  const existing = db
    .query<
      { boardUri: string },
      [string]
    >("SELECT boardUri FROM placements WHERE uri = ?")
    .get(uri);
  if (existing) {
    db.run("DELETE FROM placements WHERE uri = ?", [uri]);
    return existing.boardUri;
  }
  return null;
}

// --- PlacementOp (new) ---

export interface PlacementOpRow {
  uri: string;
  did: string;
  rkey: string;
  targetPlacementUri: string;
  boardUri: string;
  fields: string;
  createdAt: string;
}

export function upsertPlacementOp(
  did: string,
  rkey: string,
  record: {
    targetPlacementUri: string;
    boardUri: string;
    fields: unknown;
    createdAt: string;
  },
): void {
  const db = getDb();
  const uri = buildAtUri(did, "dev.skyboard.placementOp", rkey);
  db.run(
    `INSERT INTO placement_ops (uri, did, rkey, targetPlacementUri, boardUri, fields, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(uri) DO UPDATE SET
       targetPlacementUri=excluded.targetPlacementUri, boardUri=excluded.boardUri,
       fields=excluded.fields, createdAt=excluded.createdAt`,
    [
      uri,
      did,
      rkey,
      record.targetPlacementUri,
      record.boardUri,
      JSON.stringify(record.fields),
      record.createdAt,
    ],
  );
}

export function getPlacementOpsByBoard(boardUri: string): PlacementOpRow[] {
  const db = getDb();
  return db
    .query<
      PlacementOpRow,
      [string]
    >("SELECT * FROM placement_ops WHERE boardUri = ?")
    .all(boardUri);
}

export function deletePlacementOp(did: string, rkey: string): string | null {
  const db = getDb();
  const uri = buildAtUri(did, "dev.skyboard.placementOp", rkey);
  const existing = db
    .query<
      { boardUri: string },
      [string]
    >("SELECT boardUri FROM placement_ops WHERE uri = ?")
    .get(uri);
  if (existing) {
    db.run("DELETE FROM placement_ops WHERE uri = ?", [uri]);
    return existing.boardUri;
  }
  return null;
}

// --- TaskOp (new) ---

export interface TaskOpRow {
  uri: string;
  did: string;
  rkey: string;
  targetTaskUri: string;
  fields: string;
  createdAt: string;
}

export function upsertTaskOp(
  did: string,
  rkey: string,
  record: {
    targetTaskUri: string;
    fields: unknown;
    createdAt: string;
  },
): void {
  const db = getDb();
  const uri = buildAtUri(did, "dev.skyboard.taskOp", rkey);
  db.run(
    `INSERT INTO task_ops (uri, did, rkey, targetTaskUri, fields, createdAt)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(uri) DO UPDATE SET
       targetTaskUri=excluded.targetTaskUri,
       fields=excluded.fields, createdAt=excluded.createdAt`,
    [
      uri,
      did,
      rkey,
      record.targetTaskUri,
      JSON.stringify(record.fields),
      record.createdAt,
    ],
  );
}

export function getTaskOpsByTaskUri(targetTaskUri: string): TaskOpRow[] {
  const db = getDb();
  return db
    .query<
      TaskOpRow,
      [string]
    >("SELECT * FROM task_ops WHERE targetTaskUri = ?")
    .all(targetTaskUri);
}

export function getTaskOpsByTaskUris(taskUris: string[]): TaskOpRow[] {
  if (taskUris.length === 0) return [];
  const db = getDb();
  const placeholders = taskUris.map(() => "?").join(",");
  return db
    .query<
      TaskOpRow,
      string[]
    >(`SELECT * FROM task_ops WHERE targetTaskUri IN (${placeholders})`)
    .all(...taskUris);
}

export function deleteTaskOp(did: string, rkey: string): string | null {
  const db = getDb();
  const uri = buildAtUri(did, "dev.skyboard.taskOp", rkey);
  const existing = db
    .query<
      { targetTaskUri: string },
      [string]
    >("SELECT targetTaskUri FROM task_ops WHERE uri = ?")
    .get(uri);
  if (existing) {
    db.run("DELETE FROM task_ops WHERE uri = ?", [uri]);
    return existing.targetTaskUri;
  }
  return null;
}

// --- TaskTrust (new) ---

export interface TaskTrustRow {
  uri: string;
  did: string;
  rkey: string;
  taskUri: string;
  trustedDid: string;
  createdAt: string;
}

export function upsertTaskTrust(
  did: string,
  rkey: string,
  record: {
    taskUri: string;
    trustedDid: string;
    createdAt: string;
  },
): void {
  const db = getDb();
  const uri = buildAtUri(did, "dev.skyboard.taskTrust", rkey);
  db.run(
    `INSERT INTO task_trusts (uri, did, rkey, taskUri, trustedDid, createdAt)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(uri) DO UPDATE SET
       taskUri=excluded.taskUri, trustedDid=excluded.trustedDid,
       createdAt=excluded.createdAt`,
    [uri, did, rkey, record.taskUri, record.trustedDid, record.createdAt],
  );
}

export function getTaskTrustsByTaskUri(taskUri: string): TaskTrustRow[] {
  const db = getDb();
  return db
    .query<
      TaskTrustRow,
      [string]
    >("SELECT * FROM task_trusts WHERE taskUri = ?")
    .all(taskUri);
}

export function deleteTaskTrust(did: string, rkey: string): string | null {
  const db = getDb();
  const uri = buildAtUri(did, "dev.skyboard.taskTrust", rkey);
  const existing = db
    .query<
      { taskUri: string },
      [string]
    >("SELECT taskUri FROM task_trusts WHERE uri = ?")
    .get(uri);
  if (existing) {
    db.run("DELETE FROM task_trusts WHERE uri = ?", [uri]);
    return existing.taskUri;
  }
  return null;
}

// --- Project (new) ---

export interface ProjectRow {
  uri: string;
  did: string;
  rkey: string;
  name: string;
  description: string | null;
  labels: string;
  open: number;
  createdAt: string;
}

export function upsertProject(
  did: string,
  rkey: string,
  record: {
    name: string;
    description?: string;
    labels?: unknown[];
    open?: boolean;
    createdAt: string;
  },
): void {
  const db = getDb();
  const uri = buildAtUri(did, "dev.skyboard.project", rkey);
  db.run(
    `INSERT INTO projects (uri, did, rkey, name, description, labels, open, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(uri) DO UPDATE SET
       name=excluded.name, description=excluded.description,
       labels=excluded.labels, open=excluded.open,
       createdAt=excluded.createdAt`,
    [
      uri,
      did,
      rkey,
      record.name,
      record.description ?? null,
      JSON.stringify(record.labels ?? []),
      record.open ? 1 : 0,
      record.createdAt,
    ],
  );
}

export function getProject(did: string, rkey: string): ProjectRow | null {
  const db = getDb();
  const uri = buildAtUri(did, "dev.skyboard.project", rkey);
  return db
    .query<ProjectRow, [string]>("SELECT * FROM projects WHERE uri = ?")
    .get(uri);
}

export function deleteProject(did: string, rkey: string): void {
  const db = getDb();
  const uri = buildAtUri(did, "dev.skyboard.project", rkey);
  db.run("DELETE FROM projects WHERE uri = ?", [uri]);
}

// --- Membership (new) ---

export interface MembershipRow {
  uri: string;
  did: string;
  rkey: string;
  taskUri: string;
  projectUri: string;
  createdAt: string;
}

export function upsertMembership(
  did: string,
  rkey: string,
  record: {
    taskUri: string;
    projectUri: string;
    createdAt: string;
  },
): void {
  const db = getDb();
  const uri = buildAtUri(did, "dev.skyboard.membership", rkey);
  db.run(
    `INSERT INTO memberships (uri, did, rkey, taskUri, projectUri, createdAt)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(uri) DO UPDATE SET
       taskUri=excluded.taskUri, projectUri=excluded.projectUri,
       createdAt=excluded.createdAt`,
    [uri, did, rkey, record.taskUri, record.projectUri, record.createdAt],
  );
}

export function getMembershipsByProject(projectUri: string): MembershipRow[] {
  const db = getDb();
  return db
    .query<
      MembershipRow,
      [string]
    >("SELECT * FROM memberships WHERE projectUri = ?")
    .all(projectUri);
}

export function deleteMembership(did: string, rkey: string): string | null {
  const db = getDb();
  const uri = buildAtUri(did, "dev.skyboard.membership", rkey);
  const existing = db
    .query<
      { projectUri: string },
      [string]
    >("SELECT projectUri FROM memberships WHERE uri = ?")
    .get(uri);
  if (existing) {
    db.run("DELETE FROM memberships WHERE uri = ?", [uri]);
    return existing.projectUri;
  }
  return null;
}

// --- Assignment (new) ---

export interface AssignmentRow {
  uri: string;
  did: string;
  rkey: string;
  taskUri: string;
  assigneeDid: string;
  createdAt: string;
}

export function upsertAssignment(
  did: string,
  rkey: string,
  record: {
    taskUri: string;
    assigneeDid: string;
    createdAt: string;
  },
): void {
  const db = getDb();
  const uri = buildAtUri(did, "dev.skyboard.assignment", rkey);
  db.run(
    `INSERT INTO assignments (uri, did, rkey, taskUri, assigneeDid, createdAt)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(uri) DO UPDATE SET
       taskUri=excluded.taskUri, assigneeDid=excluded.assigneeDid,
       createdAt=excluded.createdAt`,
    [uri, did, rkey, record.taskUri, record.assigneeDid, record.createdAt],
  );
}

export function getAssignmentsByTaskUri(taskUri: string): AssignmentRow[] {
  const db = getDb();
  return db
    .query<
      AssignmentRow,
      [string]
    >("SELECT * FROM assignments WHERE taskUri = ?")
    .all(taskUri);
}

export function deleteAssignment(did: string, rkey: string): string | null {
  const db = getDb();
  const uri = buildAtUri(did, "dev.skyboard.assignment", rkey);
  const existing = db
    .query<
      { taskUri: string },
      [string]
    >("SELECT taskUri FROM assignments WHERE uri = ?")
    .get(uri);
  if (existing) {
    db.run("DELETE FROM assignments WHERE uri = ?", [uri]);
    return existing.taskUri;
  }
  return null;
}

// --- ProjectTrust (new) ---

export interface ProjectTrustRow {
  uri: string;
  did: string;
  rkey: string;
  projectUri: string;
  trustedDid: string;
  createdAt: string;
}

export function upsertProjectTrust(
  did: string,
  rkey: string,
  record: {
    projectUri: string;
    trustedDid: string;
    createdAt: string;
  },
): void {
  const db = getDb();
  const uri = buildAtUri(did, "dev.skyboard.projectTrust", rkey);
  db.run(
    `INSERT INTO project_trusts (uri, did, rkey, projectUri, trustedDid, createdAt)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(uri) DO UPDATE SET
       projectUri=excluded.projectUri, trustedDid=excluded.trustedDid,
       createdAt=excluded.createdAt`,
    [uri, did, rkey, record.projectUri, record.trustedDid, record.createdAt],
  );
}

export function getProjectTrustsByProject(
  projectUri: string,
): ProjectTrustRow[] {
  const db = getDb();
  return db
    .query<
      ProjectTrustRow,
      [string]
    >("SELECT * FROM project_trusts WHERE projectUri = ?")
    .all(projectUri);
}

export function deleteProjectTrust(did: string, rkey: string): string | null {
  const db = getDb();
  const uri = buildAtUri(did, "dev.skyboard.projectTrust", rkey);
  const existing = db
    .query<
      { projectUri: string },
      [string]
    >("SELECT projectUri FROM project_trusts WHERE uri = ?")
    .get(uri);
  if (existing) {
    db.run("DELETE FROM project_trusts WHERE uri = ?", [uri]);
    return existing.projectUri;
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
