---
description: "List cards, optionally filtered by column, label, or search text"
argument-hint: ""
---

# sb cards

List cards on the current board, grouped by column.

## Usage

```
sb cards --json
```

Options:
- `-c, --column <column>` — filter by column (name, prefix, or 1-based index)
- `-l, --label <label>` — filter by label name
- `-s, --search <text>` — search in title and description
- `--board <ref>` — override default board

Always use `--json`. Returns an array of column objects, each with a `cards[]` array containing: `rkey`, `shortRef`, `title`, `description`, `labels`, `createdAt`, `lastModifiedAt`.

Present cards grouped by column. Show the short ref (for use in other commands), title, and labels if any.
