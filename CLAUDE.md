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

### Data Model

All data is stored as AT Protocol records in each user's repo. Collection constants are in `src/lib/tid.ts`. Types are in `src/lib/types.ts`.

The key design principle is **separation of concerns**: tasks are standalone entities, and their placement on boards is a separate record. This enables tasks to appear on multiple boards and supports both board-level and task-level trust.

#### Core record types

- **Board** (`dev.skyboard.board`) — name, columns, labels, open flag. Owned by creator.
- **Task** (`dev.skyboard.task`) — title, description, status (open/closed), open flag, labelIds, optional forkedFrom URI. Tasks are standalone — they no longer embed board/column/position.
- **Placement** (`dev.skyboard.placement`) — links a task to a board+column+position. This is how tasks appear on boards.
- **Project** (`dev.skyboard.project`) — a flat collection with name, description, labels. Used to group tasks outside of boards.
- **Membership** (`dev.skyboard.membership`) — links a task to a project.
- **Assignment** (`dev.skyboard.assignment`) — assigns a user (by DID) to a task.

#### Op types (CRDT-style per-field LWW edits)

- **Op** (`dev.skyboard.op`) — legacy combined op targeting a task within a board context. Kept for backward compat.
- **TaskOp** (`dev.skyboard.taskOp`) — task-level field changes (title, description, labelIds, status). No board context needed.
- **PlacementOp** (`dev.skyboard.placementOp`) — placement-level field changes (columnId, position, removed).

#### Trust types

- **Trust** (`dev.skyboard.trust`) — board-level trust grant (unchanged from before).
- **TaskTrust** (`dev.skyboard.taskTrust`) — task-level trust grant. Allows another user to edit a specific task via TaskOps.
- **ProjectTrust** (`dev.skyboard.projectTrust`) — project-level trust grant.

#### Other record types

- **Comment** (`dev.skyboard.comment`) — now task-scoped (boardUri optional for legacy compat).
- **Reaction** (`dev.skyboard.reaction`) — now task-scoped (boardUri optional for legacy compat).
- **Approval** (`dev.skyboard.approval`) — re-scoped with optional boardUri and taskUri for both board-level and task-level approvals.

Each type has a local Dexie model (with auto-increment `id` and `syncStatus`) and a wire-format `*Record` type for PDS storage.

### Data Flow: Appview for Reads, PDS for Writes

**Reading:** The browser fetches full board state from the appview (`src/lib/appview.ts`) via `GET /board/:did/:rkey`. The response includes all tasks, ops, taskOps, trusts, taskTrusts, placements, placementOps, comments, approvals, reactions, and assignments, which are upserted into Dexie. Local pending records take priority over appview data (local-wins).

**Writing:** All mutations write to Dexie first with `syncStatus: 'pending'`. Background sync (`src/lib/sync.ts`) pushes pending records to the user's PDS via `putRecord`/`deleteRecord`. Sync covers all 15 record types (boards, tasks, ops, taskOps, trusts, taskTrusts, placements, placementOps, comments, approvals, reactions, projects, memberships, assignments, projectTrusts).

**Real-time:** The browser subscribes to the appview's WebSocket (`AppviewSubscription` in `src/lib/appview.ts`). When the appview detects changes (via Jetstream), it sends an update notification and the client re-fetches the board.

### Appview

The appview (`appview/`) is a Bun + SQLite caching server deployed on Fly.io:

- Subscribes to Jetstream for real-time ingestion of all `dev.skyboard.*` records
- Backfills from PDS endpoints on demand when a board is first requested
- Serves full board state via REST and pushes update notifications via WebSocket
- Persists Jetstream cursor for graceful restart recovery (safe with Fly auto-stop)

See `appview/README.md` for API docs, development, and deployment.

### Materialization and Conflict Resolution

`src/lib/materialize.ts` provides two materialization functions:

**`materializeTasks()`** merges base tasks + legacy Ops + TaskOps into `MaterializedTask` objects:

1. Group legacy ops and TaskOps by `targetTaskUri`
2. Filter by trust: legacy ops use board-level trust (`isTrusted`), TaskOps use task-level trust (`isTaskTrusted` — task author, task-trusted DIDs, or task.open flag)
3. Apply **per-field LWW** — task fields (`title`, `description`, `labelIds`, `status`) and legacy board fields (`columnId`, `position`) resolved independently by timestamp
4. Return `MaterializedTask` with `effectiveTitle`, `effectiveStatus`, `effectiveLabelIds`, etc. plus `appliedOps[]`

**`materializePlacements()`** merges base placements + PlacementOps into `MaterializedPlacement` objects:

1. Group PlacementOps by `targetPlacementUri`
2. Filter by board-level trust
3. Apply per-field LWW on `columnId`, `position`, `removed`
4. Return `MaterializedPlacement` with `effectiveColumnId`, `effectivePosition`, `effectiveRemoved`

**Fractional indexing**: Task ordering uses lexicographic position strings (`fractional-indexing` library). Moving a task generates a new position between neighbors — only the moved task gets an op. This is critical because you can only write to your own AT Protocol repo.

### Permissions System

Two levels of trust (`src/lib/permissions.ts`):

- **Board-level**: `isTrusted()` — board owner or board-trusted DIDs can create placements and PlacementOps. Open boards allow untrusted users to create tasks and comments (pending approval).
- **Task-level**: `isTaskTrusted()` — task author, task-trusted DIDs (via TaskTrust records), or anyone if `task.open` is true. Controls who can apply TaskOps.

`getActionStatus()` returns `allowed`, `pending`, or `denied` for a given action. Untrusted content on open boards goes to proposals pending approval.

### AT Protocol Integration

- **Lexicons**: JSON schemas in `src/lib/lexicons/` for each record type
- **Auth**: OAuth via `@atproto/oauth-client-browser` (`src/lib/auth.svelte.ts`). In loopback/dev mode, the OAuth client auto-detects; in production, it uses `static/client-metadata.json`. The app must be accessed via `http://127.0.0.1:3001` (not `localhost`) for OAuth redirects to work in dev.
- **Record keys**: TIDs generated via `@atproto/common-web` (`src/lib/tid.ts`)
- **AT URIs**: Format `at://did:plc:xxx/dev.skyboard.board/rkey`. Helper: `buildAtUri(did, collection, rkey)` in `src/lib/tid.ts`

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
