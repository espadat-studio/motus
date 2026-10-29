---
title: pi-motus
description: "Keep secrets out of the model and pi's session files: exact-value redaction from pluggable secret sources, credential path and command blocks, fail-closed."
---

> _Motus et bouche cousue_: "not a word, lips sealed".

A well-meaning agent prints secrets all the time: `env`, `cat .env`, `forge -vvvv`, `mise env`, debug logs. Each one sends the values to the model provider and into pi's session files, where memory tools copy them further. pi-motus redacts known secret values before they leave the tool result, and blocks the commands and files that print them.

Status: **in development**. Nothing is published yet.

## What it does

- **Exact-value redaction** from pluggable secret sources: `process.env`, any command printing JSON, mise age-encrypted configs. Matches become `[REDACTED:NAME]`
- **Vendor-prefix rules** (`sk-ant-`, `ghp_`, `AKIA`, ...) for keys that were never loaded
- **No entropy or generic hex rules**, so tx hashes, addresses and storage slots in web3 repos survive
- **Path and command blocks** for credential files and secret-manager CLIs (`pa show`, `gh auth token`, `op read`)
- **Fail-closed**: a required source that fails in a repo where it applies blocks bash, read and MCP tools until you act

## What it does not do

It defends against accidental leaks only. A hostile or prompt-injected agent can exfiltrate a secret before any output is redacted, or encode it past exact matching. Protecting against that takes agents that never inherit secrets, or a sandbox.
