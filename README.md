# Skyboard

A collaborative kanban board built on [AT Protocol](https://atproto.com/) (Bluesky's decentralized data layer). Each user's data lives in their own AT Protocol repository. An **appview** server aggregates board data and provides real-time updates, while writes go directly to each user's PDS.

## How it works

Users sign in with their Bluesky account and create boards. Each board gets an AT URI (e.g. `at://did:plc:abc.../dev.skyboard.board/3k...`) that can be shared with collaborators. The browser fetches the full board state from the appview in a single request and subscribes to real-time updates via WebSocket.

All data is stored locally in IndexedDB (via Dexie). Writes (creating tasks, editing, commenting) go to Dexie first, then background sync pushes them to the user's PDS. The appview picks up PDS commits via Jetstream and notifies connected clients.

## Architecture

The appview sits between clients and the AT Protocol network. It subscribes to Jetstream for real-time ingestion and backfills from PDS endpoints on demand, caching everything in SQLite. Clients read from the appview and write to their own PDS.

```
 ┌─ Browser (per user) ────────────────────────────────────────────┐
 │                                                                 │
 │   ┌──────────────────────────────────────────────────────────┐  │
 │   │                     Svelte 5 UI                          │  │
 │   │              Board  →  Columns  →  Cards                 │  │
 │   └───────┬──────────────────────────────────▲───────────────┘  │
 │           │ user action                      │ render           │
 │           ▼                                  │                  │
 │   ┌───────────────────┐          ┌───────────┴──────────────┐   │
 │   │  Dexie (IndexedDB)│─────────▶│   materializeTasks()     │   │
 │   │                   │ liveQuery│                          │   │
 │   │  boards           │          │  group ops by task       │   │
 │   │  tasks            │          │  filter by trust +       │   │
 │   │  ops              │          │    permissions           │   │
 │   │  trust            │          │  per-field LWW merge     │   │
 │   │                   │          │  → MaterializedTask[]    │   │
 │   │  (syncStatus:     │          └──────────────────────────┘   │
 │   │   pending/synced) │                                         │
 │   └──┬──────────▲─────┘                                         │
 │      │          │ populate from appview response                │
 └──────┼──────────┼───────────────────────────────────────────────┘
        │          │
        │ background sync              ┌───────────────────────┐
        │ putRecord / deleteRecord     │      Appview          │
        │                              │  (Bun + SQLite)       │
        ▼                              │                       │
 ┌──────────────────────────────┐      │  GET /board/:did/:rk  │◄── REST
 │        User's PDS            │      │  WS  /ws?boardUri=... │◄── WebSocket
 │   (Personal Data Server)     │      │                       │
 │                              │      │  Jetstream consumer   │
 │   at://did:plc:xxx/          │      │  PDS backfill         │
 │     dev.skyboard.board/*     │      │  SQLite cache         │
 │     dev.skyboard.task/*      │      └───────────┬───────────┘
 │     dev.skyboard.op/*        │                  │
 │     dev.skyboard.trust/*     │                  │ subscribes
 └──────────────┬───────────────┘                  │
                │ commit events                    │
                ▼                                  │
 ┌──────────────────────────────┐                  │
 │          Jetstream           │──────────────────┘
 │    (AT Protocol firehose)    │
 └──────────────────────────────┘
```

### Multi-user coordination

When multiple users collaborate on a board, each writes only to their own PDS. The appview aggregates records from all participants — the board owner's PDS has board configuration and trust grants, while tasks and ops can live in any participant's PDS. Ops reference tasks in any repo via AT URI.

```
 ┌─ Alice's PDS ─────────────┐  ┌─ Bob's PDS ────────────┐  ┌─ Carol's PDS ──────────┐
 │  (board owner)            │  │  (trusted collaborator)│  │  (untrusted)           │
 │                           │  │                        │  │                        │
 │  ┌───────────────────┐    │  │                        │  │                        │
 │  │ Board             │    │  │                        │  │                        │
 │  │ columns, perms    │    │  │                        │  │                        │
 │  └───────────────────┘    │  │                        │  │                        │
 │                           │  │                        │  │                        │
 │  ┌────────┐ ┌────────┐    │  │  ┌────────┐ ┌────────┐ │  │  ┌────────┐ ┌────────┐ │
 │  │ Tasks  │ │  Ops   │    │  │  │ Tasks  │ │  Ops   │ │  │  │ Tasks  │ │  Ops   │ │
 │  └───┬────┘ └────────┘    │  │  └────────┘ └───┬────┘ │  │  └────────┘ └───┬────┘ │
 │      │                    │  │                 │      │  │                 │      │
 │  ┌───┴────────────────┐   │  │            ┌────┘      │  │            ┌────┘      │
 │  │ Trust              │   │  │            │           │  │            │           │
 │  │ └ Bob ✓            │   │  │            │           │  │            │           │
 │  └────────────────────┘   │  │            │           │  │            │           │
 └───────────────────────────┘  └────────────┼───────────┘  └────────────┼───────────┘
          │                                  │                           │
          │     ┌────────────────────────────┘                           │
          │     │  Ops target tasks in ANY repo via AT URI               │
          │     │  at://did:plc:alice/dev.skyboard.task/rkey             │
          │     │                       ┌────────────────────────────────┘
          │     │                       │
          └─────┴───────────────────────┘
                        │
                  commit events
                        │
                        ▼
              ┌───────────────────┐           ┌───────────────────────┐
              │     Jetstream     │──────────▶│       Appview         │
              │  (AT Proto relay) │           │  (aggregates + caches │
              └───────────────────┘           │   all participants)   │
                                              └───────────┬───────────┘
                                                          │
                                                    REST + WebSocket
                                                          │
                                                          ▼
 ┌─────────────────────────────────────────────────────────────────────────────┐
 │                           Each User's Browser                               │
 │                                                                             │
 │  Fetch board      Filter by          Merge via           Render             │
 │  from appview ──▶ trust + ────────▶ per-field ────────▶ board               │
 │  (one request)    permissions        LWW                 view               │
 │                                                                             │
 │  Bob's ops → applied ✓         Carol's ops → pending proposals              │
 └─────────────────────────────────────────────────────────────────────────────┘
```

## Data model

There are four record types, each stored as AT Protocol records in the user's repo:

- **Board** (`dev.skyboard.board`) — name, description, column configuration, and permission rules. Owned by whoever created it.
- **Task** (`dev.skyboard.task`) — a card on the board with title, description, column, and fractional index position. Owned by whoever created it. Write-once: the record captures the initial state at creation and is never updated directly.
- **Op** (`dev.skyboard.op`) — an edit to any task, including your own. Contains partial field updates (title, description, columnId, position) and targets a task by AT URI.
- **Trust** (`dev.skyboard.trust`) — a per-board grant allowing another user's ops to take effect on your view of the board.

Here's how two users coordinate on a single board. Each user can only write records to their own PDS — cross-user edits work by writing Ops that reference another user's Task by AT URI.

```
  Alice's PDS (did:plc:alice)              Bob's PDS (did:plc:bob)
  ───────────────────────────              ───────────────────────────

  Board                                    (Alice owns the board)
  ├ name: "Sprint Board"
  ├ columns: [Todo, Doing, Done]
  └ permissions: [{move_task: trusted}]

  Task                                     Task
  ├ title: "Fix login bug"                 ├ title: "Add dark mode"
  ├ columnId: todo                         ├ columnId: todo
  └ position: "a0"                         └ position: "a1"
       ▲                                        ▲
       │ target                                 │ target
       │                                        │
  Op   │  (Alice moves her task)           Op   │  (Bob edits his own task)
  ├ target: at://alice/task/...            ├ target: at://bob/task/...
  ├ columnId: doing                        ├ description: "Support light/dark"
  └ updatedAt: T1                          └ updatedAt: T3

                                           Op      (Bob edits Alice's task)
                                           ├ target: at://alice/task/...  ◄─ cross-repo
                                           ├ title: "Fix auth bug"
                                           └ updatedAt: T2

  Trust  (Alice grants Bob access)
  ├ board: at://alice/board/...
  └ subject: did:plc:bob


  Materialization (runs in each browser)
  ═══════════════════════════════════════════════════════════════

  For Alice's task ("Fix login bug"):

    base     title: "Fix login bug"   columnId: todo   position: "a0"
               │                        │
    + op T1    │                        └──▶ doing     (Alice, owner)
    + op T2    └──▶ "Fix auth bug"                     (Bob, trusted)
               ─────────────────────    ────────────   ─────────────
    result     title: "Fix auth bug"   col: doing      position: "a0"

               Per-field LWW: each field resolved independently by timestamp.
               Bob's op applied because Alice published a Trust record for him.
               Without trust, it would appear in the Proposals panel instead.
```

### Why ops?

You can only write to your own AT Protocol repo. If you want to move or edit someone else's card, you publish an Op record to your repo proposing the change. The board owner (and other participants who trust you) will see your edit applied; those who don't trust you will see it as a pending proposal.

All task edits go through ops — even edits to your own tasks. This ensures per-field LWW timestamps are always correct. A single `updatedAt` on the task record can't distinguish which fields actually changed, so a direct write to one field (e.g. title) would poison the timestamp for all fields, silently reverting concurrent ops on other fields (e.g. a collaborator's column move). By routing all edits through ops, each field change carries its own timestamp and LWW resolves correctly.

