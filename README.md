# pi-motus

> *Motus et bouche cousue*: "not a word, lips sealed".

Stops secrets reaching the model, or pi's session files, during AI coding sessions. A pi extension, plus a Claude Code `PreToolUse` hook that only blocks.

Status: **design only**. No code, no git repo yet. Not pushed anywhere.

## Docs

| File | Contents |
|---|---|
| `docs/spec.md` | Decisions, architecture, source adapters, config, failure modes, open questions |
| `docs/plan.md` | Build order and test plan |
| `docs/research/varlock.md` | Why varlock doesn't fix this problem |
| `docs/research/oss-survey.md` | 49 pi packages surveyed; why we build instead of fork |
| `docs/personal/` | Machine-specific inventory and hardening log. **Must not be published** (gitignored) |

## Why

Past incident: secrets printed during an AI session meant rotating many keys. Root cause: mise decrypts age secrets into the shell env. pi inherits them, so one `env` or `forge -vvvv` sends them to the model and into session files, and memsearch then copies them into `~/memories`.
