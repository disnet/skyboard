import { db } from "./db.js";
import type {
  Board,
  Task,
  Op,
  Trust,
  Comment,
  Approval,
  Reaction,
} from "./types.js";
import { addKnownParticipant } from "./remote-sync.js";

const APPVIEW_URL =
  typeof window !== "undefined" &&
  (window as unknown as Record<string, unknown>).__SKYBOARD_APPVIEW_URL__
    ? String(
        (window as unknown as Record<string, unknown>).__SKYBOARD_APPVIEW_URL__,
      )
    : "https://skyboard-appview.fly.dev";

const APPVIEW_WS_URL = APPVIEW_URL.replace(/^http/, "ws");

/**
 * Compare two records on the given fields. Uses JSON.stringify for
 * array/object fields so deep equality is checked.
 */
function recordsEqual(
  existing: unknown,
  incoming: unknown,
  fields: string[],
): boolean {
  const ea = existing as Record<string, unknown>;
  const eb = incoming as Record<string, unknown>;
  for (const f of fields) {
    const va = ea[f];
    const vb = eb[f];
    if (va === vb) continue;
    if (
      typeof va === "object" &&
      typeof vb === "object" &&
      JSON.stringify(va) === JSON.stringify(vb)
    )
      continue;
    return false;
  }
  return true;
}

/**
 * Try to load a board from the appview. Returns true if successful,
 * false if the appview is unavailable or returns an error.
 *
 * On success, populates Dexie with raw tasks, ops, trusts, comments,
 * approvals, and reactions — same as the PDS fetch path.
 *
 * All writes are wrapped in a single transaction so liveQuery fires
 * once at commit instead of per-write, eliminating mid-batch re-renders.
 */
