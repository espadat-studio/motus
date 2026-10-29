# Plan

Each step is one atomic commit. Git user: `sripwoud`. Don't push until told.

| # | Step                                                                                                                                      | Status                   |
| - | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| 1 | Local hardening (see `personal/hardening.md`)                                                                                             | in progress: 2 of 5 done |
| 2 | Resolve the spec's open questions; scaffold the repo (git init, TS, test runner, MIT `CREDITS.md` for pi-secret-safe, pi-redact, pi-fnox) | done                     |
| 3 | Core, test-first: matcher (exact + derived forms + prefixes), path/command blocklist, adapter contract, config validation                 | todo                     |
| 4 | Adapters: `env`, `command`, `mise`                                                                                                        | todo                     |
| 5 | pi extension: wire the events from `spec.md`; degraded state; `/motus status`, `/motus continue`                                          | todo                     |
| 6 | Shared config in chezmoi (`~/.config/motus/config.json`)                                                                                  | todo                     |
| 7 | Claude Code `PreToolUse` block hook; check whether #54196 is still open                                                                   | todo                     |
| 8 | Smoke test in pi (below)                                                                                                                  | todo                     |
| 9 | Roadmap: `pa` and `1password` adapters (D20)                                                                                              | todo                     |

## Test plan

Unit tests (fixtures only, never real values):

- Exact match, longest first; 8-character minimum; `0x`, URL-path and percent-encoded derived forms.
- Multi-line and quote-containing values redacted inside a nested provider payload (string walk, not serialized JSON).
- Web3 negatives: tx hashes, addresses and storage slots pass through untouched.
- Vendor prefixes.
- Blocklist: `pa show x`, `echo $(pa s x)`, `sudo pa show x`, `bash -c 'pa show x'`, `cat ~/.config/mise/age.txt`, `cat $HOME/.config/mise/age.txt`, `read`/`grep` tools on blocked paths and paths under blocked dirs; the negative `npm run paint` is not blocked.
- Placeholder write-back: `edit`/`write`/`bash` input with `[REDACTED:<loaded name>]` blocked; unloaded names pass.
- Adapter failure: throws → degraded only when `appliesTo` is true; degraded blocks every non-allowlisted tool.
- `structuredContent` and `details` (edit `diff`/`patch`) are redacted, not dropped.
- `user_bash`: output redacted in the returned result; blocked commands rejected.
- CC hook: `env`, `mise env` denied via `claudeCode.blockCommands`; same blocklist cases as pi.

Smoke test in pi:

- [ ] `env` in `exodus-checkout`; `cat` a mise config; `cd ../recordreel && mise env`; `!env` and `!!env`.
- [ ] `rg -F` each known value over the session JSONL: 0 hits (script prints counts only).
- [ ] memsearch capture after the session: 0 hits in `~/memories`.
- [ ] Break the age key file: tools blocked in an age repo; only a warning in `~/knowledge`.
