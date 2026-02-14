// Board data fetching — uses the appview for board data,
// PDS only for listing the user's own boards.

import type { Agent } from "@atproto/api";
import {
  BOARD_COLLECTION,
  buildAtUri,
} from "./tid.js";
import type { Board, Task, Op, OpFields, Trust, Comment } from "./types.js";
import {
  safeParse,
  BoardRecordSchema,
} from "./schemas.js";
import { materializeTasks } from "./materialize.js";
import type { MaterializedTask } from "./types.js";

const APPVIEW_URL = "https://appview.skyboard.dev";

interface AppviewBoardResponse {
  board: {
    rkey: string;
    did: string;
    name: string;
    description?: string | null;
    columns: Board["columns"];
    labels?: Board["labels"];
    open?: boolean;
    createdAt: string;
  };
  rawTasks?: Array<{
    rkey: string;
    did: string;
    title: string;
    description?: string | null;
    columnId: string;
    boardUri: string;
    position?: string | null;
    labelIds?: string[] | null;
    order?: number | null;
    createdAt: string;
    updatedAt?: string | null;
  }>;
  rawOps?: Array<{
    rkey: string;
    did: string;
    targetTaskUri: string;
    boardUri: string;
    fields: OpFields;
    createdAt: string;
  }>;
  trusts?: Array<{
    rkey: string;
    did: string;
    trustedDid: string;
    createdAt: string;
  }>;
  comments?: Array<{
    rkey: string;
    did: string;
    targetTaskUri: string;
    text: string;
    createdAt: string;
  }>;
}

/**
 * Fetch a single board record from the appview.
 */
export async function fetchBoardFromAppview(
  ownerDid: string,
  rkey: string,
): Promise<Board | null> {
  try {
    const res = await fetch(`${APPVIEW_URL}/board/${ownerDid}/${rkey}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;

    const data = (await res.json()) as AppviewBoardResponse;

    return {
      rkey: data.board.rkey,
      did: data.board.did,
      name: data.board.name,
      description: data.board.description ?? undefined,
      columns: data.board.columns,
      labels: data.board.labels,
      open: data.board.open || undefined,
      createdAt: data.board.createdAt,
    };
  } catch {
    return null;
  }
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

export interface BoardData {
  board: Board;
  tasks: MaterializedTask[];
  trusts: Trust[];
  comments: Comment[];
  allParticipants: string[];
}

/**
 * Fetch all data for a board from the appview (single HTTP request).
 */
export async function fetchBoardData(
  boardDid: string,
  boardRkey: string,
  currentUserDid: string,
): Promise<BoardData | null> {
  try {
    const res = await fetch(`${APPVIEW_URL}/board/${boardDid}/${boardRkey}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;

    const data = (await res.json()) as AppviewBoardResponse;

    const boardUri = buildAtUri(boardDid, BOARD_COLLECTION, boardRkey);

    const board: Board = {
      rkey: data.board.rkey,
      did: data.board.did,
      name: data.board.name,
      description: data.board.description ?? undefined,
      columns: data.board.columns,
      labels: data.board.labels,
      open: data.board.open || undefined,
      createdAt: data.board.createdAt,
    };

    const tasks: Task[] = (data.rawTasks ?? []).map((t) => ({
      rkey: t.rkey,
      did: t.did,
      title: t.title,
      description: t.description ?? undefined,
      columnId: t.columnId,
      boardUri: t.boardUri,
      position: t.position ?? undefined,
      labelIds: t.labelIds ?? undefined,
      order: t.order ?? undefined,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt ?? undefined,
    }));

    const ops: Op[] = (data.rawOps ?? []).map((o) => ({
      rkey: o.rkey,
      did: o.did,
      targetTaskUri: o.targetTaskUri,
      boardUri: o.boardUri,
      fields: o.fields,
      createdAt: o.createdAt,
    }));

    const trusts: Trust[] = (data.trusts ?? []).map((t) => ({
      rkey: t.rkey,
      did: t.did,
      trustedDid: t.trustedDid,
      boardUri,
      createdAt: t.createdAt,
    }));

    const comments: Comment[] = (data.comments ?? []).map((c) => ({
      rkey: c.rkey,
      did: c.did,
      targetTaskUri: c.targetTaskUri,
      boardUri,
      text: c.text,
      createdAt: c.createdAt,
    }));

    const trustedDids = new Set(trusts.map((t) => t.trustedDid));

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
  } catch {
    return null;
  }
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
