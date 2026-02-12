// PDS fetch helpers — adapted from src/lib/remote-sync.ts for Node.js
// Returns data in memory instead of writing to IndexedDB

import type { Agent } from "@atproto/api";
import {
  BOARD_COLLECTION,
  TASK_COLLECTION,
  OP_COLLECTION,
  TRUST_COLLECTION,
  COMMENT_COLLECTION,
  buildAtUri,
} from "./tid.js";
import type { Board, Task, Op, Trust, Comment } from "./types.js";
import {
  safeParse,
  BoardRecordSchema,
  TaskRecordSchema,
  OpRecordSchema,
  TrustRecordSchema,
  CommentRecordSchema,
} from "./schemas.js";
import { materializeTasks } from "./materialize.js";
import type { MaterializedTask } from "./types.js";

// Cache resolved PDS endpoints
const pdsCache = new Map<string, string>();

export async function resolvePDS(did: string): Promise<string | null> {
  const cached = pdsCache.get(did);
  if (cached) return cached;

  try {
    let didDoc: Record<string, unknown>;

    if (did.startsWith("did:plc:")) {
      const res = await fetch(`https://plc.directory/${did}`);
      if (!res.ok) return null;
      didDoc = await res.json() as Record<string, unknown>;
    } else if (did.startsWith("did:web:")) {
      const host = did.slice("did:web:".length).replaceAll(":", "/");
      const res = await fetch(`https://${host}/.well-known/did.json`);
      if (!res.ok) return null;
      didDoc = await res.json() as Record<string, unknown>;
    } else {
      return null;
    }

    const services = didDoc.service as
      | Array<{ id: string; type: string; serviceEndpoint: string }>
      | undefined;
    const pds = services?.find(
      (s) => s.id === "#atproto_pds" || s.type === "AtprotoPersonalDataServer",
    );
    if (!pds?.serviceEndpoint) return null;

    pdsCache.set(did, pds.serviceEndpoint);
    return pds.serviceEndpoint;
  } catch {
    return null;
  }
}

async function fetchRecordsFromRepo(
  repoDid: string,
  collection: string,
): Promise<Array<{ uri: string; value: Record<string, unknown> }>> {
  const pds = await resolvePDS(repoDid);
  if (!pds) return [];

  const records: Array<{ uri: string; value: Record<string, unknown> }> = [];
  let cursor: string | undefined;

  do {
    const params = new URLSearchParams({
      repo: repoDid,
      collection,
      limit: "100",
    });
    if (cursor) params.set("cursor", cursor);

    const res = await fetch(
      `${pds}/xrpc/com.atproto.repo.listRecords?${params.toString()}`,
    );
    if (!res.ok) break;

    const data = await res.json() as { records?: Array<{ uri: string; value: Record<string, unknown> }>; cursor?: string };
    records.push(...(data.records ?? []));
    cursor = data.cursor;
  } while (cursor);

  return records;
}

function inferOpenFromRecord(
  value: Record<string, unknown>,
): boolean | undefined {
  if (value.open !== undefined) return (value.open as boolean) || undefined;
  const perms = value.permissions as
    | { rules?: Array<{ scope?: string }> }
    | undefined;
  if (perms?.rules?.some((r) => r.scope === "anyone")) return true;
  return undefined;
}

/**
 * Fetch a single board record from the owner's PDS.
 */
export async function fetchBoard(
  ownerDid: string,
  rkey: string,
): Promise<Board | null> {
  try {
    const pds = await resolvePDS(ownerDid);
    if (!pds) return null;

    const params = new URLSearchParams({
      repo: ownerDid,
      collection: BOARD_COLLECTION,
      rkey,
    });
    const res = await fetch(
      `${pds}/xrpc/com.atproto.repo.getRecord?${params.toString()}`,
    );
    if (!res.ok) return null;

    const data = await res.json() as { value: Record<string, unknown> };
    const value = data.value;

    const validated = safeParse(BoardRecordSchema, value, "BoardRecord");
    if (!validated) return null;

    return {
      rkey,
      did: ownerDid,
      name: validated.name,
      description: validated.description,
      columns: validated.columns,
      labels: validated.labels,
      open: inferOpenFromRecord(value),
      createdAt: validated.createdAt,
    };
  } catch {
    return null;
  }
}

