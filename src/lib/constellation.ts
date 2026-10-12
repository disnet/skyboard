/**
 * Board reads, served without an appview.
 *
 * Constellation (https://constellation.microcosm.blue) is a global atproto
 * backlink index. Every `dev.skyboard.*` record carries a `boardUri`, so one
 * target URI reaches every record on a board — but Constellation returns
 * record *identities*, not bodies. So the division of labour is:
 *
 *   Constellation  → which records are on a board (`/links`: did + rkey)
 *   each PDS       → the record content itself, one `getRecord` per record
 *                    (the source of truth)
 *   Dexie          → local cache, unchanged local-wins semantics
 *
 * Reads are per record, so a board's cost scales with the board, not with how
 * much its participants have written elsewhere.
 *
 * If Constellation is unreachable the load degrades to listing the repos of
 * "owner plus whoever we already know about locally" rather than failing
 * outright.
 */

import type { Agent } from "@atproto/api";
import { db } from "./db.js";
import {
  APPROVAL_COLLECTION,
  BOARD_COLLECTION,
  OP_COLLECTION,
  REACTION_COLLECTION,
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
import { validateRecord } from "./record-schemas.js";
import { watchBoard } from "./jetstream.js";

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
const MIN_PDS_REFRESH_MS = 60 * 1000;

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

/**
 * A PDS read that can tell "this does not exist" from "we couldn't find out".
 * Only the first may prune local data; only the second hints at a stale
 * endpoint. `repo` marks an absent repo, which a PDS an account migrated away
 * from also reports.
 */
type PdsResult<T> =
  | { status: "ok"; data: T }
  | { status: "missing"; repo: boolean }
  | { status: "failed" };

/**
 * The reference PDS reports a missing record as HTTP 400 `RecordNotFound` and a
 * missing repo as `RepoNotFound` or a generic `InvalidRequest`; other
 * implementations use 404.
 */
async function missingKind(res: Response): Promise<"record" | "repo" | null> {
  if (res.status === 404) return "record";
  if (res.status !== 400) return null;
  try {
    const body = (await res.json()) as { error?: unknown; message?: unknown };
    if (body?.error === "RecordNotFound") return "record";
    if (body?.error === "RepoNotFound") return "repo";
    if (
      body?.error === "InvalidRequest" &&
      typeof body.message === "string" &&
      /could not find repo/i.test(body.message)
    ) {
      return "repo";
    }
  } catch {
    // An unreadable error body is just a failure
  }
  return null;
}

async function fetchPds<T>(url: string): Promise<PdsResult<T>> {
  return withSlot(async () => {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (res.ok) return { status: "ok", data: (await res.json()) as T };
      const missing = await missingKind(res);
      return missing
        ? { status: "missing", repo: missing === "repo" }
        : { status: "failed" };
    } catch {
      return { status: "failed" };
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

/**
 * Forget a DID's endpoint so the next read re-resolves it. Endpoints resolved
 * within the last minute are kept: re-resolving one can't help, and a burst of
 * failing reads against one PDS would otherwise each send a directory request.
 */
function evictPdsCache(did: string): void {
  const memoized = pdsLookups.get(did);
  if (memoized && Date.now() - memoized.at < MIN_PDS_REFRESH_MS) return;
  pdsLookups.delete(did);
  if (typeof localStorage === "undefined") return;
  try {
    const cache = readPdsCache();
    if (!(did in cache)) return;
    if (Date.now() - cache[did].at < MIN_PDS_REFRESH_MS) return;
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
 * Run a read against a DID's PDS. A failed read, or one that says the repo is
 * gone, may mean the cached endpoint is stale (the account migrated), so the
 * endpoint is re-resolved and the read retried once if it changed. A missing
 * *record* is a real answer and keeps the endpoint.
 */
async function withPds<T>(
  did: string,
  read: (pds: string) => Promise<PdsResult<T>>,
): Promise<PdsResult<T>> {
  const pds = await resolvePds(did);
  if (!pds) return { status: "failed" };
  const result = await read(pds);
  if (result.status === "ok") return result;
  if (result.status === "missing" && !result.repo) return result;

  evictPdsCache(did);
  const fresh = await resolvePds(did);
  if (!fresh || fresh === pds) return result;
  return read(fresh);
}

function getRecordFromRepo(
  did: string,
  collection: string,
  rkey: string,
): Promise<PdsResult<Record<string, unknown>>> {
  const params = new URLSearchParams({ repo: did, collection, rkey });
  return withPds(did, async (pds) => {
    const res = await fetchPds<{ value?: unknown }>(
      `${pds}/xrpc/com.atproto.repo.getRecord?${params.toString()}`,
    );
    if (res.status !== "ok") return res;
    const value = res.data?.value;
    return typeof value === "object" && value !== null
      ? { status: "ok", data: value as Record<string, unknown> }
      : { status: "failed" };
  });
}

/**
 * List a whole collection out of a repo. Only used when Constellation can't
 * say which records are on a board. Returns null (rather than an empty array)
 * when the repo could not be read, so callers can tell "this user has no
 * records" from "this user's PDS is down" — the latter must not prune.
 */
async function listRecordsFromRepo(
  did: string,
  collection: string,
): Promise<RawRecord[] | null> {
  const result = await withPds(did, (pds) =>
    listRecordsFromPds(pds, did, collection),
  );
  return result.status === "ok" ? result.data : null;
}

async function listRecordsFromPds(
  pds: string,
  did: string,
  collection: string,
): Promise<PdsResult<RawRecord[]>> {
  const records: RawRecord[] = [];
  let cursor: string | undefined;

  do {
    const params = new URLSearchParams({ repo: did, collection, limit: "100" });
    if (cursor) params.set("cursor", cursor);

    const res = await fetchPds<{
      records?: Array<{ uri: string; value: Record<string, unknown> }>;
      cursor?: string;
    }>(`${pds}/xrpc/com.atproto.repo.listRecords?${params.toString()}`);
    // A repo with no such collection answers 200 with an empty list
    if (res.status !== "ok") return res;

    for (const record of res.data.records ?? []) {
      records.push({
        did,
        rkey: record.uri.split("/").pop()!,
        value: record.value,
      });
    }
    cursor = res.data.cursor;
  } while (cursor);

  return { status: "ok", data: records };
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

/** `did\0rkey`, the identity of a record within one collection. */
function recordId(did: string, rkey: string): string {
  return `${did}\0${rkey}`;
}

/**
 * Every `collection` record pointing at `boardUri`, as (did, rkey) pairs, or
 * null if the full list could not be read. A partial list is never returned:
 * it would silently drop records from the board.
 */
async function fetchLinkedRecords(
  boardUri: string,
  collection: string,
): Promise<Array<{ did: string; rkey: string }> | null> {
  const linked: Array<{ did: string; rkey: string }> = [];
  let cursor: string | undefined;

  do {
    const params = new URLSearchParams({
      target: boardUri,
      collection,
      path: ".boardUri",
      limit: "100",
    });
    if (cursor) params.set("cursor", cursor);

    const url = `${CONSTELLATION_URL}/links?${params.toString()}`;
    type Page = {
      linking_records?: Array<{
        did: string;
        collection: string;
        rkey: string;
      }>;
      cursor?: string | null;
    };
    // One retry, so a single dropped page doesn't cost the whole collection
    const data = (await fetchJson<Page>(url)) ?? (await fetchJson<Page>(url));
    if (!data) return null;

    for (const link of data.linking_records ?? []) {
      if (link.collection === collection) {
        linked.push({ did: link.did, rkey: link.rkey });
      }
    }
    cursor = data.cursor ?? undefined;
  } while (cursor);

  return linked;
}

// --- board loading ---

/**
 * Collections whose records Skyboard never rewrites in place. A record of one
 * of these that Constellation still links and that we already hold as synced
 * can't have changed, so it needs no refetch.
 */
const IMMUTABLE_COLLECTIONS = new Set<string>([
  OP_COLLECTION,
  TRUST_COLLECTION,
  APPROVAL_COLLECTION,
  REACTION_COLLECTION,
]);

/**
 * Shared state for loading several boards at once. When Constellation is down
 * the load falls back to listing participants' repos, and those listings cover
 * every board, so they're shared across the session instead of refetched.
 *
 * The session's snapshot token is taken before any of its reads, so live
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
 * Every board's local footprint is read before any network read starts: a
 * shared listing may predate a board's own load, and a row synced after the
 * listing was fetched must not be pruned as missing from it.
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
 * Returns false when the board record could not be read or is not a valid
 * board — a degraded Constellation or an unreachable participant still yields
 * a usable board.
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

interface CollectionResult {
  records: RawRecord[];
  /** Local rows confirmed gone upstream (or moved off this board). */
  missing: Set<string>;
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
    const board = await getRecordFromRepo(ownerDid, BOARD_COLLECTION, rkey);
    if (board.status !== "ok") return false;
    if (!validateRecord(BOARD_COLLECTION, board.data)) {
      console.warn(`${boardUri} is not a valid board record`);
      return false;
    }

    // 2. Which collections actually have records on this board. Constellation
    //    answers an empty result for a target it hasn't indexed yet, so a
    //    board with no links at all can't be told apart from a brand new one.
    const counts = await fetchLinkCounts(boardUri);
    const indexEmpty =
      counts !== null && [...counts.values()].every((n) => n === 0);

    // 3. Hydrate each collection. One dead PDS must not fail the load.
    const results = new Map<string, CollectionResult>();
    await Promise.all(
      BOARD_CHILD_COLLECTIONS.map(async (collection) => {
        const linked =
          counts === null || indexEmpty
            ? null
            : (counts.get(collection) ?? 0) === 0
              ? []
              : await fetchLinkedRecords(boardUri, collection);
        results.set(
          collection,
          linked
            ? await hydrateLinked(boardUri, collection, linked, local)
            : await hydrateByListing(
                boardUri,
                collection,
                ownerDid,
                session,
                local,
              ),
        );
      }),
    );
    if (counts === null) {
      console.warn(
        `Constellation unavailable for ${boardUri}; loaded known participants only`,
      );
    }

    // 4. One transaction, so liveQuery fires once.
    await applyBoardSnapshot(ownerDid, rkey, boardUri, {
      boardValue: board.data,
      records: new Map(
        [...results].map(([collection, r]) => [collection, r.records]),
      ),
      missing: new Map(
        [...results].map(([collection, r]) => [collection, r.missing]),
      ),
      pruneCandidates: local.rows,
      startedAt: session.startedAt,
    });

    return true;
  } catch (err) {
    console.error(`Failed to load ${boardUri}:`, err);
    return false;
  }
}

/**
 * Fetch each record Constellation links to the board, plus each one we hold
 * locally that it no longer links — that's either a delete, or a record the
 * index hasn't caught up with yet, and only the PDS can say which.
 */
async function hydrateLinked(
  boardUri: string,
  collection: string,
  linked: Array<{ did: string; rkey: string }>,
  local: Footprint,
): Promise<CollectionResult> {
  const held = local.rows.get(collection) ?? new Set<string>();
  const targets = new Map<string, { did: string; rkey: string }>();
  for (const link of linked) {
    const id = recordId(link.did, link.rkey);
    if (IMMUTABLE_COLLECTIONS.has(collection) && held.has(id)) continue;
    targets.set(id, link);
  }
  const linkedIds = new Set(linked.map((l) => recordId(l.did, l.rkey)));
  for (const id of held) {
    if (linkedIds.has(id)) continue;
    const [did, rkey] = id.split("\0");
    targets.set(id, { did, rkey });
  }

  const records: RawRecord[] = [];
  const missing = new Set<string>();
  await Promise.all(
    [...targets].map(async ([id, { did, rkey }]) => {
      const result = await getRecordFromRepo(did, collection, rkey);
      if (result.status === "ok") {
        if (result.data.boardUri === boardUri) {
          records.push({ did, rkey, value: result.data });
        } else {
          missing.add(id);
        }
      } else if (result.status === "missing") {
        missing.add(id);
      }
      // A failed read keeps whatever we hold
    }),
  );
  return { records, missing };
}

/**
 * Degraded path for when Constellation can't enumerate the collection: list
 * it out of the repos we already know take part (the owner, and anyone we hold
 * records from), and keep what's on this board.
 */
async function hydrateByListing(
  boardUri: string,
  collection: string,
  ownerDid: string,
  session: LoadSession,
  local: Footprint,
): Promise<CollectionResult> {
  const held = local.rows.get(collection) ?? new Set<string>();
  const records: RawRecord[] = [];
  const missing = new Set<string>();

  await Promise.all(
    [...new Set([ownerDid, ...local.dids])].map(async (did) => {
      const listed = await sessionListing(session, did, collection);
      if (listed === null) return;

      const present = new Set<string>();
      for (const record of listed) {
        if (record.value.boardUri !== boardUri) continue;
        records.push(record);
        present.add(recordId(record.did, record.rkey));
      }
      for (const id of held) {
        if (id.startsWith(`${did}\0`) && !present.has(id)) missing.add(id);
      }
    }),
  );
  return { records, missing };
}

/**
 * Discover all boards the user is connected to by reading their own board and
 * trust records from their PDS, then loading each new board's full state.
 * Returns the URIs of the newly discovered boards that loaded.
 */
export async function discoverMyBoards(
  userAgent: Agent,
  userDid: string,
): Promise<Set<string>> {
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

  // These have no local row yet, so nothing else is watching them
  const releases = toLoad.map((b) => watchBoard(b.uri));
  try {
    const loaded = await loadBoardsFromConstellation(toLoad);
    return new Set(toLoad.filter((_, i) => loaded[i]).map((b) => b.uri));
  } finally {
    for (const release of releases) release();
  }
}
