---
description: "Show columns for the current board"
argument-hint: ""
---

# sb cols

Show columns for the current (or specified) board.

## Usage

```
sb cols --json
```

Options:
- `--board <ref>` — override default board

Always use `--json`. Returns an array with: `index`, `id`, `name`, `taskCount`.

Present as a numbered list showing column name and card count.
