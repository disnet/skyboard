---
description: "Show current authenticated user"
argument-hint: ""
---

# sb whoami

Show the currently authenticated user.

## Usage

```
sb whoami --json
```

Always use `--json`. Returns: `loggedIn`, `handle`, `did`, `service`.

If `loggedIn` is false, tell the user they need to log in with `sb login <handle>`.
