---
description: "Log in to Skyboard via AT Protocol OAuth"
argument-hint: "<handle>"
---

# sb login

Log in to Skyboard using your AT Protocol handle.

## Usage

```
sb login <handle>
```

- `<handle>` — AT Protocol handle (e.g. `alice.bsky.social`)

If the user doesn't provide a handle, ask them for it.

This command opens a browser for OAuth authentication. Tell the user a browser window will open and they should complete login there.

This command does not support `--json`.
