---
title: Configuration
description: Every key in ~/.config/motus/config.toml, with its default and what it does.
---

One file configures both agents: `~/.config/motus/config.toml`. It never holds secret values. Unknown keys are errors.

```toml
prefixes = ["sk-ant-", "ghp_", "github_pat_", "AKIA", "xox[bp]-"]
blockPaths = [
  "~/.config/mise/age.txt",
  "${PA_DIR:-~/.local/share/pa}/identities",
]
blockCommands = ["pa", "gh auth token", "op read"]
degradedAllowTools = []
minValueLength = 8

[[sources]]
type = "mise"
listFile = "~/.config/rotate-mise-secrets/files"

[claudeCode]
blockCommands = ["env", "printenv", "mise env", "cat .env*"]
```

## Keys

| Key                        | Default                                              | Read by         | Meaning                                                         |
| -------------------------- | ---------------------------------------------------- | --------------- | --------------------------------------------------------------- |
| `sources`                  | `[]`, plus an `env` source unless you list one       | pi              | Where secrets load from. See [Sources](/sources/)               |
| `prefixes`                 | `sk-ant-`, `ghp_`, `github_pat_`, `AKIA`, `xox[bp]-` | pi              | Vendor key prefixes redacted even when no source loaded the key |
| `blockPaths`               | `[]`                                                 | pi, Claude Code | Files and directories that tools may not touch                  |
| `blockCommands`            | `[]`                                                 | pi, Claude Code | Commands to block                                               |
| `degradedAllowTools`       | `[]`                                                 | pi              | Tools still allowed while the session is degraded               |
| `minValueLength`           | `8`                                                  | pi              | Shorter values are ignored, with a warning that names the key   |
| `claudeCode.blockCommands` | `[]`                                                 | Claude Code     | Extra blocks for the hook, which can't redact                   |

## Block paths

Entries expand `~`, `$HOME`, environment variables and `${VAR:-fallback}`, then resolve with `realpath`. A directory entry blocks everything beneath it. An unset variable with no fallback makes the config invalid.

- Path tools (`read`, `grep`, `find`, `ls`, `edit`, `write`, MCP filesystem tools) have their argument resolved against the working directory, then compared.
- In bash, a command is blocked when it contains the absolute, `~/` or `$HOME/` spelling of an entry.
- `cd dir && cat file` is not caught.

## Block commands

An entry matches the word at command position: at the start, and after `|`, `;`, `&&`, `||`, `$(`, a backtick or `(`. Wrappers like `env VAR=x`, `sudo`, `command`, `exec`, `time`, `nohup` and `xargs` are skipped. `bash -c '…'` and `eval` are searched too.

- `"pa"` blocks every `pa` command.
- `"gh auth token"` needs all three words, in order.
- `*` is a glob: `"cat .env*"` blocks `cat .env.local`.

Scripts, aliases and shell functions are not covered.

## Source options

Every source also takes these:

| Key         | Default    | Meaning                                                            |
| ----------- | ---------- | ------------------------------------------------------------------ |
| `type`      | required   | `env`, `command`, `mise`, `pa` or `1password`                      |
| `id`        | the `type` | Name shown in reports. Must be unique                              |
| `required`  | `true`     | A required source that fails where it applies degrades the session |
| `timeoutMs` | `10000`    | Load deadline for this source                                      |

## Degraded sessions

A required source can fail: a locked `op`, a timeout, invalid config. If it applies to the working directory, the session is degraded. Every tool not in `degradedAllowTools` is blocked, and so are `!` commands, until you run `/motus continue`. A failure in a repo the source doesn't apply to only warns once.
