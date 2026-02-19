---
description: "Add a comment to a card"
argument-hint: "<ref> <text>"
---

# sb comment

Add a comment to a card.

## Usage

```
sb comment <ref> "<text>" --json
```

- `<ref>` — card reference (rkey prefix, minimum 4 characters)
- `<text>` — comment text

Options:

- `--board <ref>` — override default board (AT URI, `did:plc:xxx:rkey`, or board name)

Always use `--json`. Returns: `rkey`, `taskRkey`, `text`.

If the user doesn't provide the card ref or comment text, ask for the missing pieces. Quote the comment text to handle spaces.