## Conflict resolution

Edits are resolved using **per-field last-writer-wins** (LWW) with ISO 8601 timestamps. Each mutable field — `title`, `description`, `columnId`, `position` — is independently resolved. The value with the latest timestamp wins.

This is formally an **LWW-Register Map**, a well-known CRDT. The merge function is commutative, associative, and idempotent, so all clients converge to the same state regardless of the order they receive operations.

### Fractional indexing

Task ordering within columns uses [fractional indexing](https://www.npmjs.com/package/fractional-indexing) — each task has a `position` string that sorts lexicographically. Moving a task generates a new position string between its neighbors, so **only the moved task is ever updated**. This is critical for the distributed model: since you can only write to your own repo, integer-based ordering (which requires renumbering multiple tasks) would fail when moving other users' cards. With fractional indexing, a single op with the new position is sufficient.

A trust layer sits on top: only ops from the task owner, the current user, or explicitly trusted users are merged into the effective board state. Untrusted ops are stored but shown separately in a Proposals panel. Once trust converges (all participants agree on who to trust), the underlying LWW properties guarantee full convergence.

## Trust system

- The board owner's edits are always trusted on their own board.
- Your own ops are always applied in your local view.
- Other users require an explicit trust grant (per-board) before their ops affect your view.
- Joining a board auto-trusts the board owner.
- Untrusted ops and tasks from unknown users appear in the Proposals panel, where you can review them and grant trust.

## Board permissions

On top of the trust system, board authors can configure fine-grained permission rules that control what operations are allowed and by whom. Permissions are stored on the board record and enforced during operation materialization.

### Operations

Five operation types can be independently controlled:

- `create_task` — creating new cards on the board
- `edit_title` — changing a card's title
- `edit_description` — changing a card's description
- `move_task` — moving a card to a different column
- `reorder` — reordering cards within a column

### Scopes

Each operation is assigned one of three scopes:

- **author_only** — only the board owner can perform the operation
- **trusted** — the board owner and explicitly trusted users (default for all operations)
- **anyone** — any user can perform the operation

### Per-column rules

Permission rules can optionally be scoped to specific columns, allowing patterns like "anyone can create tasks in the Inbox column, but only trusted users can move tasks to Done."

### Pending operations

When a user performs an action they don't have full permission for (e.g. scope is `trusted` but the user hasn't been trusted yet), the operation is stored but shown greyed out as pending, awaiting board author approval.

