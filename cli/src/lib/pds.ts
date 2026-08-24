// Board data fetching from Constellation and participant PDSes.

import type { Agent } from "@atproto/api";
import { BOARD_COLLECTION, buildAtUri } from "./tid.js";
import type { Board, Task, Op, OpFields, Trust, Comment } from "./types.js";
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

const CONSTELLATION_URL = "https://constellation.microcosm.blue";
const CHILD_COLLECTIONS = [
  "dev.skyboard.task",
  "dev.skyboard.op",
  "dev.skyboard.trust",
  "dev.skyboard.comment",
] as const;

const pdsCache = new Map<string, string>();

export class BoardReadError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "BoardReadError";
  }
}

/**
 * An identity that does not exist is a different answer from one we failed to
 * look up: the first means the records can't exist, the second means we don't
 * know.
 */
type PdsResolution =
  | { status: "ok"; pds: string }
  | { status: "missing" }
  | { status: "failed"; reason: string };

async function resolvePds(did: string): Promise<PdsResolution> {
  const cached = pdsCache.get(did);
  if (cached) return { status: "ok", pds: cached };

  let url: string;
  if (did.startsWith("did:plc:")) url = `https://plc.directory/${did}`;
  else if (did.startsWith("did:web:")) {
    const host = did.slice("did:web:".length).replaceAll(":", "/");
    url = `https://${host}/.well-known/did.json`;
  } else {
    return { status: "failed", reason: `unsupported DID method in ${did}` };
  }

  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  } catch (error) {
    return {
      status: "failed",
      reason: `${did} could not be looked up: ${errorText(error)}`,
    };
  }
  // 404/410 is the directory saying this identity was never registered or was
  // tombstoned; anything else non-2xx is the directory failing to answer.
  if (res.status === 404 || res.status === 410) return { status: "missing" };
  if (!res.ok) {
    return {
      status: "failed",
      reason: `DID directory returned HTTP ${res.status} for ${did}`,
    };
  }

  let doc: {
    service?: Array<{ id: string; type: string; serviceEndpoint: string }>;
  };
  try {
    doc = (await res.json()) as typeof doc;
  } catch (error) {
    return {
      status: "failed",
      reason: `DID document for ${did} was unreadable: ${errorText(error)}`,
    };
  }
  const service = doc?.service?.find(
    (entry) =>
      entry.id === "#atproto_pds" || entry.type === "AtprotoPersonalDataServer",
  );
  if (typeof service?.serviceEndpoint !== "string") {
    return {
      status: "failed",
      reason: `DID document for ${did} lists no atproto PDS`,
    };
  }
  pdsCache.set(did, service.serviceEndpoint);
  return { status: "ok", pds: service.serviceEndpoint };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Record key syntax from the atproto spec. A key that can't exist is worth
// answering locally: `getRecord` rejects it with the same generic
// `InvalidRequest` a broken request gets, and callers probe with arbitrary
// strings (see `parseBoardRef` in commands/ralph.ts).
const RECORD_KEY_RE = /^[a-zA-Z0-9._:~-]{1,512}$/;

function isValidRecordKey(rkey: string): boolean {
  return rkey !== "." && rkey !== ".." && RECORD_KEY_RE.test(rkey);
}

/**
 * Did the PDS say this record is genuinely absent, as opposed to failing to
 * answer? The reference implementation reports a missing record as HTTP 400
 * `RecordNotFound` and a missing repo as a generic `InvalidRequest`; other
 * implementations use 404. Everything else is a failed read.
 */
async function isRecordMissing(res: Response): Promise<boolean> {
  if (res.status === 404) return true;
  if (res.status !== 400) return false;
  let body: { error?: unknown; message?: unknown };
  try {
    body = (await res.json()) as { error?: unknown; message?: unknown };
  } catch {
    return false;
  }
  const error = typeof body?.error === "string" ? body.error : "";
  if (error === "RecordNotFound" || error === "RepoNotFound") return true;
  const message = typeof body?.message === "string" ? body.message : "";
  return error === "InvalidRequest" && /could not find repo/i.test(message);
}

/**
 * Read one record from a repo. Returns null only when the record, its repo, or
 * the identity that owns it is reported as missing — a resolution failure,
 * transport error, server error, or malformed response raises `BoardReadError`
 * so callers never mistake an unreadable PDS for an empty one.
 */
