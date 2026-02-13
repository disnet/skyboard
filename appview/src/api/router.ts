import { Hono } from "hono";
import { cors } from "hono/cors";
import { getBoardData } from "./get-board.js";
import { backfillBoard } from "../backfill/pds.js";

export const app = new Hono();

app.use("*", cors());

app.get("/health", (c) => c.json({ ok: true }));

/**
 * GET /board/:did/:rkey
 *
 * Returns the fully materialized board with tasks, comments, approvals,
 * reactions, and trusts. If the board isn't in the local cache yet,
 * triggers a backfill from the PDS.
 */
app.get("/board/:did/:rkey", async (c) => {
  const did = c.req.param("did");
  const rkey = c.req.param("rkey");

  let data = getBoardData(did, rkey);

  if (!data) {
    // Board not cached yet — backfill from PDS
    await backfillBoard(did, rkey);
    data = getBoardData(did, rkey);
  }

  if (!data) {
    return c.json({ error: "Board not found" }, 404);
  }

  return c.json(data);
});
