# motus

> _Motus et bouche cousue_: "not a word, lips sealed".

Stops secrets reaching the model, or pi's session files, during AI coding sessions. A pi extension, plus a Claude Code `PreToolUse` hook that only blocks.

Status: **pi extension wired**, not yet smoke-tested. Claude Code hook and the `mise` source are still to come.

## Install (pi)

Install globally and load motus before every other extension:

```sh
pi install npm:@espadat-studio/motus
```

- Global, never `--local`: subagent pi processes only load global extensions.
- First in `packages` of `~/.pi/agent/settings.json`: handlers run in load order, so an extension loaded earlier sees raw tool output and messages.
- pi can't report handler order, so motus doesn't check either rule.

Create `~/.config/motus/config.toml` (see [`meta/spec.md`](meta/spec.md#config-configmotusconfigtoml)). Without it every session starts degraded.

### 1Password

```json
{
  "type": "1password",
  "refs": { "API_TOKEN": "op://dev/api/token" },
  "fromEnv": true
}
```

- `refs` names each secret by its key. `fromEnv: true` also loads env vars whose values are `op://` references, named by the var.
- All refs resolve in one `op inject` call at session start. Expect one 1Password biometric or session prompt then, every session.
- A locked or missing `op` fails the source. With `required: true` (the default) the session starts degraded.

## Use

- Session start reports how many secrets loaded and from which sources, never values.
- Degraded session: a required source failed where it applies, so every tool not in `degradedAllowTools` is blocked, `!` commands included.
- `/motus status`: loaded counts, failures and state.
- `/motus continue`: accept partial protection for this session. Blocks still apply.
- There is no `/motus off`. Read secret values in your own terminal.

## Docs

| File                          | Contents                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------ |
| `meta/spec.md`                | Decisions, architecture, source adapters, config, failure modes, open questions      |
| `meta/plan.md`                | Build order and test plan                                                            |
| `meta/research/varlock.md`    | Why varlock doesn't fix this problem                                                 |
| `meta/research/oss-survey.md` | 49 pi packages surveyed; why we build instead of fork                                |
| `meta/personal/`              | Machine-specific inventory and hardening log. **Must not be published** (gitignored) |

## Why

Past incident: secrets printed during an AI session meant rotating many keys. Root cause: mise decrypts age secrets into the shell env. pi inherits them, so one `env` or `forge -vvvv` sends them to the model and into session files, and memsearch then copies them into `~/memories`.
