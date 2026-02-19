---
description: "Move a card to a different column"
argument-hint: "<ref> <column>"
---

# sb mv

Move a card to a different column.

## Usage

```
sb mv <ref> <column> --json
```

- `<ref>` — card reference (rkey prefix, minimum 4 characters)
- `<column>` — target column (name, prefix, or 1-based index)

Options:

- `--board <ref>` — override default board (AT URI, `did:plc:xxx:rkey`, or board name)

Always use `--json`. Returns: `rkey`, `column`.

If the column argument is missing, run `sb cols --json` to show available columns and ask the user where to move the card.
