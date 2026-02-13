import { config } from "../config.js";
import { getCursor, saveCursor } from "../db/client.js";
import { ALL_COLLECTIONS } from "../shared/collections.js";
import { processEvent, type CommitEvent } from "./processor.js";
import { broadcast } from "../ws/subscriptions.js";

const CURSOR_MAX_AGE_US = 48 * 60 * 60 * 1_000_000;
const CURSOR_SAVE_INTERVAL = 5_000;

function isCursorStale(cursor: number): boolean {
  const nowUs = Date.now() * 1000;
  return nowUs - cursor > CURSOR_MAX_AGE_US;
}

export class JetstreamConsumer {
  private ws: WebSocket | null = null;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000;
  private shouldReconnect = true;
  private lastCursor: number | null = null;
  private cursorSaveTimer: ReturnType<typeof setInterval> | null = null;
  private eventCount = 0;
  cursorWasStale = false;

  connect(): void {
    // Load saved cursor
    const savedCursor = getCursor();
    if (savedCursor && !isCursorStale(savedCursor)) {
      this.lastCursor = savedCursor;
    } else if (savedCursor) {
      this.cursorWasStale = true;
      console.log("[jetstream] Cursor is stale, will need backfill");
    }

    this.openSocket();
  }

  private openSocket(): void {
    const params = new URLSearchParams();
    for (const collection of ALL_COLLECTIONS) {
      params.append("wantedCollections", collection);
    }
    if (this.lastCursor) {
      params.append("cursor", String(this.lastCursor));
    }

    const url = `${config.jetstreamUrl}?${params.toString()}`;
    console.log("[jetstream] Connecting...");

    this.ws = new WebSocket(url);

    this.ws.addEventListener("open", () => {
      console.log("[jetstream] Connected");
      this.reconnectDelay = 1000;
      this.startCursorSaving();
    });

    this.ws.addEventListener("message", (event) => {
      this.handleMessage(event);
    });

    this.ws.addEventListener("error", (event) => {
      console.error("[jetstream] WebSocket error:", event);
    });

    this.ws.addEventListener("close", () => {
      this.stopCursorSaving();
      this.handleClose();
    });
  }

  private handleMessage(event: MessageEvent): void {
    try {
      const data = JSON.parse(
        typeof event.data === "string" ? event.data : "",
      ) as CommitEvent;
      if (data.kind !== "commit") return;
      if (!data.time_us) return;

      this.lastCursor = data.time_us;
      this.eventCount++;

      const boardUri = processEvent(data);
      if (boardUri) {
        broadcast(boardUri);
      }
    } catch {
      // Ignore malformed messages
    }
  }

  private handleClose(): void {
    if (!this.shouldReconnect) return;

    console.log(
      `[jetstream] Disconnected, reconnecting in ${this.reconnectDelay}ms...`,
    );
    setTimeout(() => {
      if (this.shouldReconnect) {
        this.reconnectDelay = Math.min(
          this.reconnectDelay * 2,
          this.maxReconnectDelay,
        );
        this.openSocket();
      }
    }, this.reconnectDelay);
  }

  private startCursorSaving(): void {
    this.cursorSaveTimer = setInterval(() => {
      if (this.lastCursor) {
        saveCursor(this.lastCursor);
      }
    }, CURSOR_SAVE_INTERVAL);
  }

  private stopCursorSaving(): void {
    if (this.cursorSaveTimer) {
      clearInterval(this.cursorSaveTimer);
      this.cursorSaveTimer = null;
    }
    if (this.lastCursor) {
      saveCursor(this.lastCursor);
    }
  }

  disconnect(): void {
    this.shouldReconnect = false;
    this.stopCursorSaving();
    this.ws?.close();
    this.ws = null;
    console.log(`[jetstream] Stopped. Processed ${this.eventCount} events.`);
  }
}