## Sync architecture

```
Reading board data
  → Browser fetches GET /board/:did/:rkey from appview
  → Appview returns board + all tasks, ops, trusts, comments, etc.
  → Response upserted into Dexie (local pending records take priority)
  → Browser subscribes to appview WebSocket for real-time updates
  → On update notification, re-fetches board from appview

Writing (task creation, edits, comments, etc.)
  → db.tasks.add() / db.ops.add() in IndexedDB (syncStatus: 'pending')
  → materializeTasks merges base task + ops via per-field LWW
  → UI updates immediately from local state
  → Background sync pushes record to user's PDS via putRecord
  → PDS commit picked up by Jetstream → appview → WebSocket notification
  → Other clients re-fetch from appview, UI updates
```

The appview handles all cross-PDS aggregation server-side. On startup with a stale Jetstream cursor (>48h), the appview serves existing cached data immediately while backfilling in the background.

## Appview

The appview (`appview/`) is a caching aggregation server that sits between clients and the AT Protocol network. It runs on Bun with SQLite and deploys to Fly.io.

- Subscribes to Jetstream for real-time ingestion of all `dev.skyboard.*` records
- Backfills from PDS endpoints on demand when a board is first requested
- Serves full board state via `GET /board/:did/:rkey` (one request replaces many PDS fetches)
- Pushes real-time update notifications via WebSocket (`WS /ws?boardUri=...`)
- Persists Jetstream cursor for graceful restart recovery

