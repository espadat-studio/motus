# Decrypt mise task env through a temporary config

`mise env` never outputs a task's env, and mise has no command that decrypts it. So the `mise` source copies task-env age values into a throwaway `[env]` config in a fresh temp directory, then decrypts them with `mise env --json` on that directory. The temp config can't see age identity settings from the project's own config. In that case the task keys fail to decrypt. Each failed key is named, and the failure is treated like any other load failure: the session goes to the degraded state when it applies.

## Considered Options

- Skip task-env keys and warn: simple, but leaves secrets in task output unredacted.
- Write the temp config inside the project: keeps project settings, but writes into the user's repo.
- Decrypt with `age` directly: motus would have to find and read the identity, which is a credential file it must never read.
