/**
 * Board reads, served without an appview.
 *
 * Constellation (https://constellation.microcosm.blue) is a global atproto
 * backlink index. Every `dev.skyboard.*` record carries a `boardUri`, so one
 * target URI reaches every record on a board — but Constellation returns
 * record *identities*, not bodies. So the division of labour is:
 *
 *   Constellation  → who participates in a board, and which collections are
 *                    non-empty
 *   each PDS       → the record content itself (the source of truth)
 *   Dexie          → local cache, unchanged local-wins semantics
 *
 * If Constellation is unreachable the load degrades to "owner plus whoever we
 * already know about locally" rather than failing outright.
 */

import type { Agent } from "@atproto/api";
import { db } from "./db.js";
import {
  BOARD_COLLECTION,
  TRUST_COLLECTION,
  buildAtUri,
  type BoardRef,
  parseBoardUri,
} from "./tid.js";
import {
  BOARD_CHILD_COLLECTIONS,
  applyBoardSnapshot,
  localBoardFootprint,
  type RawRecord,
} from "./board-store.js";

declare const __SKYBOARD_CONSTELLATION_URL__: string;

const CONSTELLATION_URL = (
  typeof __SKYBOARD_CONSTELLATION_URL__ !== "undefined" &&
  __SKYBOARD_CONSTELLATION_URL__
    ? __SKYBOARD_CONSTELLATION_URL__
    : "https://constellation.microcosm.blue"
).replace(/\/+$/, "");

const REQUEST_TIMEOUT_MS = 10_000;
/** Loading several boards at once can fan out to hundreds of requests. */
const MAX_CONCURRENT_REQUESTS = 12;

const PDS_CACHE_KEY = "skyboard:pds-cache";
const PDS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// --- request throttle ---

let activeRequests = 0;
const waiting: Array<() => void> = [];

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (activeRequests >= MAX_CONCURRENT_REQUESTS) {
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  activeRequests++;
  try {
    return await fn();
  } finally {
    activeRequests--;
    waiting.shift()?.();
  }
}

async function fetchJson<T>(url: string): Promise<T | null> {
  return withSlot(async () => {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) return null;
      return (await res.json()) as T;
    } catch {
      return null;
    }
  });
}

// --- DID → PDS resolution ---

type PdsCache = Record<string, { endpoint: string; at: number }>;

function readPdsCache(): PdsCache {
  if (typeof localStorage === "undefined") return {};
  try {
    return (JSON.parse(localStorage.getItem(PDS_CACHE_KEY) ?? "{}") ??
      {}) as PdsCache;
  } catch {
    return {};
  }
}

function writePdsCache(did: string, endpoint: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    const cache = readPdsCache();
    cache[did] = { endpoint, at: Date.now() };
    localStorage.setItem(PDS_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Quota or private-mode failures are not worth surfacing
  }
}

/** In-flight and resolved lookups, so N parallel fetches share one round trip. */
const pdsLookups = new Map<string, Promise<string | null>>();

/**
 * Resolve a DID's PDS endpoint from its DID document. Successful lookups are
 * cached in localStorage for a day so cold loads skip the directory hop.
 */
export async function resolvePds(did: string): Promise<string | null> {
  const inFlight = pdsLookups.get(did);
  if (inFlight) return inFlight;

  const cached = readPdsCache()[did];
  if (cached && Date.now() - cached.at < PDS_CACHE_TTL_MS) {
    const hit = Promise.resolve(cached.endpoint);
    pdsLookups.set(did, hit);
    return hit;
  }

  const lookup = (async () => {
    let didDoc: Record<string, unknown> | null = null;

    if (did.startsWith("did:plc:")) {
      didDoc = await fetchJson(`https://plc.directory/${did}`);
    } else if (did.startsWith("did:web:")) {
      const host = did.slice("did:web:".length).replaceAll(":", "/");
      didDoc = await fetchJson(`https://${host}/.well-known/did.json`);
    }
    if (!didDoc) return null;

    const services = didDoc.service as
      | Array<{ id: string; type: string; serviceEndpoint: string }>
      | undefined;
    const pds = services?.find(
      (s) => s.id === "#atproto_pds" || s.type === "AtprotoPersonalDataServer",
    );
    if (!pds?.serviceEndpoint) return null;

    writePdsCache(did, pds.serviceEndpoint);
    return pds.serviceEndpoint;
  })();

  pdsLookups.set(did, lookup);
  const result = await lookup;
  // Don't memoize failures — a PDS that was down should be retried
  if (!result) pdsLookups.delete(did);
  return result;
}

