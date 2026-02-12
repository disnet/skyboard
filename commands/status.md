---
description: "Show auth state and current board summary"
argument-hint: ""
---

# sb status

Show current authentication state and default board summary.

## Usage

```
sb status --json
```

Always use `--json`. Returns: `loggedIn`, `handle`, `did`, `board` (with `name`, `rkey`, `did`, `columns[]`, `totalCards`).

Present a summary showing who is logged in, the current board name, column names, and total card count.
