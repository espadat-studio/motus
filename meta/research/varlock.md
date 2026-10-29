# varlock: evaluation

_2026-10-29 UTC. Source: `github.com/dmno-dev/varlock` cloned at HEAD (last commit 2026-10-28), docs under `packages/varlock-website/src/content/docs/guides/` (`ai-tools.mdx`, `proxy.mdx`, `telemetry.mdx`)._

**Verdict: don't adopt it for the leak problem.** It solves a different one: keeping plaintext secrets out of files. Our secrets are already age-encrypted on disk. They leak through the **process env**, which agents inherit.

| Feature | Fit |
| --- | --- |
| `.env.schema`: agents read names and types, not values | Little gain. Values are already encrypted (mise age) |
| Local encryption and 18 provider plugins (1Password, Bitwarden, pass, …) | Duplicates mise age plus `rotate-mise-secrets` |
| `varlock load --agent` (JSON, `@sensitive` redacted) | Only helps if the agent uses it. Same user, so `varlock run -- env` still prints everything |
| `varlock scan` (resolved values compared against the codebase) | Overlaps gitleaks |
| `varlock proxy run -- <agent>` (placeholders in env, real secret swapped in on the wire) | The only real protection, but: preview with unstable API (`proxy.mdx`); HTTPS API keys only; HTTP/1.1 only; needs proxy-aware clients; not a boundary without `--sandbox`; response scrubbing skips gzip and bodies >2 MB |

Gaps for this machine:

- Private keys, mnemonics and Postgres URLs can't be proxied. They're used locally, not sent over HTTPS, and they're the most dangerous secrets in the inventory.
- Anonymous telemetry is on by default (`telemetry.mdx`). The CLI spawns `varlock --flush-telemetry` detached.

Possible later use: `varlock proxy` for HTTP API keys (`ANTHROPIC_AUTH_TOKEN`, `ALCHEMY_API_KEY`, `CHECKLY_API_KEY`) once it's out of preview. That's a separate track (hostile-agent threat model), not this project.
