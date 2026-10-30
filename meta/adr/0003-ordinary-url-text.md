# Keep ordinary URL text out of URL derived forms

Every URL path segment and username of 8 or more characters used to be a derived form, so a secret holding `/ethereum/<key>` redacted the word `ethereum` everywhere. A `postgres` username did the same to `postgres`. In a web3 repo that noise teaches people to distrust the tool, which is why there are no generic hex rules.

A path segment, username, query value or `#` part made only of lowercase letters, `-` and `_` is now ordinary URL text. It is redacted only as part of the full URL, never on its own, either exactly or as a fragment. A random key of 32 characters will not match that shape. The rule allows no digits, because lowercase hex keys would then match, so `us-east-1` in a secret stays noisy.

A password is always secret, because `correcthorse` is a real password. The one exception is a password equal to the URL's own username or scheme, as in the Docker default `postgres://postgres:postgres@localhost`. It protects nothing, since the same URL shows it.

The cost is a human-chosen lowercase slug used as a path secret. In `/hooks/correct-horse-battery`, the slug printed alone is not redacted. We accept that. This check narrows redaction, so it does not reverse the ban on entropy rules, which would widen it.

Query values and `#` parts count as secret parts, because `?dkey=<key>` is a common RPC URL shape and the complete key used to leak. Parameter names never do. A list of secret-looking names would lag behind vendors, and the lowercase rule already spares `network=ethereum` and `sslmode=require`.

## Considered Options

- No rule: leaks nothing new, but keeps redacting `ethereum` across all output.
- Rule for fragments only: `ethereum-mainly` survives while `ethereum` is still redacted, so little improves.
- A digit requirement: a key with no digits is rare but real, and a shape of lowercase words is much rarer.
- Secret-looking parameter names only: misses names such as `dkey` until someone adds them.
