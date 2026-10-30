---
title: Sources
description: The five secret sources motus loads at session start, and the options each takes.
---

A source loads named secrets when the session starts. motus keeps the values in memory, adds their other spellings (with and without `0x`, inside a URL, percent-encoded), and redacts all of them.

| `type`                               | Options                     | Loads                                              |
| ------------------------------------ | --------------------------- | -------------------------------------------------- |
| `env`                                | none                        | `process.env` entries whose names look secret      |
| `command`                            | `command`                   | A shell command that prints a JSON object          |
| [`mise`](https://mise.jdx.dev)       | `listFile`                  | Age-encrypted [mise](https://mise.jdx.dev) values  |
| [`pa`](https://passwordass.org)      | `entries` or `whole`, `dir` | Entries from a [pa](https://passwordass.org) store |
| [`1password`](https://1password.com) | `refs`, `fromEnv`           | `op://` references                                 |

## env

On by default, and it can't fail. It picks variables whose names contain `KEY`, `TOKEN`, `SECRET`, `PASS`, `PRIVATE`, `MNEMONIC`, `DATABASE_URL`, `AUTH`, `CREDENTIAL` or `DSN`. A short denylist skips noise such as `SSH_AUTH_SOCK` and `GUM_*`. A `DATABASE_URL` that has a host but no user, password or query is not secret and is skipped. It always loads `__MISE_DIFF` and `__MISE_SESSION`, the state [mise](https://mise.jdx.dev) keeps in the shell env: older mise versions store your env values there in plain text.

## command

Runs the command with `sh -c` in the working directory. It must print `{"NAME": "value"}` on stdout and exit 0. Anything else fails the source.

```toml
[[sources]]
type = "command"
id = "vault"
command = "my-vault export --json"
```

## mise

For each file in `listFile` plus the working directory's [mise](https://mise.jdx.dev) config, motus finds keys stored as `{ age = ... }` and decrypts them with [`mise env --json`](https://mise.jdx.dev). A `config.<env>.toml` file sets `MISE_ENV`.

```toml
[[sources]]
type = "mise"
listFile = "~/.config/rotate-mise-secrets/files"
```

- `listFile` has one absolute path per line. Blank lines and `#` comments are skipped.
- If the working directory has [age](https://age-encryption.org) keys that the list doesn't, motus warns about the drift and loads them anyway.
- If one file fails, the others still load. The session degrades only when the failed file covers the working directory.

## pa

Loads entries at session start so their values get redacted. Keep [`pa`](https://passwordass.org) in `blockCommands` so [`pa show`](https://passwordass.org) stays blocked.

```toml
[[sources]]
type = "pa"
entries = ["web/github", "mail"]
```

- Set exactly one of `entries` or `whole = true`. `whole` loads every entry except `*/meta`.
- `dir` defaults to `${PA_DIR:-~/.local/share/pa}`.
- Kept lines are non-blank and at least `minValueLength` characters. One kept line gives `web/github`. Several give `web/github:1`, `web/github:2`. An entry with none loads nothing.
- Entries decrypt one by one within the source's `timeoutMs`. Raise it for a long `entries` list or a large `whole` store.

The unlock method decides what startup costs:

| Store key                                                                           | Startup                        | Use                    |
| ----------------------------------------------------------------------------------- | ------------------------------ | ---------------------- |
| Plain [age](https://age-encryption.org) key ([pa](https://passwordass.org) default) | No prompt                      | `whole`                |
| TPM (`age-plugin-tpm`)                                                              | No prompt                      | `whole`                |
| YubiKey                                                                             | PIN and a touch, every startup | A short `entries` list |

The YubiKey PIN needs a GUI pinentry, because [pi](https://github.com/earendil-works/pi) owns the terminal. Without one the source times out and the session degrades.

Several stores mean several sources, each with its own `id` and `dir`:

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

## 1password

Resolves `op://` references in one [`op inject`](https://developer.1password.com/docs/cli/) call at session start. Expect one [1Password](https://1password.com) biometric or session prompt every session.

```toml
[[sources]]
type = "1password"
fromEnv = true

[sources.refs]
API_TOKEN = "op://dev/api/token"
```

- `refs` names each secret by its key.
- `fromEnv = true` also loads env vars whose values are `op://` references, named by the variable.
- Give it `refs`, `fromEnv = true`, or both.
- A locked or missing [`op`](https://developer.1password.com/docs/cli/) fails the source. With `required = true` the session starts degraded.
