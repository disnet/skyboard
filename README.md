# Skyboard

A collaborative kanban board built on [AT Protocol] (Bluesky's decentralized
data layer). Each user's data lives in their own AT Protocol repository. An
**appview** server aggregates board data and provides real-time updates, while
writes go directly to each user's PDS.

[AT Protocol]: https://atproto.com/

## How it works

Users sign in with their Bluesky account and create boards. Each board gets an
AT URI (e.g. `at://did:plc:abc.../dev.skyboard.board/3k...`) that can be shared
with collaborators. The browser fetches the full board state from the appview in
a single request and subscribes to real-time updates via WebSocket.

All data is stored locally in IndexedDB (via Dexie). Writes (creating tasks,
placing them on boards, editing, commenting) go to Dexie first, then background
sync pushes them to the user's PDS. The appview picks up PDS commits via
Jetstream and notifies connected clients.

## Architecture

The appview sits between clients and the AT Protocol network. It subscribes to
Jetstream for real-time ingestion and backfills from PDS endpoints on demand,
caching everything in SQLite. Clients read from the appview and write to their
own PDS.

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
 │   │  Dexie (IndexedDB)│─────────▶│   materialize*()         │   │
 │   │                   │ liveQuery│                          │   │
 │   │  boards,tasks     │          │  group ops by target     │   │
 │   │  placements       │          │  filter by trust         │   │
 │   │  taskOps,placOps  │          │  per-field LWW merge     │   │
 │   │  trusts,taskTrusts│          │  → MaterializedTask[]    │   │
 │   │  projects,...     │          │  → MaterializedPlacement│   │
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
 │     dev.skyboard.placement/* │                  │
 │     dev.skyboard.taskOp/*    │                  │ subscribes
 │     dev.skyboard.trust/*     │                  │
 │     ...                      │                  │
 └──────────────┬───────────────┘                  │
                │ commit events                    │
                ▼                                  │
 ┌──────────────────────────────┐                  │
 │          Jetstream           │──────────────────┘
 │    (AT Protocol firehose)    │
 └──────────────────────────────┘
```

### Multi-user coordination

When multiple users collaborate on a board, each writes only to their own PDS.
The appview aggregates records from all participants — the board owner's PDS
has board configuration and trust grants, while tasks and ops can live in any
participant's PDS. Ops reference tasks in any repo via AT URI.

```
 ┌─ Alice's PDS ─────────────┐  ┌─ Bob's PDS ────────────┐  ┌─ Carol's PDS ──────────┐
 │  (board owner)            │  │  (trusted collaborator)│  │  (untrusted)           │
 │                           │  │                        │  │                        │
 │  ┌───────────────────┐    │  │                        │  │                        │
 │  │ Board             │    │  │                        │  │                        │
 │  │ columns, labels   │    │  │                        │  │                        │
 │  └───────────────────┘    │  │                        │  │                        │
 │                           │  │                        │  │                        │
 │  ┌────────┐ ┌──────────┐  │  │  ┌────────┐ ┌───────┐ │  │  ┌────────┐ ┌───────┐ │
 │  │ Tasks  │ │Placements│  │  │  │ Tasks  │ │TaskOps│ │  │  │ Tasks  │ │TaskOps│ │
 │  └───┬────┘ └──────────┘  │  │  └────────┘ └──┬────┘ │  │  └────────┘ └──┬────┘ │
 │      │                    │  │                 │      │  │                │      │
 │  ┌───┴──────┐ ┌────────┐  │  │           ┌────┘      │  │           ┌────┘      │
 │  │ Trust    │ │TaskTrust│  │  │           │           │  │           │           │
 │  │ └ Bob ✓  │ │└ Bob ✓  │  │  │           │           │  │           │           │
 │  └──────────┘ └────────┘  │  │           │           │  │           │           │
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

The key design principle is **separation of concerns**: tasks are standalone
entities, and their placement on boards is a separate record. This enables tasks
to appear on multiple boards and supports independent trust at both the board
and task level.

### Core record types

- **Board** (`dev.skyboard.board`) — name, columns, labels, open flag. Owned by
  whoever created it.
- **Task** (`dev.skyboard.task`) — title, description, status (open/closed),
  open flag, labelIds. Tasks are standalone — they don't embed board, column,
  or position.
- **Placement** (`dev.skyboard.placement`) — links a task to a board + column +
  position. This is how tasks appear on boards. A task can have placements on
  multiple boards.
- **Project** (`dev.skyboard.project`) — a flat collection with name,
  description, labels. Groups tasks outside of boards.
- **Membership** (`dev.skyboard.membership`) — links a task to a project.
- **Assignment** (`dev.skyboard.assignment`) — assigns a user (by DID) to a task.

### Op types (CRDT-style per-field LWW edits)

- **Op** (`dev.skyboard.op`) — legacy combined op targeting a task within a
  board context. Kept for backward compatibility.
- **TaskOp** (`dev.skyboard.taskOp`) — task-level field changes (title,
  description, labelIds, status). No board context needed.
- **PlacementOp** (`dev.skyboard.placementOp`) — placement-level field changes
  (columnId, position, removed).

### Trust types

- **Trust** (`dev.skyboard.trust`) — board-level trust grant.
- **TaskTrust** (`dev.skyboard.taskTrust`) — task-level trust grant allowing
  another user to edit a specific task via TaskOps.
- **ProjectTrust** (`dev.skyboard.projectTrust`) — project-level trust grant.

### Other record types

- **Comment** (`dev.skyboard.comment`) — task-scoped comment.
- **Reaction** (`dev.skyboard.reaction`) — task-scoped emoji reaction.
- **Approval** (`dev.skyboard.approval`) — approves a task, comment, or
  placement at the board or task level.

Here's how two users coordinate on a single board. Each user can only write
records to their own PDS — cross-user edits work by writing ops that reference
another user's records by AT URI.

```
  Alice's PDS (did:plc:alice)              Bob's PDS (did:plc:bob)
  ───────────────────────────              ───────────────────────────

  Board                                    (Alice owns the board)
  ├ name: "Sprint Board"
  ├ columns: [Todo, Doing, Done]
  └ open: false

  Task                                     Task
  ├ title: "Fix login bug"                 ├ title: "Add dark mode"
  └ status: open                           └ open: true  (anyone can edit)

  Placement                                Placement
  ├ taskUri: at://alice/task/...           ├ taskUri: at://bob/task/...
  ├ boardUri: at://alice/board/...         ├ boardUri: at://alice/board/...
  ├ columnId: todo                         ├ columnId: todo
  └ position: "a0"                         └ position: "a1"
       ▲                                        ▲
       │ target                                 │ target
       │                                        │
  PlacementOp (Alice moves her task)       TaskOp  (Bob edits his own task)
  ├ target: at://alice/placement/...       ├ target: at://bob/task/...
  ├ columnId: doing                        ├ description: "Support light/dark"
  └ createdAt: T1                          └ createdAt: T3

                                           TaskOp  (Bob edits Alice's task)
                                           ├ target: at://alice/task/... ◄─ cross-repo
                                           ├ title: "Fix auth bug"
                                           └ createdAt: T2

  Trust  (Alice grants Bob board access)   TaskTrust  (Alice grants Bob on task)
  ├ board: at://alice/board/...            ├ taskUri: at://alice/task/...
  └ trustedDid: did:plc:bob               └ trustedDid: did:plc:bob


  Materialization (runs in each browser)
  ═══════════════════════════════════════════════════════════════

  For Alice's task ("Fix login bug"):

    base task    title: "Fix login bug"   status: open
                   │
    + taskOp T2    └──▶ "Fix auth bug"    (Bob, task-trusted)
                   ────────────────────   ───────────────────
    result         title: "Fix auth bug"  status: open

  For Alice's placement on "Sprint Board":

    base         columnId: todo   position: "a0"
                   │
    + placOp T1    └──▶ doing     (Alice, board owner)
                   ────────────   ─────────────
    result         col: doing     position: "a0"

               Per-field LWW: each field resolved independently by timestamp.
```

### Why ops?

You can only write to your own AT Protocol repo. If you want to edit someone
else's task or move a placement, you publish an op record to your repo proposing
the change. Users who trust you will see the edit applied; those who don't will
see it as a pending proposal.

Task-level edits (title, description, status, labels) go through **TaskOps**,
which are governed by task-level trust. Board-level edits (column, position,
removal) go through **PlacementOps**, governed by board-level trust. This
separation means a task author can grant edit access to collaborators without
involving the board owner, and vice versa.

All edits go through ops — even edits to your own records. This ensures
per-field LWW timestamps are always correct. Each field change carries its own
timestamp so LWW resolves correctly without conflicts.

## Conflict resolution

Edits are resolved using **per-field last-writer-wins** (LWW) with ISO 8601
timestamps. Two separate materialization passes run:

- **Task materialization**: fields `title`, `description`, `labelIds`, `status`
  resolved from legacy Ops + TaskOps
- **Placement materialization**: fields `columnId`, `position`, `removed`
  resolved from PlacementOps

Each field is independently resolved — the value with the latest timestamp wins.

This is formally an **LWW-Register Map**, a well-known CRDT. The merge function
is commutative, associative, and idempotent, so all clients converge to the same
state regardless of the order they receive operations.

### Fractional indexing

Task ordering within columns uses [fractional indexing] — each task has a
`position` string that sorts lexicographically. Moving a task generates a
new position string between its neighbors, so **only the moved task is ever
updated**. This is critical for the distributed model: since you can only write
to your own repo, integer-based ordering (which requires renumbering multiple
tasks) would fail when moving other users' cards. With fractional indexing, a
single op with the new position is sufficient.

[fractional indexing]: https://www.npmjs.com/package/fractional-indexing

A trust layer sits on top: only ops from trusted sources are merged into the
effective state. Untrusted ops are stored but shown separately in a Proposals
panel. Once trust converges, the underlying LWW properties guarantee full
convergence.

## Trust system

Trust operates at two levels:

### Board-level trust

- The board owner's edits are always trusted on their own board.
- Your own ops are always applied in your local view.
- Other users require an explicit **Trust** grant (per-board) before their
  PlacementOps and legacy Ops affect your view.
- Joining a board auto-trusts the board owner.

### Task-level trust

- The task author's edits are always trusted on their own task.
- Other users can edit a task if they have a **TaskTrust** grant from the task
  author, or if the task's `open` flag is true (anyone can edit).
- This is independent of board-level trust — a task author can grant edit access
  without involving the board owner.

### Open boards and proposals

- Boards with `open: true` allow untrusted users to create tasks and comments,
  which appear in the Proposals panel pending approval.
- Untrusted ops from unknown users also appear in Proposals for review.

## Sync architecture

```
Reading board data
  → Browser fetches GET /board/:did/:rkey from appview
  → Appview returns board + tasks, placements, taskOps, placementOps,
    trusts, taskTrusts, comments, approvals, reactions, assignments
  → Response upserted into Dexie (local pending records take priority)
  → Browser subscribes to appview WebSocket for real-time updates
  → On update notification, re-fetches board from appview

Writing (task creation, edits, placements, comments, etc.)
  → db.tasks.add() / db.taskOps.add() / etc. in IndexedDB (syncStatus: 'pending')
  → materializeTasks + materializePlacements merge via per-field LWW
  → UI updates immediately from local state
  → Background sync pushes record to user's PDS via putRecord
  → PDS commit picked up by Jetstream → appview → WebSocket notification
  → Other clients re-fetch from appview, UI updates
```

The appview handles all cross-PDS aggregation server-side. On startup with
a stale Jetstream cursor (>48h), the appview serves existing cached data
immediately while backfilling in the background.

## Appview

The appview (`appview/`) is a caching aggregation server that sits between
clients and the AT Protocol network. It runs on Bun with SQLite and deploys
to Fly.io.

- Subscribes to Jetstream for real-time ingestion of all `dev.skyboard.*`
  records
- Backfills from PDS endpoints on demand when a board is first requested
- Serves full board state via `GET /board/:did/:rkey` (one request replaces many
  PDS fetches)
- Pushes real-time update notifications via WebSocket (`WS /ws?boardUri=...`)
- Persists Jetstream cursor for graceful restart recovery

See [`appview/README.md`] for development and deployment details.

[`appview/README.md`]: appview/README.md

## Tech stack

**Web app:**

- [SvelteKit] with Svelte 5 and TypeScript
- [Dexie] (IndexedDB) for local-first persistence
- [fractional-indexing] for CRDT-friendly task ordering
- [@atproto/api] and [@atproto/oauth-client-browser] for AT Protocol
- [CodeMirror] for markdown card editing
- Static build via [@sveltejs/adapter-static]

[@atproto/oauth-client-browser]: https://www.npmjs.com/package/@atproto/oauth-client-browser
[@sveltejs/adapter-static]: https://www.npmjs.com/package/@sveltejs/adapter-static
[fractional-indexing]: https://www.npmjs.com/package/fractional-indexing
[@atproto/api]: https://www.npmjs.com/package/@atproto/api
[CodeMirror]: https://codemirror.net/
[SvelteKit]: https://kit.svelte.dev/
[Dexie]: https://dexie.org/

**Appview:**

- [Bun] runtime with built-in SQLite and WebSocket support
- [Hono] for HTTP routing
- SQLite (WAL mode) for data caching
- Deploys to [Fly.io] with persistent volume

[Fly.io]: https://fly.io/
[Hono]: https://hono.dev/
[Bun]: https://bun.sh/

## CLI

Skyboard includes a command-line interface (`sb`) for managing boards and tasks
from the terminal. It lives in the `cli/` directory as a standalone package.

### Install

```bash
cd cli
npm install
npm run build
npm link        # makes `sb` available globally
```

### Auth

The CLI uses AT Protocol OAuth with a loopback redirect — `sb login` opens your
browser, you authorize with your Bluesky account, and the session is stored
locally in `~/.config/skyboard/`.

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

Cards are referenced by **TID rkey prefix** (like git short hashes). `sb cards`
shows 7-character truncated rkeys. Columns can be matched by name, prefix (`in`
matches `In Progress`), or 1-based index.

### JSON output

All commands support `--json` for machine-readable output, useful for scripting:

```bash
sb cards --json | jq '.[].cards[].title'
sb whoami --json
```

### How it works

The CLI authenticates via OAuth and fetches board data from the appview — no
local database. Each read command hits the appview for the full board state,
runs the same materialization logic as the web app, and displays the result.
Write commands (`new`, `mv`, `edit`, `comment`) create AT Protocol records
(tasks, placements, taskOps, placementOps, comments) in your PDS, which the
appview picks up via Jetstream and serves to other clients.

## Development

```bash
npm install
npm run dev      # Start dev server
npm run build    # Production build
npm run check    # Type checking
```
