---
description: "Edit card fields (title, description, labels)"
argument-hint: "<ref>"
---

# sb edit

Edit one or more fields of a card.

## Usage

```
sb edit <ref> --json
```

- `<ref>` — card reference (rkey prefix, minimum 4 characters)

Options:

- `-t, --title <title>` — new title
- `-d, --description <desc>` — new description
- `-l, --label <label...>` — set labels (can be specified multiple times)
- `--board <ref>` — override default board

At least one of `-t`, `-d`, or `-l` must be provided. Always use `--json`. Returns: `rkey`, `fields`.

If the user doesn't specify what to change, ask them which fields to update.