// --- PDS reads ---

async function getRecordFromRepo(
  did: string,
  collection: string,
  rkey: string,
): Promise<Record<string, unknown> | null> {
  const pds = await resolvePds(did);
  if (!pds) return null;

  const params = new URLSearchParams({ repo: did, collection, rkey });
  const data = await fetchJson<{ value?: Record<string, unknown> }>(
    `${pds}/xrpc/com.atproto.repo.getRecord?${params.toString()}`,
  );
  return data?.value ?? null;
}

/**
 * List a whole collection out of a repo. Returns null (rather than an empty
 * array) when the repo could not be read, so callers can tell "this user has
 * no records" from "this user's PDS is down" — the latter must not prune.
 */
async function listRecordsFromRepo(
  did: string,
  collection: string,
): Promise<RawRecord[] | null> {
  const pds = await resolvePds(did);
  if (!pds) return null;

  const records: RawRecord[] = [];
  let cursor: string | undefined;

  do {
    const params = new URLSearchParams({ repo: did, collection, limit: "100" });
    if (cursor) params.set("cursor", cursor);

    const data = await fetchJson<{
      records?: Array<{ uri: string; value: Record<string, unknown> }>;
      cursor?: string;
    }>(`${pds}/xrpc/com.atproto.repo.listRecords?${params.toString()}`);
    // A repo with no such collection answers 200 with an empty list; a null
    // here means the request itself failed.
    if (!data) return null;

    for (const record of data.records ?? []) {
      records.push({
        did,
        rkey: record.uri.split("/").pop()!,
        value: record.value,
      });
    }
    cursor = data.cursor;
  } while (cursor);

  return records;
}

// --- Constellation reads ---

interface LinksAllResponse {
  links?: Record<string, Record<string, { records?: number }>>;
}

/** Record counts per collection linking to `boardUri` via `.boardUri`. */
async function fetchLinkCounts(
  boardUri: string,
): Promise<Map<string, number> | null> {
  const params = new URLSearchParams({ target: boardUri });
  const data = await fetchJson<LinksAllResponse>(
    `${CONSTELLATION_URL}/links/all?${params.toString()}`,
  );
  if (!data?.links) return null;

  const counts = new Map<string, number>();
  for (const [collection, paths] of Object.entries(data.links)) {
    counts.set(collection, paths[".boardUri"]?.records ?? 0);
  }
  return counts;
}

/** DIDs with at least one `collection` record pointing at `boardUri`. */
async function fetchLinkingDids(
  boardUri: string,
  collection: string,
): Promise<string[] | null> {
  const dids: string[] = [];
  let cursor: string | undefined;

  do {
    const params = new URLSearchParams({
      target: boardUri,
      collection,
      path: ".boardUri",
      limit: "100",
    });
    if (cursor) params.set("cursor", cursor);

    const data = await fetchJson<{
      linking_dids?: string[];
      cursor?: string | null;
    }>(`${CONSTELLATION_URL}/links/distinct-dids?${params.toString()}`);
    if (!data) return dids.length ? dids : null;

    dids.push(...(data.linking_dids ?? []));
    cursor = data.cursor ?? undefined;
  } while (cursor);

  return dids;
}

// --- board loading ---

/**
 * Load a board into Dexie from Constellation plus participant PDSes.
 *
 * Returns false only when the board record itself could not be read — a
 * degraded Constellation or an unreachable participant still yields a usable
 * board.
 */
