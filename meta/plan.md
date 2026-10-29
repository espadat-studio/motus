# Plan

Each step is one atomic commit. Git user: `sripwoud`. Don't push until told.

| # | Step | Status |
| --- | --- | --- |
| 1 | Local hardening (see `personal/hardening.md`) | in progress: 2 of 5 done |
| 2 | Resolve the spec's open questions; scaffold the repo (git init, TS, test runner, MIT `CREDITS.md` for pi-secret-safe, pi-redact, pi-fnox) | todo |
| 3 | Core, test-first: matcher (exact + derived forms + prefixes), path/command blocklist, adapter contract, config validation | todo |
| 4 | Adapters: `env`, `command`, `mise` (then `1password`, `pa` per open question 1) | todo |
| 5 | pi extension: wire the events from `spec.md`; degraded state; `/motus status`, `/motus continue` | todo |
| 6 | Shared config in chezmoi (`~/.config/pi-motus/config.json`) | todo |
| 7 | Claude Code `PreToolUse` block hook; check whether #54196 is still open | todo |
| 8 | Smoke test in pi (below) | todo |

## Test plan

Unit tests (fixtures only, never real values):

- Exact match, longest first; 8-character minimum; `0x` and URL-path derived forms.
- Web3 negatives: tx hashes, addresses and storage slots pass through untouched.
- Vendor prefixes.
- Blocklist: `pa show x`, `echo $(pa s x)`, `cat ~/.config/mise/age.txt`, `read` tool on blocked paths; the negative `npm run paint` is not blocked.
- Adapter failure: throws → degraded only when `appliesTo` is true.
- `structuredContent` is redacted, not dropped.

Smoke test in pi:

- [ ] `env` in `exodus-checkout`; `cat` a mise config; `cd ../recordreel && mise env`.
- [ ] `rg -F` each known value over the session JSONL: 0 hits (script prints counts only).
- [ ] memsearch capture after the session: 0 hits in `~/memories`.
- [ ] Break the age key file: tools blocked in an age repo; only a warning in `~/knowledge`.
