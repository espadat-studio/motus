export interface MatcherOptions {
  prefixes: readonly string[]
  minValueLength: number
}

export interface Matcher {
  redact<T>(value: T): T
  readonly warnings: readonly string[]
}

const TOKEN_CHAR = 'A-Za-z0-9_-'
const MIN_PREFIXED_BODY_LENGTH = 8

export function createMatcher(
  secrets: readonly { name: string; value: string }[],
  { prefixes, minValueLength }: MatcherOptions,
): Matcher {
  const warnings: string[] = []
  const nameByForm = new Map<string, string>()
  for (const { name, value } of secrets) {
    if (value.length < minValueLength) {
      warnings.push(`${name} is shorter than ${minValueLength} characters and will not be redacted`)
      continue
    }
    for (const form of derivedForms(value))
      if (form.length >= minValueLength && !nameByForm.has(form)) nameByForm.set(form, name)
  }

  const branches = []
  if (nameByForm.size > 0)
    branches.push([...nameByForm.keys()].sort((a, b) => b.length - a.length).map(escapeRegExp).join('|'))
  if (prefixes.length > 0)
    branches.push(`(?<![${TOKEN_CHAR}])(?<prefix>${prefixes.join('|')})[${TOKEN_CHAR}]{${MIN_PREFIXED_BODY_LENGTH},}`)
  if (branches.length === 0) return { redact: (value) => value, warnings }

  const pattern = new RegExp(branches.join('|'), 'g')
  const redactString = (text: string): string =>
    text.replace(
      pattern,
      (match, ...rest) => `[REDACTED:${nameByForm.get(match) ?? (rest.at(-1) as { prefix: string }).prefix}]`,
    )

  return { redact: <T>(value: T): T => walk(value, redactString) as T, warnings }
}

function derivedForms(value: string): string[] {
  const encoded = encodeURIComponent(value)
  const forms = [value, encoded, encoded.replace(/%[0-9A-F]{2}/g, (sequence) => sequence.toLowerCase())]
  const hex = /^(?:0x)?([0-9a-fA-F]+)$/.exec(value)?.[1]
  if (hex) {
    for (const digits of [hex, hex.toLowerCase(), hex.toUpperCase()]) forms.push(digits, `0x${digits}`)
  }
  const url = URL.parse(value)
  if (url?.host) {
    for (const part of [url.username, url.password, ...url.pathname.split('/')]) forms.push(part, decode(part))
  }
  return forms
}

function decode(part: string): string {
  try {
    return decodeURIComponent(part)
  } catch (error) {
    if (error instanceof URIError) return part
    throw error
  }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function walk(value: unknown, redactString: (text: string) => string): unknown {
  if (typeof value === 'string') return redactString(value)
  if (Array.isArray(value)) return value.map((item) => walk(item, redactString))
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [redactString(key), walk(item, redactString)]))
  return value
}
