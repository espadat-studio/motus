# Redact fragments of secrets of 12 or more characters

The spec said split or partial values were not covered. The pi smoke test (#30) showed this misses everyday accidental leaks: `cut -c1-80`, `head -c`, `tail -c`, `fold`, and output wrapped at a column limit all printed parts of a secret unredacted. We reverse that line. Any run of at least 12 characters that appears in a secret is now a derived form, redacted with that secret's placeholder. For a URL-shaped secret, only its secret parts count.

K is a fixed 12, not a config option. A shorter K redacts unrelated text that shares a few characters with a secret. A longer one lets wrapped lines and short `cut` slices through. A chunk shorter than 12 can still leak, and we accept that.

Runs never cross whitespace inside a secret. That keeps PEM headers and common words in multi-line values from redacting unrelated text. Base64 and reversed values stay out of scope (D1: only deliberate leaks produce them).

A URL's scheme, host and port are public, so they never become fragments. Only its secret parts do, each on its own and in raw, decoded and percent-encoded spellings. ADR-0003 says which parts those are. A part under 12 characters, such as `v2`, yields nothing.

Only a value that parses as a URL with a host gets this treatment. Anything else is opaque, even if it looks like a URL: an unencoded `/` in a password, a hostless `postgres:///db`, a URL inside JSON, or a comma-separated list. Their public text can be redacted, which is noise and not a leak. A public host inside a path segment, as in a proxied URL, fragments the same way.

Matching uses a hash set of every 12-character window, scanned once over the output. Cost grows with output length, not with the number of secrets, and adds no regex branch per fragment.

## Considered Options

- Configurable K: one more setting to get wrong, with no clear reason to tune it per user.
- One regex branch per fragment: about 3000 branches for 80 secrets, and slow to compile and run.
- Longest common substring per secret: catches the same leaks but is quadratic per output.
