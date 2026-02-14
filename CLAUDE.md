# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — Start dev server at http://127.0.0.1:3001
- `npm run build` — Build static site (output in `build/`)
- `npm run preview` — Preview production build
- `npm run check` — Run svelte-check for type checking (no test runner configured)

## Architecture

Skyboard is a collaborative kanban board built on the AT Protocol (atproto). The web app uses Svelte 5 with SvelteKit as a fully client-side SPA (SSR and prerendering are disabled in `+layout.ts`). It deploys as a static site via `@sveltejs/adapter-static` with a `200.html` fallback for SPA routing.

An **appview** server (`appview/`) aggregates board data from all participants and serves it to clients. Clients read from the appview and write to their own PDS.

### Data Model: Four Record Types

All data is stored as AT Protocol records in each user's repo. Collection constants are in `src/lib/types.ts`:

- **Board** (`dev.skyboard.board`) — name, columns, permission rules. Owned by creator.
- **Task** (`dev.skyboard.task`) — title, description, columnId, position. Write-once: captures initial state at creation and is **never updated directly**.
- **Op** (`dev.skyboard.op`) — a partial field update targeting a task by AT URI. All edits (even to your own tasks) go through ops so per-field LWW timestamps stay correct.
- **Trust** (`dev.skyboard.trust`) — per-board grant allowing another user's ops to take effect.

`Board`, `Task`, `Op`, and `Trust` are the local Dexie models (with auto-increment `id` and `syncStatus`). `BoardRecord`, `TaskRecord`, `OpRecord`, and `TrustRecord` are the wire format for PDS storage (no local fields). Both sets defined in `src/lib/types.ts`.

### Data Flow: Appview for Reads, PDS for Writes

**Reading:** The browser fetches full board state from the appview (`src/lib/appview.ts`) via `GET /board/:did/:rkey`. The response includes all tasks, ops, trusts, comments, approvals, and reactions, which are upserted into Dexie. Local pending records take priority over appview data (local-wins).

**Writing:** All mutations write to Dexie first with `syncStatus: 'pending'`. Background sync (`src/lib/sync.ts`) pushes pending records to the user's PDS via `putRecord`/`deleteRecord`.

**Real-time:** The browser subscribes to the appview's WebSocket (`AppviewSubscription` in `src/lib/appview.ts`). When the appview detects changes (via Jetstream), it sends an update notification and the client re-fetches the board.

### Appview

The appview (`appview/`) is a Bun + SQLite caching server deployed on Fly.io:

- Subscribes to Jetstream for real-time ingestion of all `dev.skyboard.*` records
- Backfills from PDS endpoints on demand when a board is first requested
- Serves full board state via REST and pushes update notifications via WebSocket
- Persists Jetstream cursor for graceful restart recovery (safe with Fly auto-stop)

See `appview/README.md` for API docs, development, and deployment.

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
