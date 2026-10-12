/**
 * Real-time board updates, straight from Jetstream.
 *
 * The appview used to consume Jetstream server-side and ping clients with a
 * "something changed" notification, which they answered with a full board
 * refetch. Commit events carry the whole record, so the browser can subscribe
 * itself and apply deltas directly — no refetch, and one socket covers every
 * board the user has open.
 */

import {
  ALL_COLLECTIONS,
  BOARD_COLLECTION,
  buildAtUri,
  parseBoardUri,
  type BoardRef,
} from "./tid.js";
import { applyRecordUpsert, applyRecordDelete } from "./board-store.js";

declare const __SKYBOARD_JETSTREAM_URL__: string;

const JETSTREAM_URL =
  typeof __SKYBOARD_JETSTREAM_URL__ !== "undefined" &&
  __SKYBOARD_JETSTREAM_URL__
    ? __SKYBOARD_JETSTREAM_URL__
    : "wss://jetstream2.us-east.bsky.network/subscribe";

const INITIAL_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 30_000;
/** Rewind slightly past the last event so nothing falls in the seam. */
const REPLAY_OVERLAP_US = 5_000_000;
/** Beyond this gap, replay is not trustworthy — reload the boards instead. */
const MAX_REPLAY_AGE_MS = 60 * 60 * 1000;
/** A tab hidden longer than this may have had its socket quietly killed. */
const RECONNECT_AFTER_HIDDEN_MS = 60_000;
/**
 * The first connection replays from this far before it was requested, so a
 * board load started while the socket is still opening can't miss an event —
 * and the margin absorbs the client clock running ahead of Jetstream's.
 */
const FIRST_CONNECT_REWIND_MS = 60_000;

interface CommitEvent {
  did: string;
  time_us?: number;
  kind: string;
  commit?: {
    operation: "create" | "update" | "delete";
    collection: string;
    rkey: string;
    record?: Record<string, unknown>;
  };
}

export interface JetstreamHandlers {
  /** A change was applied to Dexie for this board. */
  onBoardUpdate: (boardUri: string) => void | Promise<void>;
  /** Events were missed; these boards need a full reload. */
  onResync: (boards: BoardRef[]) => void | Promise<void>;
}

/**
 * Boards being loaded that may not have a local row yet, with how many loads
 * hold each. Once a board is in Dexie the board list keeps it watched; once
 * it leaves Dexie (left, deleted) and no load holds it, its events stop.
 */
const loadingBoards = new Map<string, number>();
let activeSubscription: JetstreamSubscription | null = null;

/**
 * Receive live events for a board while it loads. Call before loading it, so
 * nothing that happens during the load is missed, and call the returned
 * release function once the load has finished.
 */
export function watchBoard(boardUri: string): () => void {
  loadingBoards.set(boardUri, (loadingBoards.get(boardUri) ?? 0) + 1);
  activeSubscription?.refreshBoards();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const holds = (loadingBoards.get(boardUri) ?? 1) - 1;
    if (holds > 0) loadingBoards.set(boardUri, holds);
    else loadingBoards.delete(boardUri);
    // No refresh here: the board list may not have caught up with a row the
    // load just wrote, and dropping the board until it does would lose
    // events. The next board-list update settles it either way.
  };
}

export class JetstreamSubscription {
  private ws: WebSocket | null = null;
  private shouldReconnect = true;
  private reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private onlineListener: (() => void) | null = null;
  private visibilityListener: (() => void) | null = null;
  /** Boards with a local row, as last reported by `setBoards`. */
  private listedBoards = new Set<string>();
  private boards = new Map<string, BoardRef>();
  private lastCursorUs: number | null = null;
  private hiddenSince: number | null = null;
  private resyncing: Promise<void> | null = null;
  private resyncAgain = false;
  /** Events are applied strictly in arrival order. */
  private queue: Promise<void> = Promise.resolve();

  constructor(private handlers: JetstreamHandlers) {}

  /** Set the boards held locally. Replaces the previous set. */
  setBoards(boardUris: Iterable<string>): void {
    this.listedBoards = new Set(boardUris);
    this.refreshBoards();
  }

  /** Watch exactly the local boards plus any still loading. */
  refreshBoards(): void {
    const boards = new Map<string, BoardRef>();
    for (const uri of [...this.listedBoards, ...loadingBoards.keys()]) {
      const ref = this.boards.get(uri) ?? parseBoardUri(uri);
      if (ref) boards.set(uri, ref);
    }
    this.boards = boards;
  }

  connect(): void {
    this.shouldReconnect = true;
    activeSubscription = this;
    this.refreshBoards();
    if (this.ws) return;
    // Replay from before this subscription began (see FIRST_CONNECT_REWIND_MS)
    this.lastCursorUs ??= (Date.now() - FIRST_CONNECT_REWIND_MS) * 1000;

    if (typeof navigator !== "undefined" && !navigator.onLine) {
      this.waitForOnline();
      return;
    }

    const params = new URLSearchParams();
    for (const collection of ALL_COLLECTIONS) {
      params.append("wantedCollections", collection);
    }
    const replayFrom = this.replayCursor();
    if (replayFrom !== null) params.append("cursor", String(replayFrom));

    const ws = new WebSocket(`${JETSTREAM_URL}?${params.toString()}`);
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
      // A connection that couldn't replay from a cursor has an unknown gap in
      // it, so fall back to reloading every subscribed board
      if (replayFrom === null) void this.resyncAll();
    };

