# Skyboard Appview

A caching appview service for Skyboard that aggregates AT Protocol data and serves it via REST API and WebSocket.

## Why

The Skyboard client normally fetches board data directly from each participant's PDS (Personal Data Server), which requires multiple sequential requests across different hosts. The appview acts as a centralized cache — one request returns the entire board with all tasks, ops, trusts, comments, approvals, and reactions pre-fetched.

## Architecture

```
Browser ──REST/WS──> Appview ──> SQLite (local cache)
                        │
                        ├── Jetstream (real-time firehose from bsky.network)
                        └── PDS fetch (backfill on demand)
```

- **Bun** runtime with built-in SQLite and WebSocket support
- **Hono** for HTTP routing
- **SQLite** (WAL mode) on a persistent volume for data storage
- **Jetstream** WebSocket consumer for real-time AT Protocol events
- **PDS backfill** for on-demand and startup catch-up

## Data Flow

### Real-time ingestion

The Jetstream consumer subscribes to all `dev.skyboard.*` collections on the AT Protocol firehose. Incoming events are validated with Zod and upserted into SQLite. Board participants are tracked automatically as new DIDs appear.

### On-demand backfill

When a client requests a board that isn't cached, the appview fetches the board record, trusts, and all participant data directly from their PDS endpoints. This data is stored in SQLite for future requests.

### Startup recovery

The Jetstream cursor is persisted in SQLite. On restart:

- If the cursor is fresh (<48h old), Jetstream resumes from where it left off.
- If the cursor is stale, the appview serves existing (stale) data immediately while backfilling all known boards in the background. Connected WebSocket clients are notified as each board is refreshed.

This makes auto-stop on Fly safe — the machine can sleep and recover gracefully.

## API

### `GET /board/:did/:rkey`

Returns a full board with materialized tasks (per-field LWW merge applied), raw tasks/ops, comments, approvals, reactions, and trusts. Triggers a PDS backfill if the board isn't cached yet.

### `GET /health`

Returns `{ "ok": true }`.

### `WS /ws?boardUri=at://...`

WebSocket endpoint for real-time updates. The server pushes `{ "type": "update", "boardUri": "..." }` whenever a board's data changes. Clients should re-fetch the board via REST on receiving an update.

## Development

```sh
bun install
bun run dev     # starts with --watch
```

The server runs on `http://localhost:3002` by default. Configure with environment variables:

- `PORT` — HTTP port (default: 3002)
- `DB_PATH` — SQLite database file path (default: `./data/skyboard.db`)
- `JETSTREAM_URL` — Jetstream WebSocket URL (default: `wss://jetstream2.us-east.bsky.network/subscribe`)

## Deployment

Deploys to Fly.io with a persistent volume for the SQLite database:

```sh
cd appview
fly deploy
fly volumes create skyboard_data --region sjc --size 1
```

The `fly.toml` mounts the volume at `/data` where the SQLite file lives. Auto-stop is enabled — see "Startup recovery" above for how stale data is handled.

## Project Structure

```
src/
  index.ts              Entry point (Bun.serve + Jetstream + backfill)
  config.ts             Environment configuration
  shared/
    schemas.ts          Zod validation schemas (mirrored from client)
    collections.ts      AT Protocol collection constants
  db/
    schema.sql          SQLite table definitions
    client.ts           Database helpers (upsert, query, delete)
  firehose/
    jetstream.ts        Jetstream WebSocket consumer
    processor.ts        Event validation and SQLite ingestion
  backfill/
    pds.ts              DID resolution and PDS record fetching
  api/
    router.ts           Hono routes
    get-board.ts        Board materialization and response building
  ws/
    subscriptions.ts    WebSocket subscription management
```
