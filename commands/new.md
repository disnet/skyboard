---
description: "Create a new card"
argument-hint: "<title>"
---

# sb new

Create a new card on the board.

## Usage

```
sb new "<title>" --json
```

Options:

- `-c, --column <column>` — target column (default: first column). Column by name, prefix, or 1-based index.
- `-d, --description <desc>` — card description
- `--board <ref>` — override default board (AT URI, `did:plc:xxx:rkey`, or board name)

Always use `--json`. Returns: `rkey`, `title`, `column`, `position`.

If the user doesn't provide a title, ask for one. Quote the title to handle spaces.
