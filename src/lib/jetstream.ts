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
const RESYNC_AFTER_HIDDEN_MS = 60_000;

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
 * Boards a page has asked to watch. They are kept across subscriptions so a
 * board opened before the socket exists (or across a re-login) still gets
 * events once one does.
 */
const watchedBoards = new Set<string>();
let activeSubscription: JetstreamSubscription | null = null;

/**
 * Receive live events for a board. Call before loading it, so nothing that
 * happens during the load is missed.
 */
export function watchBoard(boardUri: string): void {
  watchedBoards.add(boardUri);
  activeSubscription?.subscribe(boardUri);
}

export class JetstreamSubscription {
  private ws: WebSocket | null = null;
  private shouldReconnect = true;
  private reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private onlineListener: (() => void) | null = null;
  private visibilityListener: (() => void) | null = null;
  private boards = new Map<string, BoardRef>();
  private lastCursorUs: number | null = null;
  private hasConnected = false;
  private hiddenSince: number | null = null;
  private resyncing = false;
  /** Events are applied strictly in arrival order. */
  private queue: Promise<void> = Promise.resolve();
  /** Set when a caller stopped waiting for the first open (see waitForOpen). */
  private resyncOnFirstOpen = false;
  private openWaiters: Array<() => void> = [];

  constructor(private handlers: JetstreamHandlers) {}

  /**
   * Resolve once the socket is open, so a load started afterwards can't fall
   * in the gap before events start flowing. If it takes longer than
   * `timeoutMs` this resolves anyway, and the eventual open reloads every
   * board to cover the gap.
   */
  waitForOpen(timeoutMs: number): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.resyncOnFirstOpen = true;
        resolve();
      }, timeoutMs);
      this.openWaiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  /** Start receiving events for a board. Does not load it. */
  subscribe(boardUri: string): void {
    const ref = parseBoardUri(boardUri);
    if (ref) this.boards.set(boardUri, ref);
  }

  unsubscribe(boardUri: string): void {
    this.boards.delete(boardUri);
  }

  connect(): void {
    this.shouldReconnect = true;
    activeSubscription = this;
    for (const boardUri of watchedBoards) this.subscribe(boardUri);
    if (this.ws) return;

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

    this.ws = new WebSocket(`${JETSTREAM_URL}?${params.toString()}`);

    this.ws.onopen = () => {
      this.reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
      // A connection that couldn't replay from a cursor has an unknown gap in
      // it, so fall back to reloading every subscribed board. The very first
      // open is covered by the caller's own load, unless it gave up waiting.
      if (
        replayFrom === null &&
        (this.hasConnected || this.resyncOnFirstOpen)
      ) {
        void this.resyncAll();
      }
      this.hasConnected = true;
      this.resyncOnFirstOpen = false;
      const waiters = this.openWaiters;
      this.openWaiters = [];
      for (const wake of waiters) wake();
    };

    this.ws.onmessage = (event: MessageEvent) => {
      // Handling is async (Dexie), so without the queue a delete could look
      // up its row before the preceding create had written it
      this.queue = this.queue
        .then(() => this.handleMessage(event))
        .catch((err) => console.error("Jetstream event failed:", err));
    };

    this.ws.onclose = () => {
      this.ws = null;
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
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
    const waiters = this.openWaiters;
    this.openWaiters = [];
    for (const wake of waiters) wake();
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

    if (this.ws?.readyState !== WebSocket.OPEN) {
      // Reconnect right away rather than waiting out the backoff
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      this.reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
      if (this.shouldReconnect && !this.ws) this.connect();
      return;
    }

    if (hiddenMs > RESYNC_AFTER_HIDDEN_MS) void this.resyncAll();
  }

  private async resyncAll(): Promise<void> {
    if (this.resyncing) return;
    this.resyncing = true;
    try {
      await this.handlers.onResync([...this.boards.values()]);
    } catch (err) {
      console.error("Jetstream resync failed:", err);
    } finally {
      this.resyncing = false;
    }
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
