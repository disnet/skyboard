import {
  BOARD_COLLECTION,
  TASK_COLLECTION,
  OP_COLLECTION,
  TRUST_COLLECTION,
  COMMENT_COLLECTION,
  APPROVAL_COLLECTION,
  REACTION_COLLECTION,
} from "../shared/collections.js";
import {
  safeParse,
  BoardRecordSchema,
  TaskRecordSchema,
  OpRecordSchema,
  TrustRecordSchema,
  CommentRecordSchema,
  ApprovalRecordSchema,
  ReactionRecordSchema,
} from "../shared/schemas.js";
import {
  upsertBoard,
  upsertTask,
  upsertOp,
  upsertTrust,
  upsertComment,
  upsertApproval,
  upsertReaction,
  upsertParticipant,
  getParticipants,
  markParticipantFetched,
} from "../db/client.js";

// Cache resolved PDS endpoints
const pdsCache = new Map<string, string>();

async function resolvePDS(did: string): Promise<string | null> {
  const cached = pdsCache.get(did);
  if (cached) return cached;

  try {
    let didDoc: Record<string, unknown>;

    if (did.startsWith("did:plc:")) {
      const res = await fetch(`https://plc.directory/${did}`);
      if (!res.ok) return null;
      didDoc = await res.json();
    } else if (did.startsWith("did:web:")) {
      const host = did.slice("did:web:".length).replaceAll(":", "/");
      const res = await fetch(`https://${host}/.well-known/did.json`);
      if (!res.ok) return null;
      didDoc = await res.json();
    } else {
      return null;
    }

    const services = didDoc.service as
      | Array<{ id: string; type: string; serviceEndpoint: string }>
      | undefined;
    const pds = services?.find(
      (s) =>
        s.id === "#atproto_pds" || s.type === "AtprotoPersonalDataServer",
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

    const data = await res.json();
    records.push(...(data.records ?? []));
    cursor = data.cursor;
  } while (cursor);

  return records;
}

function inferOpen(value: Record<string, unknown>): boolean | undefined {
  if (value.open !== undefined) return (value.open as boolean) || undefined;
  const perms = value.permissions as
    | { rules?: Array<{ scope?: string }> }
    | undefined;
  if (perms?.rules?.some((r) => r.scope === "anyone")) return true;
  return undefined;
}

/**
 * Backfill a single board: fetch the board record, trusts, and all participant data.
 */
export async function backfillBoard(
  ownerDid: string,
  rkey: string,
): Promise<void> {
  const boardUri = `at://${ownerDid}/dev.skyboard.board/${rkey}`;
  console.log(`[backfill] Starting board ${boardUri}`);

  // Fetch board record
  const pds = await resolvePDS(ownerDid);
  if (!pds) {
    console.warn(`[backfill] Could not resolve PDS for ${ownerDid}`);
    return;
  }

  const boardRes = await fetch(
    `${pds}/xrpc/com.atproto.repo.getRecord?${new URLSearchParams({
      repo: ownerDid,
      collection: BOARD_COLLECTION,
      rkey,
    }).toString()}`,
  );
  if (!boardRes.ok) {
    console.warn(`[backfill] Could not fetch board record`);
    return;
  }

  const boardData = await boardRes.json();
  const boardRecord = boardData.value as Record<string, unknown>;
  const validated = safeParse(BoardRecordSchema, boardRecord, "BoardRecord");
  if (!validated) return;

  upsertBoard(ownerDid, rkey, {
    name: validated.name,
    description: validated.description,
    columns: validated.columns,
    labels: validated.labels,
    open: inferOpen(boardRecord),
    createdAt: validated.createdAt,
  });
  upsertParticipant(ownerDid, boardUri);

  // Fetch trusts to discover participants
  await fetchAndStoreTrusts(ownerDid, boardUri);

  // Fetch data from all known participants
  await fetchAllParticipants(boardUri);

  console.log(`[backfill] Done board ${boardUri}`);
}

async function fetchAndStoreTrusts(
  ownerDid: string,
  boardUri: string,
): Promise<void> {
  const records = await fetchRecordsFromRepo(ownerDid, TRUST_COLLECTION);
  for (const record of records) {
    if (record.value.boardUri !== boardUri) continue;
    const validated = safeParse(TrustRecordSchema, record.value, "TrustRecord");
    if (!validated) continue;

    const rkey = record.uri.split("/").pop()!;
    upsertTrust(ownerDid, rkey, {
      trustedDid: validated.trustedDid,
      boardUri,
      createdAt: validated.createdAt,
    });
    upsertParticipant(ownerDid, boardUri);
    upsertParticipant(validated.trustedDid, boardUri);
  }
}

async function fetchAllParticipants(boardUri: string): Promise<void> {
  const dids = getParticipants(boardUri);

  const concurrency = 3;
  for (let i = 0; i < dids.length; i += concurrency) {
    const batch = dids.slice(i, i + concurrency);
    await Promise.allSettled(
      batch.map((did) => fetchParticipantData(did, boardUri)),
    );
  }
}

async function fetchParticipantData(
  did: string,
  boardUri: string,
): Promise<void> {
  await fetchAndStoreCollection(did, boardUri, TASK_COLLECTION, TaskRecordSchema, (rkey, v) => {
    upsertTask(did, rkey, { ...v, boardUri });
  });
  await fetchAndStoreCollection(did, boardUri, OP_COLLECTION, OpRecordSchema, (rkey, v) => {
    upsertOp(did, rkey, { ...v, boardUri });
  });
  await fetchAndStoreCollection(did, boardUri, COMMENT_COLLECTION, CommentRecordSchema, (rkey, v) => {
    upsertComment(did, rkey, { ...v, boardUri });
  });
  await fetchAndStoreCollection(did, boardUri, APPROVAL_COLLECTION, ApprovalRecordSchema, (rkey, v) => {
    upsertApproval(did, rkey, { ...v, boardUri });
  });
  await fetchAndStoreCollection(did, boardUri, REACTION_COLLECTION, ReactionRecordSchema, (rkey, v) => {
    upsertReaction(did, rkey, { ...v, boardUri });
  });

  upsertParticipant(did, boardUri);
  markParticipantFetched(did, boardUri);
}

async function fetchAndStoreCollection<T>(
  did: string,
  boardUri: string,
  collection: string,
  schema: import("zod").ZodType<T>,
  store: (rkey: string, validated: T) => void,
): Promise<void> {
  const records = await fetchRecordsFromRepo(did, collection);
  for (const record of records) {
    if (record.value.boardUri !== boardUri) continue;
    const validated = safeParse(schema, record.value, collection);
    if (!validated) continue;
    const rkey = record.uri.split("/").pop()!;
    store(rkey, validated);
  }
}