/**
 * Fetch all boards owned by a DID.
 */
export async function fetchBoards(ownerDid: string): Promise<Board[]> {
  const records = await fetchRecordsFromRepo(ownerDid, BOARD_COLLECTION);
  const boards: Board[] = [];

  for (const record of records) {
    const validated = safeParse(BoardRecordSchema, record.value, "BoardRecord");
    if (!validated) continue;
    const rkey = record.uri.split("/").pop()!;
    boards.push({
      rkey,
      did: ownerDid,
      name: validated.name,
      description: validated.description,
      columns: validated.columns,
      labels: validated.labels,
      open: inferOpenFromRecord(record.value),
      createdAt: validated.createdAt,
    });
  }

  return boards;
}

/**
 * Fetch all boards from the authenticated user's PDS (using Agent).
 */
export async function fetchMyBoards(agent: Agent, did: string): Promise<Board[]> {
  const boards: Board[] = [];
  let cursor: string | undefined;

  do {
    const res = await agent.com.atproto.repo.listRecords({
      repo: did,
      collection: BOARD_COLLECTION,
      limit: 100,
      cursor,
    });

    for (const record of res.data.records) {
      const rkey = record.uri.split("/").pop()!;
      const value = record.value as Record<string, unknown>;
      const validated = safeParse(BoardRecordSchema, value, "BoardRecord");
      if (!validated) continue;

      boards.push({
        rkey,
        did,
        name: validated.name,
        description: validated.description,
        columns: validated.columns,
        labels: validated.labels,
        open: inferOpenFromRecord(value),
        createdAt: validated.createdAt,
      });
    }

    cursor = res.data.cursor;
  } while (cursor);

  return boards;
}

/**
 * Fetch tasks from a participant's repo for a specific board.
 */
export async function fetchTasks(
  participantDid: string,
  boardUri: string,
): Promise<Task[]> {
  const records = await fetchRecordsFromRepo(participantDid, TASK_COLLECTION);
  const tasks: Task[] = [];

  for (const record of records) {
    if (record.value.boardUri !== boardUri) continue;
    const validated = safeParse(TaskRecordSchema, record.value, "TaskRecord");
    if (!validated) continue;
    const rkey = record.uri.split("/").pop()!;
    tasks.push({
      rkey,
      did: participantDid,
      title: validated.title,
      description: validated.description,
      columnId: validated.columnId,
      boardUri,
      position: validated.position,
      labelIds: validated.labelIds,
      order: validated.order,
      createdAt: validated.createdAt,
      updatedAt: validated.updatedAt,
    });
  }

  return tasks;
}

/**
 * Fetch ops from a participant's repo for a specific board.
 */
export async function fetchOps(
  participantDid: string,
  boardUri: string,
): Promise<Op[]> {
  const records = await fetchRecordsFromRepo(participantDid, OP_COLLECTION);
  const ops: Op[] = [];

  for (const record of records) {
    if (record.value.boardUri !== boardUri) continue;
    const validated = safeParse(OpRecordSchema, record.value, "OpRecord");
    if (!validated) continue;
    const rkey = record.uri.split("/").pop()!;
    ops.push({
      rkey,
      did: participantDid,
      targetTaskUri: validated.targetTaskUri,
      boardUri,
      fields: validated.fields,
      createdAt: validated.createdAt,
    });
  }

  return ops;
}

/**
 * Fetch trusts from the board owner's repo for a specific board.
 */
export async function fetchTrusts(
  ownerDid: string,
  boardUri: string,
): Promise<Trust[]> {
  const records = await fetchRecordsFromRepo(ownerDid, TRUST_COLLECTION);
  const trusts: Trust[] = [];

  for (const record of records) {
    if (record.value.boardUri !== boardUri) continue;
    const validated = safeParse(TrustRecordSchema, record.value, "TrustRecord");
    if (!validated) continue;
    const rkey = record.uri.split("/").pop()!;
    trusts.push({
      rkey,
      did: ownerDid,
      trustedDid: validated.trustedDid,
      boardUri,
      createdAt: validated.createdAt,
    });
  }

  return trusts;
}

