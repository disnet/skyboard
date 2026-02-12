---
description: "Set the default board for subsequent commands"
argument-hint: "<board>"
---

# sb use

Set the default board for subsequent commands.

## Usage

```
sb use <board>
```

- `<board>` — board name, rkey, AT URI, or web URL

If the user doesn't specify a board, run `sb boards --json` first to show available boards, then ask which one to use.

This command does not support `--json`.