    ws.onmessage = (event: MessageEvent) => {
      // A replaced socket's stragglers would land after its successor's replay
      if (this.ws !== ws) return;
      // Handling is async (Dexie), so without the queue a delete could look
      // up its row before the preceding create had written it
      this.queue = this.queue
        .then(() => this.handleMessage(event))
        .catch((err) => console.error("Jetstream event failed:", err));
    };

    ws.onclose = () => {
      // A socket replaced by `reconnectNow` must not touch its successor
      if (this.ws !== ws) return;
      this.ws = null;
      this.scheduleReconnect();
    };

    ws.onerror = () => {
      // `close` always follows, which is where reconnection is handled
    };

    if (!this.visibilityListener && typeof document !== "undefined") {
      this.visibilityListener = () => this.handleVisibilityChange();
      document.addEventListener("visibilitychange", this.visibilityListener);
    }
  }

  disconnect(): void {
    this.shouldReconnect = false;
    if (activeSubscription === this) activeSubscription = null;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.onlineListener) {
      window.removeEventListener("online", this.onlineListener);
      this.onlineListener = null;
    }
    if (this.visibilityListener) {
      document.removeEventListener("visibilitychange", this.visibilityListener);
      this.visibilityListener = null;
    }
    const ws = this.ws;
    this.ws = null;
    ws?.close();
  }

  private replayCursor(): number | null {
    if (this.lastCursorUs === null) return null;
    const ageMs = Date.now() - this.lastCursorUs / 1000;
    if (ageMs > MAX_REPLAY_AGE_MS) return null;
    return this.lastCursorUs - REPLAY_OVERLAP_US;
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect || this.reconnectTimer) return;

    if (typeof navigator !== "undefined" && !navigator.onLine) {
      this.waitForOnline();
      return;
    }

    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(delay * 2, MAX_RECONNECT_DELAY_MS);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.shouldReconnect) this.connect();
    }, delay);
  }

  private waitForOnline(): void {
    if (this.onlineListener || typeof window === "undefined") return;
    this.onlineListener = () => {
      this.onlineListener = null;
      this.reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
      if (this.shouldReconnect) this.connect();
    };
    window.addEventListener("online", this.onlineListener, { once: true });
  }

  private handleVisibilityChange(): void {
    if (document.visibilityState === "hidden") {
      this.hiddenSince = Date.now();
      return;
    }

    const hiddenMs = this.hiddenSince ? Date.now() - this.hiddenSince : 0;
    this.hiddenSince = null;

    if (this.ws?.readyState === WebSocket.OPEN) {
      // A socket that sat in a background tab may have been dropped without
      // a close event. Reopening from the last cursor replays anything it
      // missed, which is far cheaper than reloading every board.
      if (hiddenMs > RECONNECT_AFTER_HIDDEN_MS) this.reconnectNow();
      return;
    }

    // Reconnect right away rather than waiting out the backoff
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
    if (this.shouldReconnect && !this.ws) this.connect();
  }

  private reconnectNow(): void {
    if (!this.shouldReconnect) return;
    const ws = this.ws;
    this.ws = null;
    ws?.close();
    this.connect();
  }

  /**
   * Reload every watched board. A request that arrives while a reload is
   * running gets one more reload once it finishes, since the running one may
   * have read some PDSes before the new gap began.
   */
  private resyncAll(): Promise<void> {
    if (this.resyncing) {
      this.resyncAgain = true;
      return this.resyncing;
    }
    this.resyncing = (async () => {
      try {
        do {
          this.resyncAgain = false;
          try {
            await this.handlers.onResync([...this.boards.values()]);
          } catch (err) {
            console.error("Jetstream resync failed:", err);
          }
        } while (this.resyncAgain && this.shouldReconnect);
      } finally {
        this.resyncing = null;
      }
    })();
    return this.resyncing;
  }

  private async handleMessage(event: MessageEvent): Promise<void> {
    let data: CommitEvent;
    try {
      data = JSON.parse(event.data as string) as CommitEvent;
    } catch {
      return;
    }

    if (data.time_us) this.lastCursorUs = data.time_us;
    if (data.kind !== "commit" || !data.commit) return;

    const { did } = data;
    const { operation, collection, rkey, record } = data.commit;

    // A delete event carries no record, so the local row is the only thing
    // that can say which board it belonged to — the lookup has to happen
    // first. It's an indexed miss for records we never cached.
    if (operation === "delete") {
      const boardUri = await applyRecordDelete(did, collection, rkey);
      if (boardUri && this.boards.has(boardUri)) {
        await this.handlers.onBoardUpdate(boardUri);
      }
      return;
    }

    if (!record) return;

    // Jetstream is a firehose of everyone's records; skip anything that isn't
    // for a board we're watching before touching Dexie.
    const boardUri =
      collection === BOARD_COLLECTION
        ? buildAtUri(did, BOARD_COLLECTION, rkey)
        : typeof record.boardUri === "string"
          ? record.boardUri
          : null;
    if (!boardUri || !this.boards.has(boardUri)) return;

    const applied = await applyRecordUpsert(did, collection, rkey, record);
    if (applied) await this.handlers.onBoardUpdate(applied);
  }
}
