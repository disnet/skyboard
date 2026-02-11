import { db } from "./db.js";
import {
  TASK_COLLECTION,
  OP_COLLECTION,
  BOARD_COLLECTION,
  TRUST_COLLECTION,
  COMMENT_COLLECTION,
  APPROVAL_COLLECTION,
  REACTION_COLLECTION,
} from "./tid.js";
import type { Task, Op, Board, Trust, Comment, Approval, Reaction } from "./types.js";

/**
 * Infer the `open` flag from a PDS record that may have the old `permissions`
 * field but no `open` field. If any old rule had scope "anyone", the board
 * should be open.
 */
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

// Cache resolved PDS endpoints to avoid repeated lookups
const pdsCache = new Map<string, string>();

/**
 * Resolve a DID to its PDS service endpoint.
 * For did:plc, queries plc.directory. For did:web, fetches /.well-known/did.json.
 */
async function resolvePDS(did: string): Promise<string | null> {
  const cached = pdsCache.get(did);
  if (cached) return cached;
  if (!navigator.onLine) return null;

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

    // Extract the PDS service endpoint from the DID document
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

    const data = await res.json();
    records.push(...(data.records ?? []));
    cursor = data.cursor;
  } while (cursor);

  return records;
}

export async function fetchRemoteTasks(
  participantDid: string,
  boardUri: string,
): Promise<void> {
  const records = await fetchRecordsFromRepo(participantDid, TASK_COLLECTION);

  for (const record of records) {
    const value = record.value;
    if (value.boardUri !== boardUri) continue;

    const rkey = record.uri.split("/").pop()!;
    const existing = await db.tasks
      .where("[did+rkey]")
      .equals([participantDid, rkey])
      .first();

    const taskData: Omit<Task, "id"> = {
      rkey,
      did: participantDid,
      title: (value.title as string) ?? "",
      description: value.description as string | undefined,
      columnId: (value.columnId as string) ?? "",
      boardUri,
      position: value.position as string | undefined,
      labelIds: (value.labelIds as string[]) ?? undefined,
      order: (value.order as number) ?? 0,
      createdAt: (value.createdAt as string) ?? new Date().toISOString(),
      updatedAt: value.updatedAt as string | undefined,
      syncStatus: "synced",
    };

    if (existing?.id) {
      await db.tasks.update(existing.id, taskData);
    } else {
      await db.tasks.add(taskData as Task);
    }
  }
}

export async function fetchRemoteOps(
  participantDid: string,
  boardUri: string,
): Promise<void> {
  const records = await fetchRecordsFromRepo(participantDid, OP_COLLECTION);

  for (const record of records) {
    const value = record.value;
    if (value.boardUri !== boardUri) continue;

    const rkey = record.uri.split("/").pop()!;
    const existing = await db.ops
      .where("[did+rkey]")
      .equals([participantDid, rkey])
      .first();

    const opData: Omit<Op, "id"> = {
      rkey,
      did: participantDid,
      targetTaskUri: (value.targetTaskUri as string) ?? "",
      boardUri,
      fields: (value.fields as Op["fields"]) ?? {},
      createdAt: (value.createdAt as string) ?? new Date().toISOString(),
      syncStatus: "synced",
    };

    if (existing?.id) {
      await db.ops.update(existing.id, opData);
    } else {
      await db.ops.add(opData as Op);
    }
  }
}

export async function fetchRemoteBoard(
  ownerDid: string,
  collection: string,
  rkey: string,
): Promise<Board | null> {
  try {
    const pds = await resolvePDS(ownerDid);
    if (!pds) return null;

    const params = new URLSearchParams({
      repo: ownerDid,
      collection,
      rkey,
    });
    const res = await fetch(
      `${pds}/xrpc/com.atproto.repo.getRecord?${params.toString()}`,
    );
    if (!res.ok) return null;

    const data = await res.json();
    const value = data.value as Record<string, unknown>;

    return {
      rkey,
      did: ownerDid,
      name: (value.name as string) ?? "",
      description: value.description as string | undefined,
      columns: (value.columns as Board["columns"]) ?? [],
      labels: (value.labels as Board["labels"]) ?? undefined,
      open: inferOpenFromRecord(value),
      createdAt: (value.createdAt as string) ?? new Date().toISOString(),
      syncStatus: "synced",
    };
  } catch {
    return null;
  }
}

export async function fetchRemoteTrusts(
  ownerDid: string,
  boardUri: string,
): Promise<void> {
  const records = await fetchRecordsFromRepo(ownerDid, TRUST_COLLECTION);

  for (const record of records) {
    const value = record.value;
    if (value.boardUri !== boardUri) continue;

    const rkey = record.uri.split("/").pop()!;
    const trustedDid = (value.trustedDid as string) ?? "";
    const existing = await db.trusts
      .where("[did+boardUri+trustedDid]")
      .equals([ownerDid, boardUri, trustedDid])
      .first();

    const trustData: Omit<Trust, "id"> = {
      rkey,
      did: ownerDid,
      trustedDid,
      boardUri,
      createdAt: (value.createdAt as string) ?? new Date().toISOString(),
      syncStatus: "synced",
    };

    if (existing?.id) {
      await db.trusts.update(existing.id, trustData);
    } else {
      await db.trusts.add(trustData as Trust);
    }
  }
}

