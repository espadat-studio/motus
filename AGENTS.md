# motus

## Tooling

`mise run setup` once, then `mise run check` (biome + dprint + tsc), `mise run fix`, `mise run test` (`node --test`).

The package has no build step: pi loads `extensions/*.ts` through jiti, so ship TypeScript source and use relative imports with explicit `.ts` extensions.

The site has one. `docs/` is a standalone Astro project with its own `package.json` and lockfile, outside every mise task, built by `.github/workflows/docs.yml`. Work on it with `npm --prefix docs ci` then `npm --prefix docs run build`.

## Design

Read `meta/spec.md` (decisions D1-D13, architecture, failure modes) before changing behavior, and `meta/plan.md` for the build order and test plan. Tests use fixtures only, never real secret values.

`meta/personal/` is gitignored and machine-specific: never commit, quote or publish it.

## Agent skills

### Issue tracker

GitHub Issues on `espadat-studio/motus`, via the `gh` CLI. See `meta/agents/issue-tracker.md`.

### Triage labels

Canonical strings, unmodified. See `meta/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` + `meta/adr/` at the repo root. See `meta/agents/domain.md`.