/**
 * Fetch comments from a participant's repo for a specific board.
 */
export async function fetchComments(
  participantDid: string,
  boardUri: string,
): Promise<Comment[]> {
  const records = await fetchRecordsFromRepo(participantDid, COMMENT_COLLECTION);
  const comments: Comment[] = [];

  for (const record of records) {
    if (record.value.boardUri !== boardUri) continue;
    const validated = safeParse(CommentRecordSchema, record.value, "CommentRecord");
    if (!validated) continue;
    const rkey = record.uri.split("/").pop()!;
    comments.push({
      rkey,
      did: participantDid,
      targetTaskUri: validated.targetTaskUri,
      boardUri,
      text: validated.text,
      createdAt: validated.createdAt,
    });
  }

  return comments;
}

export interface BoardData {
  board: Board;
  tasks: MaterializedTask[];
  trusts: Trust[];
  comments: Comment[];
  allParticipants: string[];
}

/**
 * Fetch all data for a board: board record, trusts, tasks, ops from all
 * participants, materialize tasks. This is the main "load board" function.
 */
export async function fetchBoardData(
  boardDid: string,
  boardRkey: string,
  currentUserDid: string,
): Promise<BoardData | null> {
  const boardUri = buildAtUri(boardDid, BOARD_COLLECTION, boardRkey);

  // Fetch board
  const board = await fetchBoard(boardDid, boardRkey);
  if (!board) return null;

  // Fetch trusts to discover all participants
  const trusts = await fetchTrusts(boardDid, boardUri);
  const trustedDids = new Set(trusts.map((t) => t.trustedDid));

  // All participants: owner + trusted DIDs + current user
  const allParticipants = new Set<string>();
  allParticipants.add(boardDid);
  for (const did of trustedDids) allParticipants.add(did);
  if (currentUserDid) allParticipants.add(currentUserDid);

  // Fetch tasks + ops from all participants in parallel (batches of 3)
  const participantList = [...allParticipants];
  let allTasks: Task[] = [];
  let allOps: Op[] = [];
  let allComments: Comment[] = [];

  const concurrency = 3;
  for (let i = 0; i < participantList.length; i += concurrency) {
    const batch = participantList.slice(i, i + concurrency);

    const taskPromises = batch.map((did) => fetchTasks(did, boardUri));
    const opPromises = batch.map((did) => fetchOps(did, boardUri));
    const commentPromises = batch.map((did) => fetchComments(did, boardUri));

    const [taskResults, opResults, commentResults] = await Promise.all([
      Promise.allSettled(taskPromises),
      Promise.allSettled(opPromises),
      Promise.allSettled(commentPromises),
    ]);

    for (const r of taskResults) {
      if (r.status === "fulfilled") allTasks.push(...r.value);
    }
    for (const r of opResults) {
      if (r.status === "fulfilled") allOps.push(...r.value);
    }
    for (const r of commentResults) {
      if (r.status === "fulfilled") allComments.push(...r.value);
    }
  }

  // Materialize tasks
  const materialized = materializeTasks(
    allTasks,
    allOps,
    trustedDids,
    currentUserDid,
    boardDid,
  );

  return {
    board,
    tasks: materialized,
    trusts,
    comments: allComments,
    allParticipants: participantList,
  };
}

/**
 * Resolve a handle to a DID.
 */
export async function resolveHandle(handle: string): Promise<string | null> {
  // Try .well-known first
  try {
    const res = await fetch(`https://${handle}/.well-known/atproto-did`);
    if (res.ok) {
      const text = (await res.text()).trim();
      if (text.startsWith("did:")) return text;
    }
  } catch {
    // fall through
  }

  // Try bsky.social resolution
  try {
    const params = new URLSearchParams({ handle });
    const res = await fetch(
      `https://bsky.social/xrpc/com.atproto.identity.resolveHandle?${params.toString()}`,
    );
    if (res.ok) {
      const data = await res.json() as { did: string };
      return data.did;
    }
  } catch {
    // fall through
  }

  return null;
}
