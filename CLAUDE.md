# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — Start dev server at http://127.0.0.1:3001
- `npm run build` — Build static site (output in `build/`)
- `npm run preview` — Preview production build
- `npm run check` — Run svelte-check for type checking (no test runner configured)

## Architecture

Skyboard is a collaborative kanban board built on the AT Protocol (atproto). The web app uses Svelte 5 with SvelteKit as a fully client-side SPA (SSR and prerendering are disabled in `+layout.ts`). It deploys as a static site via `@sveltejs/adapter-static` with a `200.html` fallback for SPA routing.

The web app has **no server of its own**. It assembles board state in the browser from public atproto infrastructure: Constellation (backlink index) for discovery, participant PDSes for record content, and Jetstream for real-time updates. Writes go to the user's own PDS.

The `appview/` directory is the legacy aggregation server. Neither the web app nor the CLI uses it; retain it only for the rollout soak before decommissioning.

### Data Model: Four Record Types

All data is stored as AT Protocol records in each user's repo. Collection constants are in `src/lib/types.ts`:

- **Board** (`dev.skyboard.board`) — name, columns, permission rules. Owned by creator.
- **Task** (`dev.skyboard.task`) — title, description, columnId, position. Write-once: captures initial state at creation and is **never updated directly**.
- **Op** (`dev.skyboard.op`) — a partial field update targeting a task by AT URI. All edits (even to your own tasks) go through ops so per-field LWW timestamps stay correct.
- **Trust** (`dev.skyboard.trust`) — per-board grant allowing another user's ops to take effect.

`Board`, `Task`, `Op`, and `Trust` are the local Dexie models (with auto-increment `id` and `syncStatus`). `BoardRecord`, `TaskRecord`, `OpRecord`, and `TrustRecord` are the wire format for PDS storage (no local fields). Both sets defined in `src/lib/types.ts`.

### Data Flow: Constellation + PDS for Reads, PDS for Writes

**Reading:** `loadBoardFromConstellation(ownerDid, rkey, boardUri)` in `src/lib/constellation.ts`:

1. Read the board record from the owner's PDS (`com.atproto.repo.getRecord`) — the board is the link _target_, so Constellation can't return it. Failure here is the only thing that makes the load return `false`.
2. `GET /links/all?target=<boardUri>` on Constellation → which of the six child collections are non-empty.
3. `GET /links/distinct-dids` per collection → the participant DIDs.
4. `com.atproto.repo.listRecords` on each (participant × collection), keeping records whose `value.boardUri` matches. Run in parallel; a dead PDS is skipped, not fatal.
5. Upsert everything into Dexie in one transaction via `applyBoardSnapshot` (`src/lib/board-store.ts`).

Constellation only knows about records that still exist, so the fetch set is unioned with `localBoardFootprint()` — the collections and DIDs we already hold — otherwise emptied collections could never be pruned.

**Writing:** unchanged. All mutations write to Dexie first with `syncStatus: 'pending'`. Background sync (`src/lib/sync.ts`) pushes pending records to the user's PDS via `putRecord`/`deleteRecord`.

**Real-time:** one `JetstreamSubscription` (`src/lib/jetstream.ts`) for the whole app, subscribed to all `dev.skyboard.*` collections. Commit events carry the full record, so changes are applied straight to Dexie — no refetch. Reconnects replay from the last `time_us` cursor; if the gap exceeds an hour, subscribed boards are reloaded instead.

### Local-wins and pruning

Both read paths funnel through `src/lib/board-store.ts`, which enforces:

- a local record with `syncStatus: 'pending'` always beats remote data (this also swallows the echo of the user's own in-flight writes)
- unchanged records are not rewritten, so `liveQuery` doesn't churn
- records that vanished from a repo we successfully listed are deleted locally — but only for those (did, collection) pairs, so an unreachable PDS never causes data loss

Records from other people's repos are shape-checked by `src/lib/record-schemas.ts`, which mirrors the appview's zod schemas without adding zod to the bundle.

### Configuration

`vite.config.ts` defines `__SKYBOARD_CONSTELLATION_URL__` (`VITE_CONSTELLATION_URL`) and `__SKYBOARD_JETSTREAM_URL__` (`VITE_JETSTREAM_URL`). Both default to the public instances; keep them configurable so the services can be self-hosted.

### Appview (legacy)

`appview/` is a Bun + SQLite caching server on Fly.io. It is no longer in any client read path. Keep it during the rollout soak for old web bundles, then decommission it separately. See `appview/README.md`.

### Materialization and Conflict Resolution

`src/lib/materialize.ts` merges base tasks + ops into `MaterializedTask` objects for rendering:

1. Group ops by `targetTaskUri`
2. Filter trusted vs pending ops based on permissions (`src/lib/permissions.ts`)
3. Apply **per-field LWW** — each field (`title`, `description`, `columnId`, `position`) resolved independently by timestamp
4. Return `MaterializedTask` with `effectiveTitle`, `effectiveColumnId`, etc. plus `appliedOps[]` and `pendingOps[]`

**Fractional indexing**: Task ordering uses lexicographic position strings (`fractional-indexing` library). Moving a task generates a new position between neighbors — only the moved task gets an op. This is critical because you can only write to your own AT Protocol repo.

### Permissions System

Board owners configure per-operation permission rules with three scopes: `author_only`, `trusted`, `anyone`. Five operation types: `create_task`, `edit_title`, `edit_description`, `move_task`, `reorder`. Rules can be scoped to specific columns. Untrusted ops appear in the Proposals panel pending approval.

### AT Protocol Integration

- **Lexicons**: JSON schemas in `src/lib/lexicons/` for each record type
- **Auth**: OAuth via `@atproto/oauth-client-browser` (`src/lib/auth.svelte.ts`). In loopback/dev mode, the OAuth client auto-detects; in production, it uses `static/client-metadata.json`. The app must be accessed via `http://127.0.0.1:3001` (not `localhost`) for OAuth redirects to work in dev.
- **Record keys**: TIDs generated via `@atproto/common-web` (`src/lib/tid.ts`)
- **AT URIs**: Format `at://did:plc:xxx/dev.skyboard.board/rkey`. Helper: `buildAtUri(did, collection, rkey)` in `src/lib/types.ts`

### Svelte 5 Patterns

- Uses Svelte 5 runes (`$state`, `$derived`, `$effect`, `$props`)
- `QueryRune` (`src/lib/db.svelte.ts`) bridges Dexie's `liveQuery` observables to Svelte 5 reactivity — use `useLiveQuery()` for reactive database queries
- Auth state is exposed via `getAuth()` which returns an object with reactive getters

### Adding a New Lexicon Checklist

When adding a new AT Protocol record type (lexicon), always do the following:

1. Add `repo:dev.skyboard.<name>` to `OAUTH_SCOPE` in `src/lib/auth.svelte.ts`
2. In the board page (`src/routes/board/[did]/[rkey]/+page.svelte`), add a `$derived` that detects sync errors for the new collection (check for `syncStatus === "error"`) and add a reauth banner prompting the user to sign out and re-login to grant updated permissions (follow the existing pattern used for approvals and reactions)

### Routing

- `/` — Board list (`src/routes/+page.svelte`)
- `/board/[id]` — Board view where `[id]` is the board's `rkey` (`src/routes/board/[id]/+page.svelte`)
- `/board/did:[did]/[rkey]` — Public board viewer for logged-out users (`src/routes/board/[...path]/+page.svelte`)
