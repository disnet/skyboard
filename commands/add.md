---
description: "Join a board by link"
argument-hint: "<link>"
---

# sb add

Join a board by its AT URI or web URL.

## Usage

```
sb add <link>
```

- `<link>` — AT URI (`at://did:plc:xxx/dev.skyboard.board/rkey`) or web URL (`https://skyboard.dev/board/...`)

If the user doesn't provide a link, ask them for it.

This command does not support `--json`.
