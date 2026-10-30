# motus

Keeps secret values out of the model and out of saved agent sessions.

## Language

**Secret**:
A named value that must never reach the model or a saved session. Its name is not secret.
_Avoid_: credential (reserved for credential files), key

**Source**:
Somewhere secrets are loaded from at session start (environment, a command, mise, a password manager).
_Avoid_: provider, backend

**Store**:
A password manager's collection of entries, unlocked by one identity (a YubiKey, a TPM). A source reads one store.
_Avoid_: vault (1Password's own word), repo

**Task env**:
Secrets a mise config gives one task only while it runs, kept out of the shell env. Still secrets: task output can print them.
_Avoid_: task secrets, run env

**Required source**:
A source whose failure, in a repo it applies to, puts the session in the degraded state.

**Applies**:
A source applies to a working directory when that directory's secrets come from it.

**Value set**:
All loaded secrets plus their derived forms, held in memory for the session.

**Derived form**:
Another spelling of a secret's value that output may contain (with or without `0x`, other hex case, inside a URL, percent-encoded).

**Vendor prefix**:
A known key prefix that marks a value as secret even if no source loaded it.

**Redaction**:
Replacing every occurrence of a value-set entry or vendor-prefixed key with a placeholder.
_Avoid_: masking, scrubbing

**Placeholder**:
The text a secret is replaced with, naming the secret: `[REDACTED:NAME]`.

**Block**:
Refusing a tool call or user shell command before it runs, with a reason. Only the human can change what is blocked, outside the agent.
_Avoid_: deny, guard

**Credential file**:
A file whose contents unlock secrets (age identity, password-store keys). Blocked by path, never read.

**Degraded state**:
Session state after a required source failed where it applies. Every tool not allowlisted is blocked until the human accepts partial protection.

**Accidental leak**:
A well-meaning agent printing a secret. The only threat motus defends against.
_Avoid_: exfiltration (a deliberate leak, out of scope)

## Relationships

- A **Source** loads zero or more **Secrets**; a failing **Required source** that **Applies** causes the **Degraded state**
- The **Value set** is every loaded **Secret** plus its **Derived forms**
- **Redaction** turns **Value set** matches and **Vendor prefix** matches into **Placeholders**
- A **Block** stops output from existing; **Redaction** cleans output that exists

## Flagged ambiguities

- "unprotected" vs "degraded": the session is **Degraded** (tools blocked), never silently unprotected.
