---
title: Install
description: Install motus in pi and wire its PreToolUse hook into Claude Code.
---

motus needs Node 22.19 or newer. It reads `~/.config/motus/config.toml` in both agents.

## pi

Install it globally:

```sh
pi install npm:@espadat/motus
```

Two rules matter, and motus can't check either:

- Install globally, never with `--local`. Subagent [pi](https://github.com/earendil-works/pi) processes only load global extensions.
- List motus first in `packages` of `~/.pi/agent/settings.json`. Handlers run in load order, so an extension loaded earlier sees raw tool output and messages. [pi](https://github.com/earendil-works/pi) can't report handler order.

Without a config file every session starts degraded. See [Configuration](/configuration/).

Commands inside [pi](https://github.com/earendil-works/pi):

| Command           | Does                                                            |
| ----------------- | --------------------------------------------------------------- |
| `/motus status`   | Shows loaded counts, failures and state                         |
| `/motus continue` | Accepts partial protection for this session. Blocks still apply |

There is no `/motus off`. Turning redaction off would send secrets to the model. Read secret values in your own terminal.

## Claude Code

Install the package so `motus-cc-hook` is on your `PATH`:

```sh
npm install --global @espadat/motus
```

Then add the hook to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Read|Bash",
        "hooks": [{ "type": "command", "command": "motus-cc-hook" }]
      }
    ]
  }
}
```

Create `~/.config/motus/config.toml` first. Without it the hook fails closed and denies every `Read` and `Bash` call.

The hook blocks only. It does not redact, and it does not cover `!` shell mode. Read [Claude Code](/claude-code/) before you rely on it.
