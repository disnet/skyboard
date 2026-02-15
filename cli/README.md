# Skyboard CLI (`sb`)

A command-line interface for [Skyboard](https://skyboard.dev), a collaborative kanban board built on [AT Protocol](https://atproto.com/). Manage boards and tasks from your terminal without opening a browser.

## Install

```bash
npm install -g skyboard-cli
```

## Quick start

```bash
sb login alice.bsky.social    # opens browser for AT Protocol OAuth
sb boards                     # list your boards
sb use "Sprint Board"         # set default board
sb cards                      # view all cards
sb new "Fix login bug"        # create a card
sb mv 3labc12 done            # move it to Done
```

## Auth

The CLI uses AT Protocol OAuth with a loopback redirect. Running `sb login` starts a local server, opens your browser for authorization, and stores the session in `~/.config/skyboard/`. Tokens auto-refresh on subsequent commands.

```bash
sb login alice.bsky.social    # opens browser for OAuth
sb whoami                     # show handle, DID, and PDS endpoint
sb logout                     # clear stored session
```

## Commands

### Board navigation

| Command | Description |
|---------|-------------|
| `sb boards` | List all boards (owned + joined) |
| `sb use <board>` | Set default board for subsequent commands |
| `sb add <link>` | Join a board by AT URI or web URL |
| `sb cols` | Show columns with task counts |

`sb use` accepts a board name (fuzzy match), rkey, AT URI, or web URL.

### Card operations

| Command | Description |
|---------|-------------|
| `sb cards` | List cards grouped by column |
| `sb new <title>` | Create a new card |
| `sb show <ref>` | Show card details, comments, and history |
| `sb mv <ref> <column>` | Move card to a different column |
| `sb edit <ref>` | Edit card fields |
| `sb comment <ref> <text>` | Add a comment |
| `sb rm <ref>` | Delete a card (owner only) |

### Card references

Cards are referenced by **TID rkey prefix**, similar to git short hashes. `sb cards` shows 7-character truncated rkeys. A minimum of 4 characters is required; if the prefix is ambiguous, the CLI lists the matches.

```
sb cards
  To Do
    3labc12  Fix login bug
    3labc13  Update docs

sb show 3labc12       # exact prefix
sb mv 3lab done       # shorter prefix, if unambiguous
```

### Column matching

Columns can be referenced by:
- **Exact name** (case-insensitive): `"In Progress"`
- **Name prefix**: `in` matches `In Progress`
- **1-based index**: `2` (from `sb cols` output)

### Filters

```bash
sb cards -c "In Progress"     # filter by column
sb cards -l "bug"             # filter by label
sb cards -s "login"           # search title and description
```

### Creating and editing

```bash
sb new "Fix login bug"                        # create in first column
sb new "Update docs" -c done -d "Add examples"  # specify column and description

sb edit 3lab -t "New title"                   # edit title
sb edit 3lab -d "New description"             # edit description
sb edit 3lab -l bug -l urgent                 # set labels
```

## JSON output

All commands support `--json` for machine-readable output:

```bash
sb cards --json | jq '.[].cards[].title'
sb boards --json
sb whoami --json
```

## Autonomous dev loop (`sb ralph`)

`sb ralph` runs [Claude Code](https://claude.ai/code) in an autonomous loop driven by a Skyboard kanban board. Each iteration picks a task, does one unit of work, moves the card, and writes a status file. The loop continues until all tasks are done, all remaining tasks are blocked, or the iteration limit is reached.

### Setup

```bash
sb ralph init --board "Sprint Board"   # creates .skyboard-ralph/ config + protocol
sb ralph start                         # run the loop
```

### Commands

| Command | Description |
|---------|-------------|
| `sb ralph init` | Set up `.skyboard-ralph/` config and generate protocol file |
| `sb ralph start` | Run the autonomous dev loop |
| `sb ralph status` | Show current loop state (iteration count, last status) |

### `sb ralph init` options

| Option | Description |
|--------|-------------|
| `--board <ref>` | Board reference (rkey, AT URI, URL, name). Falls back to default board. |
| `--max-iterations <n>` | Default max iterations (default: 50) |

Creates files under `.skyboard-ralph/`:
- **`config.json`** — Config with board ref, iteration limit, and file paths
- **`protocol.md`** — The agent protocol template. Edit this to customize agent behavior.

### `sb ralph start` options

| Option | Description |
|--------|-------------|
| `--max-iterations <n>` | Override the max iterations from config |
| `--interactive` | Require permission approval for each tool use (disables `--dangerously-skip-permissions`) |

By default, `start` runs with `--dangerously-skip-permissions` so the agent can work autonomously. Use `--interactive` for supervised runs.

Output streams to both stdout and `.skyboard-ralph/loop.log`. Press Ctrl-C to stop gracefully — the current iteration finishes before exiting.

### `sb ralph status` options

| Option | Description |
|--------|-------------|
| `--json` | Machine-readable JSON output |

### Protocol customization

The generated `.skyboard-ralph/protocol.md` contains the full agent protocol with `{{placeholder}}` markers that are interpolated at runtime:

- `{{iteration}}` — Current iteration number
- `{{maxIterations}}` — Total iteration limit
- `{{boardDid}}` — Board owner DID
- `{{boardRkey}}` — Board record key

Edit the protocol file to change how the agent picks tasks, what transitions it makes, or any other behavior.

### Monitoring

- **Skyboard web UI** — Watch cards move across columns in real time
- **Card comments** — The agent logs what it did each iteration
- **Log file** — `.skyboard-ralph/loop.log` has full output from every iteration
- **Status** — `sb ralph status` shows iteration count and last status

## Claude Code plugin

The `sb` CLI includes a [Claude Code](https://claude.ai/code) plugin so you can manage boards directly from a Claude Code conversation using `/sb:cards`, `/sb:new`, `/sb:mv`, etc.

### Install the plugin

```bash
# Add the marketplace (once)
/plugin marketplace add /path/to/skyboard

# Install the plugin
/plugin install sb@skyboard
```

Or from the terminal:

```bash
claude plugin marketplace add /path/to/skyboard
claude plugin install sb@skyboard --scope user
```

Restart Claude Code after installing. All 15 `sb` commands are available as skills (e.g. `/sb:status`, `/sb:cards`, `/sb:new`).

## How it works

The CLI authenticates via OAuth and talks directly to AT Protocol PDS endpoints — there is no local database. Each command fetches fresh data from the board owner's PDS and all trusted participants, runs the same `materializeTasks()` per-field LWW merge logic as the web app, and displays the result.

Write commands (`new`, `mv`, `edit`, `comment`) create AT Protocol records in your PDS. The web app picks these up in real time via Jetstream, and other CLI users see them on their next command.

## Config

Session and config are stored in `~/.config/skyboard/`:

| File | Purpose |
|------|---------|
| `session.json` | Current user (DID, handle, PDS endpoint) |
| `auth/` | OAuth session tokens (mode 0600) |
| `config.json` | Default board and known boards list |

## License

GPL-3.0-only
