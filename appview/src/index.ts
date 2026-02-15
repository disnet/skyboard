import { config } from "./config.js";
import { getDb, getAllBoards } from "./db/client.js";
import { app } from "./api/router.js";
import { JetstreamConsumer } from "./firehose/jetstream.js";
import { backfillBoard } from "./backfill/pds.js";
import { broadcast } from "./ws/subscriptions.js";
import { subscribe, unsubscribe, type WsData } from "./ws/subscriptions.js";

// Initialize DB (runs migrations)
getDb();

// Start Jetstream consumer
const jetstream = new JetstreamConsumer();
jetstream.connect();

// If cursor was stale, backfill all known boards in the background
if (jetstream.cursorWasStale) {
  (async () => {
    const boards = getAllBoards();
    console.log(
      `[backfill] Cursor stale, backfilling ${boards.length} boards...`,
    );
    for (const board of boards) {
      try {
        await backfillBoard(board.did, board.rkey);
        broadcast(board.uri);
      } catch (err) {
        console.warn(`[backfill] Failed for ${board.uri}:`, err);
      }
    }
    console.log("[backfill] Startup backfill complete");
  })();
}

// Start HTTP + WebSocket server
const server = Bun.serve<WsData>({
  port: config.port,
  fetch(req, server) {
    const url = new URL(req.url);

    // WebSocket upgrade: /ws?boardUri=at://...
    if (url.pathname === "/ws") {
      const boardUri = url.searchParams.get("boardUri");
      if (!boardUri) {
        return new Response("Missing boardUri parameter", { status: 400 });
      }
      const upgraded = server.upgrade(req, { data: { boardUri } });
      if (upgraded) return undefined;
      return new Response("WebSocket upgrade failed", { status: 500 });
    }

    // All other routes handled by Hono
    return app.fetch(req);
  },
  websocket: {
    open(ws) {
      subscribe(ws);
    },
    close(ws) {
      unsubscribe(ws);
    },
    message() {
      // Clients don't send messages; server pushes updates
    },
  },
});

console.log(`[appview] Listening on http://localhost:${server.port}`);

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("[appview] Shutting down...");
  jetstream.disconnect();
  server.stop();
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("[appview] Shutting down...");
  jetstream.disconnect();
  server.stop();
  process.exit(0);
});
