---
description: "Delete a card (owner only)"
argument-hint: "<ref>"
---

# sb rm

Delete a card. Only the card owner can delete it.

## Usage

```
sb rm <ref> --force --json
```

- `<ref>` — card reference (rkey prefix, minimum 4 characters)

Options:

- `-f, --force` — skip interactive confirmation prompt
- `--board <ref>` — override default board (AT URI, `did:plc:xxx:rkey`, or board name)

**Always pass `--force`** to avoid the interactive prompt (which doesn't work in non-interactive mode). However, **always ask the user to confirm deletion first** in conversation before running the command.

Always use `--json`. Returns: `deleted` (rkey of the deleted card).