export async function fetchRemoteComments(
  participantDid: string,
  boardUri: string,
): Promise<void> {
  const records = await fetchRecordsFromRepo(
    participantDid,
    COMMENT_COLLECTION,
  );

  for (const record of records) {
    const value = record.value;
    if (value.boardUri !== boardUri) continue;

    const rkey = record.uri.split("/").pop()!;
    const existing = await db.comments
      .where("[did+rkey]")
      .equals([participantDid, rkey])
      .first();

    const commentData: Omit<Comment, "id"> = {
      rkey,
      did: participantDid,
      targetTaskUri: (value.targetTaskUri as string) ?? "",
      boardUri,
      text: (value.text as string) ?? "",
      createdAt: (value.createdAt as string) ?? new Date().toISOString(),
      syncStatus: "synced",
    };

    if (existing?.id) {
      await db.comments.update(existing.id, commentData);
    } else {
      await db.comments.add(commentData as Comment);
    }
  }
}

export async function fetchRemoteApprovals(
  ownerDid: string,
  boardUri: string,
): Promise<void> {
  const records = await fetchRecordsFromRepo(ownerDid, APPROVAL_COLLECTION);

  for (const record of records) {
    const value = record.value;
    if (value.boardUri !== boardUri) continue;

    const rkey = record.uri.split("/").pop()!;
    const existing = await db.approvals
      .where("[did+rkey]")
      .equals([ownerDid, rkey])
      .first();

    const approvalData: Omit<Approval, "id"> = {
      rkey,
      did: ownerDid,
      targetUri: (value.targetUri as string) ?? "",
      boardUri,
      createdAt: (value.createdAt as string) ?? new Date().toISOString(),
      syncStatus: "synced",
    };

    if (existing?.id) {
      await db.approvals.update(existing.id, approvalData);
    } else {
      await db.approvals.add(approvalData as Approval);
    }
  }
}

export async function fetchRemoteReactions(
  participantDid: string,
  boardUri: string,
): Promise<void> {
  const records = await fetchRecordsFromRepo(
    participantDid,
    REACTION_COLLECTION,
  );

  for (const record of records) {
    const value = record.value;
    if (value.boardUri !== boardUri) continue;

    const rkey = record.uri.split("/").pop()!;
    const existing = await db.reactions
      .where("[did+rkey]")
      .equals([participantDid, rkey])
      .first();

    const reactionData: Omit<Reaction, "id"> = {
      rkey,
      did: participantDid,
      targetTaskUri: (value.targetTaskUri as string) ?? "",
      boardUri,
      emoji: (value.emoji as string) ?? "",
      createdAt: (value.createdAt as string) ?? new Date().toISOString(),
      syncStatus: "synced",
    };

    if (existing?.id) {
      await db.reactions.update(existing.id, reactionData);
    } else {
      await db.reactions.add(reactionData as Reaction);
    }
  }
}

export async function seedParticipantsFromTrusts(
  boardUri: string,
): Promise<void> {
  const trusts = await db.trusts.where("boardUri").equals(boardUri).toArray();
  for (const trust of trusts) {
    await addKnownParticipant(trust.trustedDid, boardUri);
    await addKnownParticipant(trust.did, boardUri);
  }
}

// --- Known participants management ---

export async function addKnownParticipant(
  did: string,
  boardUri: string,
): Promise<void> {
  const existing = await db.knownParticipants
    .where("[did+boardUri]")
    .equals([did, boardUri])
    .first();
  if (existing) return;

  await db.knownParticipants.add({
    did,
    boardUri,
    discoveredAt: new Date().toISOString(),
  });
}

export async function getKnownParticipants(
  boardUri: string,
): Promise<string[]> {
  const participants = await db.knownParticipants
    .where("boardUri")
    .equals(boardUri)
    .toArray();
  return participants.map((p) => p.did);
}

export async function fetchAllKnownParticipants(
  boardUri: string,
): Promise<void> {
  const dids = await getKnownParticipants(boardUri);

  // Fetch in parallel with concurrency limit of 3
  const concurrency = 3;
  for (let i = 0; i < dids.length; i += concurrency) {
    const batch = dids.slice(i, i + concurrency);
    await Promise.allSettled(
      batch.flatMap((did) => [
        fetchRemoteTasks(did, boardUri),
        fetchRemoteOps(did, boardUri),
        fetchRemoteComments(did, boardUri),
        fetchRemoteReactions(did, boardUri),
      ]),
    );
  }
}
