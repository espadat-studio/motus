<div align="center">

# motus

**[motus.espadat.com](https://motus.espadat.com)**

</div>

> Stop your AI coding agent from leaking your API keys.

An agent that runs `env`, `cat .env` or [`forge -vvvv`](https://book.getfoundry.sh/forge/) sends every value it prints to the model provider. In [pi](https://github.com/earendil-works/pi) it also lands in the session files, where memory tools copy it again. motus loads your secrets at session start and replaces each exact value with `[REDACTED:NAME]` before output leaves the tool. It also blocks the commands and files that print secrets in the first place.

- **[pi](https://github.com/earendil-works/pi)**: redaction plus blocks. Covers tool results, saved messages, prompts, `!` shell commands and the provider request.
- **Claude Code**: blocks only, through a `PreToolUse` hook. Claude Code ignores output rewrites for Bash, so there is nothing to redact with.
- **Five sources**: `env`, `command`, [`mise`](https://mise.jdx.dev), [`pa`](https://passwordass.org) and [`1password`](https://1password.com). One TOML file configures all of it.
- **Web3 safe**: no entropy or hex rules, so tx hashes, addresses and storage slots pass through untouched.
- **Fail closed**: a required source that fails where it applies blocks tools until you accept partial protection.

It stops accidental leaks only. A hostile or prompt-injected agent can exfiltrate a secret before any output is redacted. Use a sandbox for that.

Status: 1.0 is not published to npm yet, and the end-to-end smoke test in [pi](https://github.com/earendil-works/pi) is still open ([`meta/plan.md`](meta/plan.md)).

## Install

### pi

Install globally and load motus before every other extension:

```sh
pi install npm:@espadat/motus
```

`pi install` appends motus to the end of `packages` in `~/.pi/agent/settings.json`. Move it to the top:

```json
{
  "packages": [
    "npm:@espadat/motus",
    "npm:other-extension"
  ]
}
```

- Global, never `--local`: subagent [pi](https://github.com/earendil-works/pi) processes only load global extensions.
- First in `packages` of `~/.pi/agent/settings.json`: handlers run in load order, so an extension loaded earlier sees raw tool output and messages.
- [pi](https://github.com/earendil-works/pi) can't report handler order, so motus doesn't check either rule.

Create `~/.config/motus/config.toml`. Without it every session starts degraded.

### Claude Code

Install the package so `motus-cc-hook` is on your `PATH`:

```sh
npm install --global @espadat/motus
```

Add the hook to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Read|Bash",
        "hooks": [{ "type": "command", "command": "motus-cc-hook" }]
      }
    ]
  }
}
```

The hook reads the same `~/.config/motus/config.toml`. Create it first: without it the hook denies every `Read` and `Bash` call. It denies `Read` paths and `Bash` commands that match `blockPaths`, `blockCommands` or `claudeCode.blockCommands`. Invalid config, bad input or a crash denies the call too.

> [!WARNING]
> `!` shell mode bypasses motus. Never run `!env`, `!mise env` or `!pa …` in Claude Code.

Claude Code adds `!` commands and their output to the conversation, so values reach the model on the next request. `!` commands are not tool calls, so `PreToolUse` never fires and `motus-cc-hook` never sees them. [pi](https://github.com/earendil-works/pi) has no such gap: its `user_bash` handler redacts `!` output. Read secret values in your own terminal.

## Config

`~/.config/motus/config.toml`:

```toml
prefixes = ["sk-ant-", "ghp_", "github_pat_", "AKIA", "xox[bp]-"]
blockPaths = [
  "~/.config/mise/age.txt",
  "${PA_DIR:-~/.local/share/pa}/identities",
]
blockCommands = ["pa", "gh auth token", "op read"]
degradedAllowTools = []
minValueLength = 8

[[sources]]
type = "mise"
listFile = "~/.config/rotate-mise-secrets/files"

[claudeCode]
blockCommands = ["env", "printenv", "mise env", "cat .env*"]
```

| Key                        | Default                                              | Meaning                                                                                                              |
| -------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `sources`                  | `[]`, plus an `env` source unless you list one       | Where secrets load from                                                                                              |
| `prefixes`                 | `sk-ant-`, `ghp_`, `github_pat_`, `AKIA`, `xox[bp]-` | Vendor key prefixes redacted even when no source loaded the key                                                      |
| `blockPaths`               | `[]`                                                 | Files and directories nobody may read. `~`, `$HOME` and `${VAR:-fallback}` expand. A directory blocks all beneath it |
| `blockCommands`            | `[]`                                                 | Commands to block, matched at command position. `"gh auth token"` needs both words. `*` is a glob                    |
| `degradedAllowTools`       | `[]`                                                 | Tools still allowed while the session is degraded                                                                    |
| `minValueLength`           | `8`                                                  | Shorter values are ignored, with a warning that names the key                                                        |
| `claudeCode.blockCommands` | `[]`                                                 | Extra blocks for the Claude Code hook only, since it can't redact                                                    |

Unknown keys are errors. Every source also takes `id` (defaults to its `type`), `required` (default `true`) and `timeoutMs` (default `10000`). The config never holds secret values.

### Sources

| `type`                               | Options                            | Loads                                                                                                                                     |
| ------------------------------------ | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `env`                                | none                               | `process.env` entries whose names look secret (`KEY`, `TOKEN`, `SECRET`, …)                                                               |
| `command`                            | `command`                          | A shell command printing a `{"NAME": "value"}` JSON object                                                                                |
| [`mise`](https://mise.jdx.dev)       | `listFile`                         | [Age](https://age-encryption.org)-encrypted [mise](https://mise.jdx.dev) values, decrypted with [`mise env --json`](https://mise.jdx.dev) |
| [`pa`](https://passwordass.org)      | `entries` or `whole = true`, `dir` | [`pa`](https://passwordass.org) store entries                                                                                             |
| [`1password`](https://1password.com) | `refs`, `fromEnv`                  | `op://` references, resolved in one [`op inject`](https://developer.1password.com/docs/cli/) call                                         |

```toml
[[sources]]
type = "command"
id = "vault"
command = "my-vault export --json"
```

#### 1Password

```toml
[[sources]]
type = "1password"
fromEnv = true

[sources.refs]
API_TOKEN = "op://dev/api/token"
```

- `refs` names each secret by its key. `fromEnv = true` also loads env vars whose values are `op://` references, named by the var.
- All refs resolve in one [`op inject`](https://developer.1password.com/docs/cli/) call at session start. Expect one [1Password](https://1password.com) biometric or session prompt then, every session.
- A locked or missing [`op`](https://developer.1password.com/docs/cli/) fails the source. With `required = true` (the default) the session starts degraded.

#### pa

Loads [`pa`](https://passwordass.org) entries at session start, so their values get redacted. Keep [`pa`](https://passwordass.org) in `blockCommands` so [`pa show`](https://passwordass.org) stays blocked.

```toml
[[sources]]
type = "pa"
entries = ["web/github", "mail"]
```

- Exactly one of `entries` or `whole = true`. `whole` loads every entry except `*/meta`.
- `dir` defaults to `${PA_DIR:-~/.local/share/pa}`.
- Kept lines: non-blank, at least `minValueLength` chars. One kept line gives `web/github`. Several give `web/github:1`, `web/github:2`. An entry with none loads nothing.
- Entries decrypt one by one within the source's `timeoutMs` (default 10 s). Raise it for long `entries` lists or a large `whole` store.

A store created by [pa](https://passwordass.org) without a plugin uses a plain [age](https://age-encryption.org) key, so it decrypts with no prompt. Use `whole` for it, or for a TPM-keyed store (`age-plugin-tpm`). A YubiKey-keyed store asks for a PIN and a touch on every startup. The PIN needs a GUI pinentry, because [pi](https://github.com/earendil-works/pi) owns the terminal. Without one, the source times out and the session degrades. Prefer a short `entries` list there.

Several stores mean several sources, each with its own `id` and `dir`. Here a TPM store loads whole and a YubiKey store loads one entry:

```toml
[[sources]]
type = "pa"
id = "pa-machine"
dir = "~/.local/share/pa-machine"
whole = true

[[sources]]
type = "pa"
id = "pa-yubikey"
dir = "~/.local/share/pa"
entries = ["web/github"]
timeoutMs = 30000
```

## Use

- Session start reports how many secrets loaded and from which sources, never values.
- Degraded session: a required source failed where it applies, so every tool not in `degradedAllowTools` is blocked, `!` commands included.
- `/motus status`: loaded counts, failures and state.
- `/motus continue`: accept partial protection for this session. Blocks still apply.
- There is no `/motus off`. Read secret values in your own terminal.

## 1.0 stability

These follow semver after 1.0. Changing one is a major release.

- **Config schema**: the keys, defaults and source options in [Config](#config).
- **Source contract**: the `SecretSource` and `Secret` shapes in [`meta/spec.md`](meta/spec.md#source-adapters-d3).
- **Placeholder**: the `[REDACTED:NAME]` text.

Everything else can change in a minor release: exact block reasons, status text, derived forms and any module under `src/` other than the source contract.

## Post-1.0

Planned adapters: `pass`, `bitwarden`, `sops`, `secret-tool` and `security`. See [`meta/spec.md`](meta/spec.md#source-adapters-d3).

## Docs

| File                          | Contents                                                                                      |
| ----------------------------- | --------------------------------------------------------------------------------------------- |
| `meta/spec.md`                | Decisions, architecture, source adapters, config, failure modes                               |
| `meta/plan.md`                | Build order and test plan                                                                     |
| `meta/research/varlock.md`    | Why [varlock](https://varlock.dev) doesn't fix this problem                                   |
| `meta/research/oss-survey.md` | 49 [pi](https://github.com/earendil-works/pi) packages surveyed; why we build instead of fork |
| `meta/personal/`              | Machine-specific inventory and hardening log. **Must not be published** (gitignored)          |

## Why

Past incident: secrets printed during an AI session meant rotating many keys. Root cause: [mise](https://mise.jdx.dev) decrypts [age](https://age-encryption.org) secrets into the shell env. [pi](https://github.com/earendil-works/pi) inherits them, so one `env` or [`forge -vvvv`](https://book.getfoundry.sh/forge/) sends them to the model and into session files, and memsearch then copies them into `~/memories`.

_Motus et bouche cousue_: "not a word, lips sealed".
