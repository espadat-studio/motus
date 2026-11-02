# Upstream request: hook codemode `store()` and `models.*`

Target: pi maintainers (`earendil-works/pi`). Not filed yet.

## Problem

Codemode scripts reach three exits that no extension hook sees:

| Exit                    | Path                           | Missing hook                  |
| ----------------------- | ------------------------------ | ----------------------------- |
| `store()`               | `pi.appendEntry`               | Nothing runs before the write |
| `models.classify`       | `modelRegistry.classify`       | `onPayload`                   |
| `models.generateImages` | `modelRegistry.generateImages` | `onPayload`                   |

A script can turn text that redaction missed into the exact secret, such as a parsed escape or a URL secret wrapped inside its key. It can then store it or send it to a provider. The same value returned as script output is redacted.

Codemode is active by default with any configured MCP server.

## Request

- Run a hook before `appendEntry` persists. The handler may return a replacement entry.
- Pass `onPayload` on `models.classify` and `models.generateImages`, with the same contract as `before_provider_request`.

## Why it matters

Redaction extensions promise that persisted entries and provider requests are clean. These exits break both promises.

## Current mitigation

None. motus documents the gap in `docs/src/content/docs/limits.md`. Blocking codemode is out of scope.

## Regression case

When the hooks exist, `test/codemode-sinks.test.ts` must pass: a script that parses an escaped value, then stores or classifies it, leaves no raw value.