async function getRecord(
  did: string,
  collection: string,
  rkey: string,
): Promise<Record<string, unknown> | null> {
  if (!isValidRecordKey(rkey)) return null;
  const resolved = await resolvePds(did);
  if (resolved.status === "missing") return null;
  if (resolved.status === "failed") {
    throw new BoardReadError(
      `Could not resolve PDS for ${did}: ${resolved.reason}`,
    );
  }
  const pds = resolved.pds;

  const params = new URLSearchParams({ repo: did, collection, rkey });
  let res: Response;
  try {
    res = await fetch(
      `${pds}/xrpc/com.atproto.repo.getRecord?${params.toString()}`,
      { signal: AbortSignal.timeout(10_000) },
    );
  } catch (error) {
    throw new BoardReadError(
      `Could not read ${collection}/${rkey} from ${did}`,
      { cause: error },
    );
  }

  if (!res.ok) {
    if (await isRecordMissing(res)) return null;
    throw new BoardReadError(
      `PDS returned HTTP ${res.status} while reading ${collection}/${rkey} from ${did}`,
    );
  }

  let data: { value?: unknown };
  try {
    data = (await res.json()) as { value?: unknown };
  } catch (error) {
    throw new BoardReadError(
      `PDS returned an unreadable response for ${collection}/${rkey} from ${did}`,
      { cause: error },
    );
  }
  if (!data || typeof data.value !== "object" || data.value === null) {
    throw new BoardReadError(
      `PDS response for ${collection}/${rkey} from ${did} contained no record`,
    );
  }
  return data.value as Record<string, unknown>;
}

interface RepoRecord {
  did: string;
  rkey: string;
  value: Record<string, unknown>;
}

async function listRecords(
  did: string,
  collection: string,
): Promise<RepoRecord[]> {
  const resolved = await resolvePds(did);
  if (resolved.status !== "ok") {
    // Even a participant whose identity has vanished is a hole in the board:
    // their records may still be referenced, so report rather than skip.
    throw new BoardReadError(
      resolved.status === "failed"
        ? `Could not resolve PDS for ${did}: ${resolved.reason}`
        : `Could not resolve PDS for ${did}: identity not found`,
    );
  }
  const pds = resolved.pds;
  const records: RepoRecord[] = [];
  let cursor: string | undefined;
  try {
    do {
      const params = new URLSearchParams({
        repo: did,
        collection,
        limit: "100",
      });
      if (cursor) params.set("cursor", cursor);
      const res = await fetch(
        `${pds}/xrpc/com.atproto.repo.listRecords?${params.toString()}`,
        { signal: AbortSignal.timeout(10_000) },
      );
      if (!res.ok) {
        throw new BoardReadError(
          `PDS returned HTTP ${res.status} while reading ${collection} from ${did}`,
        );
      }
      const data = (await res.json()) as {
        records?: Array<{ uri: string; value: Record<string, unknown> }>;
        cursor?: string;
      };
      for (const record of data.records ?? []) {
        records.push({
          did,
          rkey: record.uri.split("/").pop()!,
          value: record.value,
        });
      }
      cursor = data.cursor;
    } while (cursor);
  } catch (error) {
    if (error instanceof BoardReadError) throw error;
    throw new BoardReadError(
      `Could not completely read ${collection} from ${did}`,
      { cause: error },
    );
  }
  return records;
}

async function linkingDids(boardUri: string): Promise<Set<string>> {
  const dids = new Set<string>();
  await Promise.all(
    CHILD_COLLECTIONS.map(async (collection) => {
      let cursor: string | undefined;
      do {
        const params = new URLSearchParams({
          target: boardUri,
          collection,
          path: ".boardUri",
          limit: "100",
        });
        if (cursor) params.set("cursor", cursor);
        try {
          const res = await fetch(
            `${CONSTELLATION_URL}/links/distinct-dids?${params.toString()}`,
            { signal: AbortSignal.timeout(10_000) },
          );
          if (!res.ok) {
            throw new BoardReadError(
              `Constellation returned HTTP ${res.status} while discovering ${collection}`,
            );
          }
          const data = (await res.json()) as {
            linking_dids?: string[];
            cursor?: string | null;
          };
          for (const did of data.linking_dids ?? []) dids.add(did);
          cursor = data.cursor ?? undefined;
        } catch (error) {
          if (error instanceof BoardReadError) throw error;
          throw new BoardReadError(
            `Could not completely discover ${collection} participants`,
            { cause: error },
          );
        }
      } while (cursor);
    }),
  );
  return dids;
}

/**
 * Fetch a single board record directly from its owner's PDS. Returns null when
 * the board does not exist; raises `BoardReadError` when it could not be read.
 */
