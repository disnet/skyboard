import { db } from "./db.js";
import {
  TASK_COLLECTION,
  OP_COLLECTION,
  TRUST_COLLECTION,
  COMMENT_COLLECTION,
  APPROVAL_COLLECTION,
  REACTION_COLLECTION,
} from "./tid.js";
import {
  safeParse,
  TaskRecordSchema,
  OpRecordSchema,
  TrustRecordSchema,
  CommentRecordSchema,
  ApprovalRecordSchema,
  ReactionRecordSchema,
} from "./schemas.js";

const JETSTREAM_URL = "wss://jetstream2.us-east.bsky.network/subscribe";

// 48 hours in microseconds — well within Jetstream's ~72h retention window
const CURSOR_MAX_AGE_US = 48 * 60 * 60 * 1_000_000;

export interface JetstreamCommitEvent {
  did: string;
  time_us: number;
  kind: "commit";
  commit: {
    rev: string;
    operation: "create" | "update" | "delete";
    collection: string;
    rkey: string;
    record?: Record<string, unknown>;
  };
}

export interface JetstreamOptions {
  wantedCollections: string[];
  cursor?: number;
  onEvent: (event: JetstreamCommitEvent) => void;
  onError?: (error: Event) => void;
  onConnect?: () => void;
  onReconnect?: () => void;
}

const CURSOR_KEY = "jetstream-cursor";
const CURSOR_SAVE_INTERVAL = 5000;

export class JetstreamClient {
  private ws: WebSocket | null = null;
  private options: JetstreamOptions;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000;
  private shouldReconnect = true;
  private lastCursor: number | null = null;
  private cursorSaveTimer: ReturnType<typeof setInterval> | null = null;
  private hasConnectedBefore = false;
  private onlineListener: (() => void) | null = null;

  constructor(options: JetstreamOptions) {
    this.options = options;
    if (options.cursor) {
      this.lastCursor = options.cursor;
    }
  }

  connect(): void {
    if (!navigator.onLine) {
      this.onlineListener = () => {
        this.onlineListener = null;
        if (this.shouldReconnect) {
          this.connect();
        }
      };
      window.addEventListener("online", this.onlineListener, { once: true });
      return;
    }

    const params = new URLSearchParams();
    for (const collection of this.options.wantedCollections) {
      params.append("wantedCollections", collection);
    }
    if (this.lastCursor) {
      params.append("cursor", String(this.lastCursor));
    }

    const url = `${JETSTREAM_URL}?${params.toString()}`;
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.reconnectDelay = 1000;
      if (this.hasConnectedBefore) {
        this.options.onReconnect?.();
      }
      this.hasConnectedBefore = true;
      this.options.onConnect?.();
      this.startCursorSaving();
    };

    this.ws.onmessage = (event: MessageEvent) => {
      this.handleMessage(event);
    };

    this.ws.onerror = (event: Event) => {
      this.options.onError?.(event);
    };

    this.ws.onclose = () => {
      this.stopCursorSaving();
      this.handleClose();
    };
  }

  private handleMessage(event: MessageEvent): void {
    try {
      const data = JSON.parse(event.data as string) as JetstreamCommitEvent;
      if (data.kind !== "commit") return;
      if (data.time_us) {
        this.lastCursor = data.time_us;
        this.options.onEvent(data);
      }
    } catch {
      // Ignore malformed messages
    }
  }

  private handleClose(): void {
    if (!this.shouldReconnect) return;

    if (!navigator.onLine) {
      // Wait for connectivity instead of retrying into the void
      this.onlineListener = () => {
        this.onlineListener = null;
        if (this.shouldReconnect) {
          this.reconnectDelay = 1000;
          this.connect();
        }
      };
      window.addEventListener("online", this.onlineListener, { once: true });
      return;
    }

    setTimeout(() => {
      if (this.shouldReconnect) {
        this.reconnectDelay = Math.min(
          this.reconnectDelay * 2,
          this.maxReconnectDelay,
        );
        this.connect();
      }
    }, this.reconnectDelay);
  }

  private startCursorSaving(): void {
    this.cursorSaveTimer = setInterval(() => {
      if (this.lastCursor) {
        saveJetstreamCursor(this.lastCursor).catch(console.error);
      }
    }, CURSOR_SAVE_INTERVAL);
  }

  private stopCursorSaving(): void {
    if (this.cursorSaveTimer) {
      clearInterval(this.cursorSaveTimer);
      this.cursorSaveTimer = null;
    }
    // Save final cursor
    if (this.lastCursor) {
      saveJetstreamCursor(this.lastCursor).catch(console.error);
    }
  }

  disconnect(): void {
    this.shouldReconnect = false;
    if (this.onlineListener) {
      window.removeEventListener("online", this.onlineListener);
      this.onlineListener = null;
    }
    this.stopCursorSaving();
    this.ws?.close();
    this.ws = null;
  }
}

