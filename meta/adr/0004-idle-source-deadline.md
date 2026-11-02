# A source's timeout is an idle deadline

`timeoutMs` used to bound a source's whole load. A TPM-keyed `pa` store unlocks one entry at a time, and the TPM serves one operation at a time, so load time grows with the number of pi processes starting together. Parallel sub-agents then degraded on a healthy store: two of them timed out a 10 s deadline on a store that loads alone in 4.4 s.

`timeoutMs` is now the longest a source may go without progress. A source that loads in steps reports progress after each one: `pa` after each entry, `mise` after each file. Single-step sources (`env`, `command`, `onepassword`) never report, so for them it stays the whole-load deadline. A hung step still fails within `timeoutMs`. There is no total cap: a source that keeps making progress is not broken, and tools stay blocked until it finishes, so a slow start leaks nothing.

Measured on one TPM store of 10 entries, each load being `pa list` plus 10 `pa show`:

| Parallel loads | Wall time | Per call |
| -------------- | --------- | -------- |
| 1              | 4.4 s     | 0.40 s   |
| 2              | 7.8 s     | 0.71 s   |
| 4              | 13.4 s    | 1.22 s   |
| 8              | 26.1 s    | 2.37 s   |

Per-call time also grows, about 0.3 s per process, so the 10 s default holds to roughly 30 parallel loads on this TPM. Beyond that, raise `timeoutMs`.

## Considered Options

- Total deadline, documented "raise it for parallel sub-agents": no fixed value survives a growing fan-out.
- Retry once after a timeout: succeeds only if fewer processes happen to be loading, doubles the worst case, and re-prompts a YubiKey store.
- Keep loading after the deadline and lift the degraded state when it finishes: a new transition out of degraded state, after the agent may already have acted on the blocks.
- Parent shares decrypted values with sub-agents: moves secret values between processes, and the subagent tool, not motus, spawns them.