export async function fetchBoardFromPds(
  ownerDid: string,
  rkey: string,
): Promise<Board | null> {
  const value = await getRecord(ownerDid, BOARD_COLLECTION, rkey);
  if (!value) return null;
  const data = safeParse(BoardRecordSchema, value, "BoardRecord");
  if (!data) {
    throw new BoardReadError(
      `Board record ${buildAtUri(ownerDid, BOARD_COLLECTION, rkey)} is not a valid board`,
    );
  }

  return {
    rkey,
    did: ownerDid,
    name: data.name,
    description: data.description,
    columns: data.columns,
    labels: data.labels,
    open: inferOpenFromRecord(value),
    createdAt: data.createdAt,
  };
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
 * Fetch all boards from the authenticated user's PDS (using Agent).
 */
export async function fetchMyBoards(
  agent: Agent,
  did: string,
): Promise<Board[]> {
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

export interface BoardData {
  board: Board;
  tasks: MaterializedTask[];
  trusts: Trust[];
  comments: Comment[];
  allParticipants: string[];
}

/**
 * Fetch all data for a board from Constellation and participant PDSes.
 * Returns null only when the board record itself does not exist; any read that
 * could not be completed raises `BoardReadError` rather than reporting a
 * missing or partial board.
 */
export async function fetchBoardData(
  boardDid: string,
  boardRkey: string,
  currentUserDid: string,
): Promise<BoardData | null> {
  const boardUri = buildAtUri(boardDid, BOARD_COLLECTION, boardRkey);
  const board = await fetchBoardFromPds(boardDid, boardRkey);
  if (!board) return null;

  const dids = await linkingDids(boardUri);
  dids.add(boardDid);
  if (currentUserDid) dids.add(currentUserDid);
  const fetched = await Promise.all(
    [...dids].flatMap((did) =>
      CHILD_COLLECTIONS.map((collection) => listRecords(did, collection)),
    ),
  );
  const records = fetched
    .flat()
    .filter((record) => record.value.boardUri === boardUri);

  const tasks: Task[] = records
    .filter((r) => r.value.$type === "dev.skyboard.task")
    .flatMap(({ did, rkey, value }) => {
      const v = safeParse(TaskRecordSchema, value, "TaskRecord");
      if (!v) return [];
      return [
        {
          rkey,
          did,
          title: v.title,
          description: v.description,
          columnId: v.columnId,
          boardUri,
          parentTaskUri: v.parentTaskUri,
          position: v.position,
          labelIds: v.labelIds,
          order: v.order,
          createdAt: v.createdAt,
          updatedAt: v.updatedAt,
        },
      ];
    });

  const ops: Op[] = records
    .filter((r) => r.value.$type === "dev.skyboard.op")
    .flatMap(({ did, rkey, value }) => {
      const v = safeParse(OpRecordSchema, value, "OpRecord");
      if (!v) return [];
      return [
        {
          rkey,
          did,
          targetTaskUri: v.targetTaskUri,
          boardUri,
          fields: v.fields,
          createdAt: v.createdAt,
        },
      ];
    });

  const trusts: Trust[] = records
    .filter((r) => r.value.$type === "dev.skyboard.trust")
    .flatMap(({ did, rkey, value }) => {
      const v = safeParse(TrustRecordSchema, value, "TrustRecord");
      if (!v) return [];
      return [
        {
          rkey,
          did,
          trustedDid: v.trustedDid,
          boardUri,
          createdAt: v.createdAt,
        },
      ];
    });

  const comments: Comment[] = records
    .filter((r) => r.value.$type === "dev.skyboard.comment")
    .flatMap(({ did, rkey, value }) => {
      const v = safeParse(CommentRecordSchema, value, "CommentRecord");
      if (!v) return [];
      return [
        {
          rkey,
          did,
          targetTaskUri: v.targetTaskUri,
          boardUri,
          text: v.text,
          createdAt: v.createdAt,
        },
      ];
    });

  const trustedDids = new Set(
    trusts.filter((t) => t.did === boardDid).map((t) => t.trustedDid),
  );

  const allParticipants = new Set<string>();
  allParticipants.add(boardDid);
  for (const d of trustedDids) allParticipants.add(d);
  for (const t of tasks) allParticipants.add(t.did);
  for (const o of ops) allParticipants.add(o.did);
  if (currentUserDid) allParticipants.add(currentUserDid);

  const materialized = materializeTasks(
    tasks,
    ops,
    trustedDids,
    currentUserDid,
    boardDid,
  );

  return {
    board,
    tasks: materialized,
    trusts,
    comments,
    allParticipants: [...allParticipants],
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
      const data = (await res.json()) as { did: string };
      return data.did;
    }
  } catch {
    // fall through
  }

  return null;
}