export async function loadBoardFromAppview(
  ownerDid: string,
  rkey: string,
  boardUri: string,
): Promise<boolean> {
  try {
    const res = await fetch(`${APPVIEW_URL}/board/${ownerDid}/${rkey}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return false;

    const data = await res.json();

    // Collect participants to register after the transaction
    const participantDids: string[] = [];

    await db.transaction(
      "rw",
      [
        db.boards,
        db.tasks,
        db.ops,
        db.trusts,
        db.comments,
        db.approvals,
        db.reactions,
      ],
      async () => {
        // Store board
        const boardData: Omit<Board, "id"> = {
          rkey: data.board.rkey,
          did: data.board.did,
          name: data.board.name,
          description: data.board.description ?? undefined,
          columns: data.board.columns,
          labels: data.board.labels,
          open: data.board.open || undefined,
          createdAt: data.board.createdAt,
          syncStatus: "synced",
        };

        const existingBoard = await db.boards
          .where("rkey")
          .equals(rkey)
          .first();
        if (existingBoard?.id) {
          if (existingBoard.syncStatus === "pending") {
            // Local pending wins — skip
          } else if (
            !recordsEqual(existingBoard, boardData, [
              "name",
              "description",
              "columns",
              "labels",
              "open",
              "createdAt",
            ])
          ) {
            await db.boards.update(existingBoard.id, boardData);
          }
        } else {
          await db.boards.add(boardData as Board);
        }

        // Store raw tasks
        for (const t of data.rawTasks ?? []) {
          const taskData: Omit<Task, "id"> = {
            rkey: t.rkey,
            did: t.did,
            title: t.title,
            description: t.description ?? undefined,
            columnId: t.columnId,
            boardUri: t.boardUri,
            position: t.position ?? undefined,
            labelIds: t.labelIds ?? undefined,
            order: t.order ?? 0,
            createdAt: t.createdAt,
            updatedAt: t.updatedAt ?? undefined,
            syncStatus: "synced",
          };

          const existing = await db.tasks
            .where("[did+rkey]")
            .equals([t.did, t.rkey])
            .first();
          if (existing?.id) {
            if (existing.syncStatus === "pending") continue;
            if (
              !recordsEqual(existing, taskData, [
                "title",
                "description",
                "columnId",
                "position",
                "labelIds",
                "order",
                "createdAt",
                "updatedAt",
              ])
            ) {
              await db.tasks.update(existing.id, taskData);
            }
          } else {
            await db.tasks.add(taskData as Task);
          }
          participantDids.push(t.did);
        }

        // Store raw ops
        for (const o of data.rawOps ?? []) {
          const opData: Omit<Op, "id"> = {
            rkey: o.rkey,
            did: o.did,
            targetTaskUri: o.targetTaskUri,
            boardUri: o.boardUri,
            fields: o.fields,
            createdAt: o.createdAt,
            syncStatus: "synced",
          };

          const existing = await db.ops
            .where("[did+rkey]")
            .equals([o.did, o.rkey])
            .first();
          if (existing?.id) {
            if (existing.syncStatus === "pending") continue;
            if (
              !recordsEqual(existing, opData, [
                "targetTaskUri",
                "fields",
                "createdAt",
              ])
            ) {
              await db.ops.update(existing.id, opData);
            }
          } else {
            await db.ops.add(opData as Op);
          }
          participantDids.push(o.did);
        }

        // Store trusts
        for (const t of data.trusts ?? []) {
          const trustData: Omit<Trust, "id"> = {
            rkey: t.rkey,
            did: t.did,
            trustedDid: t.trustedDid,
            boardUri,
            createdAt: t.createdAt,
            syncStatus: "synced",
          };

          const existing = await db.trusts
            .where("[did+boardUri+trustedDid]")
            .equals([t.did, boardUri, t.trustedDid])
            .first();
          if (existing?.id) {
            if (existing.syncStatus === "pending") continue;
            if (
              !recordsEqual(existing, trustData, ["trustedDid", "createdAt"])
            ) {
              await db.trusts.update(existing.id, trustData);
            }
          } else {
            await db.trusts.add(trustData as Trust);
          }
          participantDids.push(t.trustedDid);
        }

        // Store comments
        for (const c of data.comments ?? []) {
          const commentData: Omit<Comment, "id"> = {
            rkey: c.rkey,
            did: c.did,
            targetTaskUri: c.targetTaskUri,
            boardUri,
            text: c.text,
            createdAt: c.createdAt,
            syncStatus: "synced",
          };

          const existing = await db.comments
            .where("[did+rkey]")
            .equals([c.did, c.rkey])
            .first();
          if (existing?.id) {
            if (existing.syncStatus === "pending") continue;
            if (
              !recordsEqual(existing, commentData, [
                "targetTaskUri",
                "text",
                "createdAt",
              ])
            ) {
              await db.comments.update(existing.id, commentData);
            }
          } else {
            await db.comments.add(commentData as Comment);
          }
        }

        // Store approvals
        for (const a of data.approvals ?? []) {
          const approvalData: Omit<Approval, "id"> = {
            rkey: a.rkey,
            did: a.did,
            targetUri: a.targetUri,
            boardUri,
            createdAt: a.createdAt,
            syncStatus: "synced",
          };

          const existing = await db.approvals
            .where("[did+rkey]")
            .equals([a.did, a.rkey])
            .first();
          if (existing?.id) {
            if (existing.syncStatus === "pending") continue;
            if (
              !recordsEqual(existing, approvalData, ["targetUri", "createdAt"])
            ) {
              await db.approvals.update(existing.id, approvalData);
            }
          } else {
            await db.approvals.add(approvalData as Approval);
          }
        }

        // Store reactions
        for (const r of data.reactions ?? []) {
          const reactionData: Omit<Reaction, "id"> = {
            rkey: r.rkey,
            did: r.did,
            targetTaskUri: r.targetTaskUri,
            boardUri,
            emoji: r.emoji,
            createdAt: r.createdAt,
            syncStatus: "synced",
          };

          const existing = await db.reactions
            .where("[did+rkey]")
            .equals([r.did, r.rkey])
            .first();
          if (existing?.id) {
            if (existing.syncStatus === "pending") continue;
            if (
              !recordsEqual(existing, reactionData, [
                "targetTaskUri",
                "emoji",
                "createdAt",
              ])
            ) {
              await db.reactions.update(existing.id, reactionData);
            }
          } else {
            await db.reactions.add(reactionData as Reaction);
          }
        }
      },
    );

    // Register participants outside the transaction
    for (const did of participantDids) {
      await addKnownParticipant(did, boardUri);
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Subscribe to real-time updates for a board via the appview WebSocket.
 * On each "update" message, calls the provided callback.
 * Handles reconnection with exponential backoff.
 */
export class AppviewSubscription {
  private ws: WebSocket | null = null;
  private shouldReconnect = true;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000;
  private onlineListener: (() => void) | null = null;

  constructor(
    private boardUri: string,
    private onUpdate: () => void,
  ) {}

  connect(): void {
    if (typeof window !== "undefined" && !navigator.onLine) {
      this.onlineListener = () => {
        this.onlineListener = null;
        if (this.shouldReconnect) this.connect();
      };
      window.addEventListener("online", this.onlineListener, { once: true });
      return;
    }

    const url = `${APPVIEW_WS_URL}/ws?boardUri=${encodeURIComponent(this.boardUri)}`;
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.reconnectDelay = 1000;
    };

    this.ws.onmessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data as string);
        if (data.type === "update") {
          this.onUpdate();
        }
      } catch {
        // Ignore malformed messages
      }
    };

    this.ws.onclose = () => {
      if (!this.shouldReconnect) return;

      if (typeof window !== "undefined" && !navigator.onLine) {
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
    };
  }

  disconnect(): void {
    this.shouldReconnect = false;
    if (this.onlineListener) {
      window.removeEventListener("online", this.onlineListener);
      this.onlineListener = null;
    }
    this.ws?.close();
    this.ws = null;
  }
}
