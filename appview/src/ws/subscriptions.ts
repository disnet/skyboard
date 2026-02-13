import type { ServerWebSocket } from "bun";

export interface WsData {
  boardUri: string;
}

// Map from boardUri -> set of connected WebSockets
const subscribers = new Map<string, Set<ServerWebSocket<WsData>>>();

export function subscribe(ws: ServerWebSocket<WsData>): void {
  const { boardUri } = ws.data;
  let set = subscribers.get(boardUri);
  if (!set) {
    set = new Set();
    subscribers.set(boardUri, set);
  }
  set.add(ws);
}

export function unsubscribe(ws: ServerWebSocket<WsData>): void {
  const { boardUri } = ws.data;
  const set = subscribers.get(boardUri);
  if (set) {
    set.delete(ws);
    if (set.size === 0) {
      subscribers.delete(boardUri);
    }
  }
}

/**
 * Notify all WebSocket subscribers of a board that it has been updated.
 * Clients receive a simple `{ type: "update", boardUri }` message
 * and re-fetch the board data via the REST API.
 */
export function broadcast(boardUri: string): void {
  const set = subscribers.get(boardUri);
  if (!set || set.size === 0) return;

  const msg = JSON.stringify({ type: "update", boardUri });
  for (const ws of set) {
    ws.send(msg);
  }
}
