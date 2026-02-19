---
description: "Show card details, comments, and history"
argument-hint: "<ref>"
---

# sb show

Show full details of a card including comments and edit history.

## Usage

```
sb show <ref> --json
```

- `<ref>` — card reference (rkey prefix, minimum 4 characters)

Options:

- `--board <ref>` — override default board (AT URI, `did:plc:xxx:rkey`, or board name)

Always use `--json`. Returns: `rkey`, `did`, `title`, `description`, `column`, `labels[]`, `createdAt`, `lastModifiedAt`, `lastModifiedBy`, `opsApplied`, `comments[]`.

If the user doesn't provide a card ref, ask for one or run `sb cards --json` to help them pick.
