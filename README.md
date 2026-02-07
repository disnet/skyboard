# AT Kanban

A collaborative kanban board built on [AT Protocol](https://atproto.com/) (Bluesky's decentralized data layer). No central server — each user's data lives in their own AT Protocol repository, synced in real time via Jetstream.

## How it works

Users sign in with their Bluesky account and create boards. Each board gets an AT URI (e.g. `at://did:plc:abc.../blue.kanban.board/3k...`) that can be shared with collaborators. Joining a board fetches it from the owner's PDS (Personal Data Server) and subscribes to real-time updates through [Jetstream](https://docs.bsky.app/blog/jetstream), Bluesky's WebSocket event stream.

All data is stored locally in IndexedDB (via Dexie) and synced to each user's PDS in the background. The app works offline and catches up when reconnected.

## Data model

There are four record types, each stored as AT Protocol records in the user's repo:

- **Board** (`blue.kanban.board`) — name, description, column configuration, and permission rules. Owned by whoever created it.
- **Task** (`blue.kanban.task`) — a card on the board with title, description, column, and sort order. Owned by whoever created it.
- **Op** (`blue.kanban.op`) — an edit to someone else's task. Contains partial field updates (title, description, columnId, order) and targets a task by AT URI.
- **Trust** (`blue.kanban.trust`) — a per-board grant allowing another user's ops to take effect on your view of the board.

### Why ops?

You can only write to your own AT Protocol repo. If you want to move or edit someone else's card, you publish an Op record to your repo proposing the change. The board owner (and other participants who trust you) will see your edit applied; those who don't trust you will see it as a pending proposal.

## Conflict resolution

Edits are resolved using **per-field last-writer-wins** (LWW) with ISO 8601 timestamps. Each mutable field — `title`, `description`, `columnId`, `order` — is independently resolved. The value with the latest timestamp wins.

This is formally an **LWW-Register Map**, a well-known CRDT. The merge function is commutative, associative, and idempotent, so all clients converge to the same state regardless of the order they receive operations.

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
User action (create/edit/move task)
  → Local IndexedDB update (syncStatus: 'pending')
  → Background sync every 30s pushes to user's PDS
  → PDS commit broadcast via Jetstream WebSocket
  → Other clients receive event and upsert into their local DB
  → Live queries re-execute, materializeTasks runs, UI updates
```

On reconnect or stale cursor (>48h offline), the app backfills by fetching directly from all known participants' PDS endpoints.

## Tech stack

- [SvelteKit](https://kit.svelte.dev/) with Svelte 5 and TypeScript
- [Dexie](https://dexie.org/) (IndexedDB) for local-first persistence
- [@atproto/api](https://www.npmjs.com/package/@atproto/api) and [@atproto/oauth-client-browser](https://www.npmjs.com/package/@atproto/oauth-client-browser) for AT Protocol
- [CodeMirror](https://codemirror.net/) for markdown card editing
- Static build via [@sveltejs/adapter-static](https://www.npmjs.com/package/@sveltejs/adapter-static)

## Development

```bash
npm install
npm run dev      # Start dev server
npm run build    # Production build
npm run check    # Type checking
```
