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
  beginSnapshot,
  endSnapshot,
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
    // The finishing request hands its slot straight over, so a caller that
    // arrives before this waiter resumes can't take it too.
    await new Promise<void>((resolve) => waiting.push(resolve));
  } else {
    activeRequests++;
  }
  try {
    return await fn();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else activeRequests--;
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

function evictPdsCache(did: string): void {
  pdsLookups.delete(did);
  if (typeof localStorage === "undefined") return;
  try {
    const cache = readPdsCache();
    if (!(did in cache)) return;
    delete cache[did];
    localStorage.setItem(PDS_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // As above
  }
}

/** `did:web:example.com%3A8080:user` → `example.com:8080/user` */
function didWebPath(did: string): string {
  return did
    .slice("did:web:".length)
    .split(":")
    .map((segment) => decodeURIComponent(segment))
    .join("/");
}

/** In-flight and resolved lookups, so N parallel fetches share one round trip. */
const pdsLookups = new Map<
  string,
  { lookup: Promise<string | null>; at: number }
>();

/**
 * Resolve a DID's PDS endpoint from its DID document. Successful lookups are
 * cached in localStorage for a day so cold loads skip the directory hop.
 */
export async function resolvePds(did: string): Promise<string | null> {
  const memoized = pdsLookups.get(did);
  if (memoized && Date.now() - memoized.at < PDS_CACHE_TTL_MS)
    return memoized.lookup;
  if (memoized) pdsLookups.delete(did);

  const cached = readPdsCache()[did];
  if (cached && Date.now() - cached.at < PDS_CACHE_TTL_MS) {
    const hit = Promise.resolve(cached.endpoint);
    pdsLookups.set(did, { lookup: hit, at: cached.at });
    return hit;
  }

  const lookup = (async () => {
    let didDoc: Record<string, unknown> | null = null;

    if (did.startsWith("did:plc:")) {
      didDoc = await fetchJson(`https://plc.directory/${did}`);
    } else if (did.startsWith("did:web:")) {
      didDoc = await fetchJson(
        `https://${didWebPath(did)}/.well-known/did.json`,
      );
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

  pdsLookups.set(did, { lookup, at: Date.now() });
  const result = await lookup;
  // Don't memoize failures — a PDS that was down should be retried
  if (!result) pdsLookups.delete(did);
  return result;
}

// --- PDS reads ---

/**
 * Run a read against a DID's PDS. A failed read may mean the cached endpoint
 * is stale (the account migrated), so the endpoint is re-resolved and the
 * read retried once against it if it changed.
 */
async function withPds<T>(
  did: string,
  read: (pds: string) => Promise<T | null>,
): Promise<T | null> {
  const pds = await resolvePds(did);
  if (!pds) return null;
  const result = await read(pds);
  if (result !== null) return result;

  evictPdsCache(did);
  const fresh = await resolvePds(did);
  if (!fresh || fresh === pds) return null;
  return read(fresh);
}

async function getRecordFromRepo(
  did: string,
  collection: string,
  rkey: string,
): Promise<Record<string, unknown> | null> {
  const params = new URLSearchParams({ repo: did, collection, rkey });
  return withPds(did, async (pds) => {
    const data = await fetchJson<{ value?: Record<string, unknown> }>(
      `${pds}/xrpc/com.atproto.repo.getRecord?${params.toString()}`,
    );
    return data?.value ?? null;
  });
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
  return withPds(did, (pds) => listRecordsFromPds(pds, did, collection));
}

async function listRecordsFromPds(
  pds: string,
  did: string,
  collection: string,
): Promise<RawRecord[] | null> {
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

/**
 * DIDs with at least one `collection` record pointing at `boardUri`, or null
 * if the full list could not be read. A partial list is never returned: it
 * would silently drop participants from the board.
 */
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

    const url = `${CONSTELLATION_URL}/links/distinct-dids?${params.toString()}`;
    type Page = { linking_dids?: string[]; cursor?: string | null };
    // One retry, so a single dropped page doesn't cost a participant
    const data = (await fetchJson<Page>(url)) ?? (await fetchJson<Page>(url));
    if (!data) return null;

    dids.push(...(data.linking_dids ?? []));
    cursor = data.cursor ?? undefined;
  } while (cursor);

  return dids;
}

// --- board loading ---

/**
 * Shared state for loading several boards at once. A participant's repo is
 * listed in full regardless of board, so every board in a session reuses the
 * same listing instead of fetching it again.
 *
 * The session's snapshot token is taken before any of its listings, so live
 * events that land while it runs still win over what it fetched.
 */
export interface LoadSession {
  readonly startedAt: number;
  readonly listings: Map<string, Promise<RawRecord[] | null>>;
  end(): void;
}

export function createLoadSession(): LoadSession {
  const startedAt = beginSnapshot();
  let ended = false;
  return {
    startedAt,
    listings: new Map(),
    end() {
      if (ended) return;
      ended = true;
      endSnapshot(startedAt);
    },
  };
}

function sessionListing(
  session: LoadSession,
  did: string,
  collection: string,
): Promise<RawRecord[] | null> {
  const key = `${did}\0${collection}`;
  let listing = session.listings.get(key);
  if (!listing) {
    listing = listRecordsFromRepo(did, collection);
    session.listings.set(key, listing);
  }
  return listing;
}

type Footprint = Awaited<ReturnType<typeof localBoardFootprint>>;

/**
 * Load several boards with one shared session. Returns which loaded.
 *
 * Every board's local footprint is read before any listing starts: a shared
 * listing may predate a board's own load, and a row synced after the listing
 * was fetched must not be pruned as missing from it.
 */
export async function loadBoardsFromConstellation(
  boards: BoardRef[],
): Promise<boolean[]> {
  const session = createLoadSession();
  try {
    const footprints = await Promise.all(
      boards.map((b) => localBoardFootprint(b.uri)),
    );
    const results = await Promise.allSettled(
      boards.map((b, i) =>
        loadBoard(b.ownerDid, b.rkey, b.uri, session, footprints[i]),
      ),
    );
    return results.map((r) => r.status === "fulfilled" && r.value);
  } finally {
    session.end();
  }
}

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
  const session = createLoadSession();
  try {
    return await loadBoard(
      ownerDid,
      rkey,
      boardUri,
      session,
      await localBoardFootprint(boardUri),
    );
  } finally {
    session.end();
  }
}

async function loadBoard(
  ownerDid: string,
  rkey: string,
  boardUri: string,
  session: LoadSession,
  local: Footprint,
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

    // Always list every owner collection. A successful but empty links result
    // is also what Constellation returns before a target has been indexed, so
    // it cannot safely prove that a new board is empty.
    const collections = new Set<string>(BOARD_CHILD_COLLECTIONS);
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
      if (discovered.some((list) => list === null)) {
        console.warn(
          `Constellation discovery incomplete for ${boardUri}; some participants may be missing`,
        );
      }
    }

    // 4. Hydrate every (participant, collection) pair in parallel. One dead
    //    PDS must not fail the load.
    const records = new Map<string, RawRecord[]>();
    const hydrated: Array<{ did: string; collection: string }> = [];

    await Promise.all(
      [...dids].flatMap((did) =>
        [...collections].map(async (collection) => {
          const listed = await sessionListing(session, did, collection);
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
      pruneCandidates: local.rows,
      startedAt: session.startedAt,
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

  const loaded = await loadBoardsFromConstellation(toLoad);
  return loaded.filter(Boolean).length;
}