See [`appview/README.md`](appview/README.md) for development and deployment details.

## Tech stack

**Web app:**
- [SvelteKit](https://kit.svelte.dev/) with Svelte 5 and TypeScript
- [Dexie](https://dexie.org/) (IndexedDB) for local-first persistence
- [fractional-indexing](https://www.npmjs.com/package/fractional-indexing) for CRDT-friendly task ordering
- [@atproto/api](https://www.npmjs.com/package/@atproto/api) and [@atproto/oauth-client-browser](https://www.npmjs.com/package/@atproto/oauth-client-browser) for AT Protocol
- [CodeMirror](https://codemirror.net/) for markdown card editing
- Static build via [@sveltejs/adapter-static](https://www.npmjs.com/package/@sveltejs/adapter-static)

**Appview:**
- [Bun](https://bun.sh/) runtime with built-in SQLite and WebSocket support
- [Hono](https://hono.dev/) for HTTP routing
- SQLite (WAL mode) for data caching
- Deploys to [Fly.io](https://fly.io/) with persistent volume

## CLI

Skyboard includes a command-line interface (`sb`) for managing boards and tasks from the terminal. It lives in the `cli/` directory as a standalone package.

### Install

```bash
cd cli
npm install
npm run build
npm link        # makes `sb` available globally
```

### Auth

The CLI uses AT Protocol OAuth with a loopback redirect — `sb login` opens your browser, you authorize with your Bluesky account, and the session is stored locally in `~/.config/skyboard/`.

```bash
sb login alice.bsky.social    # opens browser for OAuth
sb whoami                     # show current user
sb logout
```

### Board navigation

```bash
sb boards                     # list your boards + joined boards
sb use "Sprint Board"         # set default board (by name, rkey, AT URI, or URL)
sb add at://did:plc:xxx/dev.skyboard.board/rkey   # join a board
sb cols                       # show columns with task counts
```

### Cards

```bash
sb cards                      # list all cards grouped by column
sb cards -c "In Progress"     # filter by column (name, prefix, or number)
sb cards -s "login"           # search titles and descriptions

sb new "Fix login bug"                    # create card in first column
sb new "Update docs" -c done -d "..."     # create in specific column with description

sb show 3labc12               # show card details (rkey prefix, min 4 chars)
sb mv 3lab done               # move card to column
sb edit 3lab -t "New title"   # edit title
sb edit 3lab -d "Details"     # edit description
sb comment 3lab "Looks good"  # add comment
sb rm 3lab                    # delete card (owner only, with confirmation)
```

Cards are referenced by **TID rkey prefix** (like git short hashes). `sb cards` shows 7-character truncated rkeys. Columns can be matched by name, prefix (`in` matches `In Progress`), or 1-based index.

### JSON output

All commands support `--json` for machine-readable output, useful for scripting:

```bash
sb cards --json | jq '.[].cards[].title'
sb whoami --json
```

### How it works

The CLI authenticates via OAuth and fetches board data from the appview — no local database. Each read command hits the appview for the full board state, runs the same `materializeTasks()` merge logic as the web app, and displays the result. Write commands (`new`, `mv`, `edit`, `comment`) create AT Protocol records (tasks, ops, comments) in your PDS, which the appview picks up via Jetstream and serves to other clients.

## Development

```bash
npm install
npm run dev      # Start dev server
npm run build    # Production build
npm run check    # Type checking
```
