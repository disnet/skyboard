---
description: "List all boards (owned and joined)"
argument-hint: ""
---

# sb boards

List all boards the user owns or has joined.

## Usage

```
sb boards --json
```

Always use `--json`. Returns an array of boards with: `rkey`, `did`, `name`, `description`, `columns`, `open`.

Present as a numbered list showing board name, column count, and whether the board is open.
