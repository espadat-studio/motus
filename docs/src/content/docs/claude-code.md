---
title: Claude Code
description: What the motus PreToolUse hook blocks in Claude Code, and why `!` shell mode bypasses it.
---

Claude Code ignores `updatedToolOutput` for Bash and writes the raw tool result to its session file before any hook runs. motus can't redact there, so the hook only blocks.

## What the hook does

`motus-cc-hook` runs on `PreToolUse` for `Read` and `Bash`. It reads `~/.config/motus/config.toml` and denies a call when:

- a `Read` path falls under `blockPaths`
- a `Bash` command matches `blockCommands` or `claudeCode.blockCommands`
- a `Bash` command contains a `blockPaths` path

Because it can't redact, the hook also blocks commands that pi would only redact. Put them in `claudeCode.blockCommands`:

```toml
blockCommands = ["pa", "gh auth token", "op read"]

[claudeCode]
blockCommands = ["env", "printenv", "mise env", "cat .env*"]
```

These blocks apply to tool calls only. Listing `env` here does not stop `!env`.

The hook fails closed. A missing or invalid config, malformed input or a crash all deny the call. Setup is in [Install](/install/#claude-code).

## Not covered

:::caution
`!` shell mode bypasses motus. Never run `!env`, `!mise env` or `!pa …` in Claude Code.
:::

Claude Code adds `!` commands and their output to the conversation, so the values reach the model on the next request. `!` commands are not tool calls. `PreToolUse` never fires, and the hook never sees them. pi has no such gap, because its `user_bash` handler redacts `!` output.

The hook also leaves other tools alone: `Grep`, `Glob`, `Edit`, `Write` and MCP tools. Read secret values in your own terminal.
