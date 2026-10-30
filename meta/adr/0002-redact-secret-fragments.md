# Redact fragments of secrets of 12 or more characters

The spec said split or partial values were not covered. The pi smoke test (#30) showed this misses everyday accidental leaks: `cut -c1-80`, `head -c`, `tail -c`, `fold`, and output wrapped at a column limit all printed parts of a secret unredacted. We reverse that line. Any run of at least 12 characters that appears in a non-URL secret is now a derived form, redacted with that secret's placeholder.

K is a fixed 12, not a config option. A shorter K redacts unrelated text that shares a few characters with a secret. A longer one lets wrapped lines and short `cut` slices through. A chunk shorter than 12 can still leak, and we accept that.

Runs never cross whitespace inside a secret. That keeps PEM headers and common words in multi-line values from redacting unrelated text. URL-shaped secrets are left to a follow-up, because their scheme and host are public. Base64 and reversed values stay out of scope (D1: only deliberate leaks produce them).

Matching uses a hash set of every 12-character window, scanned once over the output. Cost grows with output length, not with the number of secrets, and adds no regex branch per fragment.

## Considered Options

- Configurable K: one more setting to get wrong, with no clear reason to tune it per user.
- One regex branch per fragment: about 3000 branches for 80 secrets, and slow to compile and run.
- Longest common substring per secret: catches the same leaks but is quadratic per output.
