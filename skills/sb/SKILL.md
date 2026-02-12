---
name: sb
description: |
  Manage Skyboard kanban boards via the sb CLI.
  Trigger: user asks about boards, columns, cards, tasks, kanban, or uses /sb.
allowed-tools: "Read,Bash(sb *)"
version: 0.1.0
---

# Skyboard CLI (`sb`)

Skyboard is a collaborative kanban board built on the AT Protocol. The `sb` CLI lets you manage boards, columns, and cards from the terminal.

## Prerequisites

- `sb` is installed globally (`npm i -g skyboard-cli`)
- User is logged in (`sb login <handle>`)
- A default board is set (`sb use <board>`)

## Key Concepts

- **Boards** — kanban boards with named columns. Referenced by name, rkey, AT URI, or web URL.
- **Columns** — matched by exact name (case-insensitive), name prefix, substring, or 1-based index from `sb cols`.
- **Cards** — tasks on the board. Referenced by TID rkey prefix (minimum 4 characters, like git short hashes). Use `sb cards` to see short refs.
- **Short refs** — first 7 characters of a card's rkey, displayed by `sb cards` and `sb show`. Provide at least 4 characters to identify a card.

## Workflow

1. Check auth: `sb whoami --json`
2. List boards: `sb boards --json`
3. Set default board: `sb use <board>`
4. View columns: `sb cols --json`
5. List cards: `sb cards --json`
6. Create/edit/move/comment/delete cards as needed

## Important Rules

- **Always use `--json`** on commands that support it so you get structured output. Present results as human-friendly summaries.
- **Commands supporting `--json`**: whoami, status, boards, cols, cards, new, show, mv, edit, comment, rm
- **Commands without `--json`**: login, logout, use, add
- For `sb rm`, always pass `--force` to skip the interactive prompt, but **ask the user for confirmation first** in conversation.
- If a command needs a board and none is set, run `sb boards --json` to show options and ask the user which to use.
- If a card ref is ambiguous, the CLI will list candidates — present them to the user and ask which one.
