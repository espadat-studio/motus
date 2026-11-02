# Upstream request: run `message_end` before custom message writes

Target: pi maintainers (`earendil-works/pi`). Not filed yet.

## Problem

Extension `message_end` handlers only see messages that pass through the agent loop. Three paths in `core/agent-session.js` persist custom messages with no extension hook:

| Path                                                | Writer                 |
| --------------------------------------------------- | ---------------------- |
| `sendMessage` while idle                            | `_appendCustomMessage` |
| `sendMessage` while streaming, `triggerTurn: false` | `_appendCustomMessage` |
| `custom_message` boundary drafts                    | `_applyBoundaryDrafts` |

`content` and `details` land in the session JSONL exactly as the sender wrote them. An extension that redacts at `message_end` (motus, `pi-redact`) cannot clean them.

Checked against pi 1.4.0.

## Request

Run the `message_end` handler chain on these messages before the session write. Same contract as loop messages: handlers may return a replacement message.

## Why it matters

Redaction extensions promise that persisted entries are clean. Other tools read the JSONL (memsearch, session export, sharing).

## Current mitigation

motus redacts these messages at `before_provider_request`, `session_before_compact` and `session_before_tree`. The raw JSONL entry stays. See `docs/src/content/docs/limits.md`.
