#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

tarball=$(cd "$work" && npm pack "$root" --silent)
mkdir "$work/app" "$work/home"
cd "$work/app"
npm init -y >/dev/null
npm install --silent "$work/$tarball"

cat >load.mjs <<'JS'
import { createJiti } from 'jiti'

const entry = await createJiti(import.meta.url).import('@espadat/motus/extensions/motus.ts', { default: true })
if (typeof entry !== 'function') throw new Error('pi extension entry is not a function')
JS
node load.mjs

mkdir -p "$work/home/.config/motus"
printf 'blockCommands = ["pa"]\n' >"$work/home/.config/motus/config.toml"
hook=node_modules/.bin/motus-cc-hook
run() {
  printf '{"cwd":"%s","tool_name":"Bash","tool_input":{"command":"%s"}}' "$work/home" "$1" | HOME="$work/home" "$hook"
}

[ -z "$(run 'ls')" ] || { echo "expected allow for 'ls'" >&2; exit 1; }
run 'pa show x' | grep -q '"permissionDecision":"deny"' || { echo "expected deny for 'pa show x'" >&2; exit 1; }