export function isCursorStale(cursor: number): boolean {
  const nowUs = Date.now() * 1000;
  return nowUs - cursor > CURSOR_MAX_AGE_US;
}

export async function loadJetstreamCursor(): Promise<number | undefined> {
  try {
    const value = localStorage.getItem(CURSOR_KEY);
    if (!value) return undefined;
    const cursor = Number(value);
    // Discard cursors older than the retention window
    if (isCursorStale(cursor)) {
      localStorage.removeItem(CURSOR_KEY);
      return undefined;
    }
    return cursor;
  } catch {
    return undefined;
  }
}

async function saveJetstreamCursor(cursor: number): Promise<void> {
  try {
    localStorage.setItem(CURSOR_KEY, String(cursor));
  } catch {
    // Ignore storage errors
  }
}

/**
 * Process a Jetstream event and upsert it into the local DB.
 * Stores all task/op/trust events regardless of board — the UI queries
 * already filter by boardUri, and skipping events here would cause
 * the cursor to advance past data for boards not currently viewed.
 *
 * Returns the DID of the event author and the boardUri if it was relevant
 * (for known participant tracking).
 */
export async function processJetstreamEvent(
  event: JetstreamCommitEvent,
): Promise<{ did: string; boardUri: string } | null> {
  const { did, commit } = event;

  if (commit.operation === "delete") {
    if (commit.collection === TASK_COLLECTION) {
      const existing = await db.tasks
        .where("[did+rkey]")
        .equals([did, commit.rkey])
        .first();
      if (existing?.id) {
        const boardUri = existing.boardUri;
        await db.tasks.delete(existing.id);
        return { did, boardUri };
      }
    } else if (commit.collection === OP_COLLECTION) {
      const existing = await db.ops
        .where("[did+rkey]")
        .equals([did, commit.rkey])
        .first();
      if (existing?.id) {
        const boardUri = existing.boardUri;
        await db.ops.delete(existing.id);
        return { did, boardUri };
      }
    } else if (commit.collection === TRUST_COLLECTION) {
      const existing = await db.trusts
        .where("[did+rkey]")
        .equals([did, commit.rkey])
        .first();
      if (existing?.id) {
        const boardUri = existing.boardUri;
        await db.trusts.delete(existing.id);
        return { did, boardUri };
      }
    } else if (commit.collection === COMMENT_COLLECTION) {
      const existing = await db.comments
        .where("[did+rkey]")
        .equals([did, commit.rkey])
        .first();
      if (existing?.id) {
        const boardUri = existing.boardUri;
        await db.comments.delete(existing.id);
        return { did, boardUri };
      }
    } else if (commit.collection === APPROVAL_COLLECTION) {
      const existing = await db.approvals
        .where("[did+rkey]")
        .equals([did, commit.rkey])
        .first();
      if (existing?.id) {
        const boardUri = existing.boardUri;
        await db.approvals.delete(existing.id);
        return { did, boardUri };
      }
    } else if (commit.collection === REACTION_COLLECTION) {
      const existing = await db.reactions
        .where("[did+rkey]")
        .equals([did, commit.rkey])
        .first();
      if (existing?.id) {
        const boardUri = existing.boardUri;
        await db.reactions.delete(existing.id);
        return { did, boardUri };
      }
    }
    return null;
  }

  if (!commit.record) return null;

  const record = commit.record;
  const boardUri = record.boardUri as string | undefined;

  if (!boardUri) return null;

  if (commit.collection === TASK_COLLECTION) {
    const validated = safeParse(TaskRecordSchema, record, "TaskRecord (jetstream)");
    if (!validated) return null;

    const existing = await db.tasks
      .where("[did+rkey]")
      .equals([did, commit.rkey])
      .first();

    const taskData = {
      rkey: commit.rkey,
      did,
      title: validated.title,
      description: validated.description,
      columnId: validated.columnId,
      boardUri,
      position: validated.position,
      labelIds: validated.labelIds,
      order: validated.order ?? 0,
      createdAt: validated.createdAt,
      updatedAt: validated.updatedAt,
      syncStatus: "synced" as const,
    };

    if (existing?.id) {
      if (existing.syncStatus === "pending") return { did, boardUri };
      await db.tasks.update(existing.id, taskData);
    } else {
      await db.tasks.add(taskData);
    }
    return { did, boardUri };
  }

  if (commit.collection === OP_COLLECTION) {
    const validated = safeParse(OpRecordSchema, record, "OpRecord (jetstream)");
    if (!validated) return null;

    const existing = await db.ops
      .where("[did+rkey]")
      .equals([did, commit.rkey])
      .first();

    const opData = {
      rkey: commit.rkey,
      did,
      targetTaskUri: validated.targetTaskUri,
      boardUri,
      fields: validated.fields,
      createdAt: validated.createdAt,
      syncStatus: "synced" as const,
    };

    if (existing?.id) {
      if (existing.syncStatus === "pending") return { did, boardUri };
      await db.ops.update(existing.id, opData);
    } else {
      await db.ops.add(opData);
    }
    return { did, boardUri };
  }

  if (commit.collection === TRUST_COLLECTION) {
    const validated = safeParse(TrustRecordSchema, record, "TrustRecord (jetstream)");
    if (!validated) return null;

    const existing = await db.trusts
      .where("[did+boardUri+trustedDid]")
      .equals([did, boardUri, validated.trustedDid])
      .first();

    const trustData = {
      rkey: commit.rkey,
      did,
      trustedDid: validated.trustedDid,
      boardUri,
      createdAt: validated.createdAt,
      syncStatus: "synced" as const,
    };

    if (existing?.id) {
      if (existing.syncStatus === "pending") return { did, boardUri };
      await db.trusts.update(existing.id, trustData);
    } else {
      await db.trusts.add(trustData);
    }
    return { did, boardUri };
  }

  if (commit.collection === COMMENT_COLLECTION) {
    const validated = safeParse(CommentRecordSchema, record, "CommentRecord (jetstream)");
    if (!validated) return null;

    const existing = await db.comments
      .where("[did+rkey]")
      .equals([did, commit.rkey])
      .first();

    const commentData = {
      rkey: commit.rkey,
      did,
      targetTaskUri: validated.targetTaskUri,
      boardUri,
      text: validated.text,
      createdAt: validated.createdAt,
      syncStatus: "synced" as const,
    };

    if (existing?.id) {
      if (existing.syncStatus === "pending") return { did, boardUri };
      await db.comments.update(existing.id, commentData);
    } else {
      await db.comments.add(commentData);
    }
    return { did, boardUri };
  }

  if (commit.collection === APPROVAL_COLLECTION) {
    const validated = safeParse(ApprovalRecordSchema, record, "ApprovalRecord (jetstream)");
    if (!validated) return null;

    const existing = await db.approvals
      .where("[did+rkey]")
      .equals([did, commit.rkey])
      .first();

    const approvalData = {
      rkey: commit.rkey,
      did,
      targetUri: validated.targetUri,
      boardUri,
      createdAt: validated.createdAt,
      syncStatus: "synced" as const,
    };

    if (existing?.id) {
      if (existing.syncStatus === "pending") return { did, boardUri };
      await db.approvals.update(existing.id, approvalData);
    } else {
      await db.approvals.add(approvalData);
    }
    return { did, boardUri };
  }

  if (commit.collection === REACTION_COLLECTION) {
    const validated = safeParse(ReactionRecordSchema, record, "ReactionRecord (jetstream)");
    if (!validated) return null;

    const existing = await db.reactions
      .where("[did+rkey]")
      .equals([did, commit.rkey])
      .first();

    const reactionData = {
      rkey: commit.rkey,
      did,
      targetTaskUri: validated.targetTaskUri,
      boardUri,
      emoji: validated.emoji,
      createdAt: validated.createdAt,
      syncStatus: "synced" as const,
    };

    if (existing?.id) {
      if (existing.syncStatus === "pending") return { did, boardUri };
      await db.reactions.update(existing.id, reactionData);
    } else {
      await db.reactions.add(reactionData);
    }
    return { did, boardUri };
  }

  return null;
}
