# Decrypt mise task env through a temporary config

`mise env` never outputs a task's env, and mise has no command that decrypts it. So the `mise` source copies task-env age values into a throwaway `[env]` config in a fresh temp directory, then decrypts them with `mise env --json` on that directory. The temp config can't see age identity settings from the project's own config. In that case the task keys fail to decrypt. Each failed key is named, and the failure is treated like any other load failure: the session goes to the degraded state when it applies.

mise renders each decrypted value as a Tera template, and the temp config is trusted. A repo author who encrypts a template to a public key mise can use would run a template function at session start. So task keys are decrypted only from listed configs and from task scripts under the project root of a listed config. Task keys of drift configs and unlisted scripts run no mise and fail with `not in listFile`. Listing is the operator's trust decision. Later commits to a listed repo are out of scope.

## Considered Options

- Skip task-env keys and warn: simple, but leaves secrets in task output unredacted.
- Write the temp config inside the project: keeps project settings, but writes into the user's repo.
- Decrypt with `age` directly: motus would have to find and read the identity, which is a credential file it must never read.