export async function loadBoardFromConstellation(
  ownerDid: string,
  rkey: string,
  boardUri: string,
): Promise<boolean> {
  try {
    // 1. The board record is the link *target*, so Constellation can't return
    //    it — read it straight from the owner's repo.
    const boardValue = await getRecordFromRepo(
      ownerDid,
      BOARD_COLLECTION,
      rkey,
    );
    if (!boardValue) return false;

    // 2. Which collections actually have records on this board.
    const counts = await fetchLinkCounts(boardUri);
    const local = await localBoardFootprint(boardUri);

    const collections = new Set<string>();
    if (counts) {
      for (const collection of BOARD_CHILD_COLLECTIONS) {
        if ((counts.get(collection) ?? 0) > 0) collections.add(collection);
      }
      // Trust drives permissions, and index lag there is the most damaging
      // thing that can happen on a cold load, so never skip it.
      collections.add(TRUST_COLLECTION);
    } else {
      for (const collection of BOARD_CHILD_COLLECTIONS) {
        collections.add(collection);
      }
    }
    // Anything already cached has to be re-listed, otherwise a collection that
    // was emptied upstream would never be pruned.
    for (const collection of local.collections) collections.add(collection);

    // 3. Who to hydrate from. Only collections Constellation reports as
    //    non-empty can have linking DIDs, so the rest need no query.
    const dids = new Set<string>([ownerDid, ...local.dids]);
    if (counts) {
      const discovered = await Promise.all(
        [...collections]
          .filter((collection) => (counts.get(collection) ?? 0) > 0)
          .map((collection) => fetchLinkingDids(boardUri, collection)),
      );
      for (const list of discovered) {
        for (const did of list ?? []) dids.add(did);
      }
    }

    // 4. Hydrate every (participant, collection) pair in parallel. One dead
    //    PDS must not fail the load.
    const records = new Map<string, RawRecord[]>();
    const hydrated: Array<{ did: string; collection: string }> = [];

    await Promise.all(
      [...dids].flatMap((did) =>
        [...collections].map(async (collection) => {
          const listed = await listRecordsFromRepo(did, collection);
          if (listed === null) return;

          hydrated.push({ did, collection });
          const forBoard = listed.filter((r) => r.value.boardUri === boardUri);
          if (!forBoard.length) return;
          const bucket = records.get(collection);
          if (bucket) bucket.push(...forBoard);
          else records.set(collection, forBoard);
        }),
      ),
    );

    // Collections we listed but found nothing in still need an (empty) bucket
    // so the prune pass knows about them.
    for (const collection of collections) {
      if (!records.has(collection)) records.set(collection, []);
    }

    // 5. One transaction, so liveQuery fires once.
    await applyBoardSnapshot(ownerDid, rkey, boardUri, {
      boardValue,
      records,
      hydrated,
    });

    return true;
  } catch {
    return false;
  }
}

/**
 * Discover all boards the user is connected to by reading their own board and
 * trust records from their PDS, then loading each new board's full state.
 * Returns the number of newly discovered boards.
 */
export async function discoverMyBoards(
  userAgent: Agent,
  userDid: string,
): Promise<number> {
  const knownBoardUris = new Set<string>();
  let newCount = 0;

  // Collect boards already in Dexie (including archived) so we don't re-fetch them
  const existingBoards = await db.boards.toArray();
  for (const b of existingBoards) {
    knownBoardUris.add(buildAtUri(b.did, BOARD_COLLECTION, b.rkey));
  }

  // Step A: Fetch owned boards from PDS
  const ownedBoardUris: BoardRef[] = [];
  let cursor: string | undefined;
  do {
    const res = await userAgent.com.atproto.repo.listRecords({
      repo: userDid,
      collection: BOARD_COLLECTION,
      limit: 100,
      cursor,
    });
    for (const record of res.data.records) {
      const rkey = record.uri.split("/").pop()!;
      ownedBoardUris.push({
        ownerDid: userDid,
        rkey,
        uri: buildAtUri(userDid, BOARD_COLLECTION, rkey),
      });
    }
    cursor = res.data.cursor;
  } while (cursor);

  // Step B: Fetch trust records to find joined boards
  const joinedBoardUris: BoardRef[] = [];
  cursor = undefined;
  do {
    const res = await userAgent.com.atproto.repo.listRecords({
      repo: userDid,
      collection: TRUST_COLLECTION,
      limit: 100,
      cursor,
    });
    for (const record of res.data.records) {
      const value = record.value as Record<string, unknown>;
      const boardUri = value.boardUri as string | undefined;
      if (!boardUri) continue;
      const ref = parseBoardUri(boardUri);
      if (ref) joinedBoardUris.push(ref);
    }
    cursor = res.data.cursor;
  } while (cursor);

  // Deduplicate and load boards not already in Dexie
  const seen = new Set<string>();
  const toLoad: BoardRef[] = [];
  for (const b of [...ownedBoardUris, ...joinedBoardUris]) {
    if (seen.has(b.uri) || knownBoardUris.has(b.uri)) continue;
    seen.add(b.uri);
    toLoad.push(b);
  }

  await Promise.allSettled(
    toLoad.map(async (b) => {
      const ok = await loadBoardFromConstellation(b.ownerDid, b.rkey, b.uri);
      if (ok) newCount++;
    }),
  );

  return newCount;
}
