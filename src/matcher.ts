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
const FRAGMENT_LENGTH = 12
const ORDINARY_URL_TEXT = /^[a-z_-]*$/

export function createMatcher(
  secrets: readonly { name: string; value: string }[],
  { prefixes, minValueLength }: MatcherOptions,
): Matcher {
  const warnings: string[] = []
  const nameByForm = new Map<string, string>()
  const nameByFragment = new Map<string, string>()
  for (const { name, value } of secrets) {
    if (value.length < minValueLength) {
      warnings.push(`${name} is shorter than ${minValueLength} characters and will not be redacted`)
      continue
    }
    const forms = derivedForms(value)
    for (const form of forms)
      if (form.length >= minValueLength && !nameByForm.has(form)) nameByForm.set(form, name)
    for (const fragment of fragments(urlPartForms(value) ?? forms))
      if (!nameByFragment.has(fragment)) nameByFragment.set(fragment, name)
  }

  const branches = []
  if (nameByForm.size > 0)
    branches.push([...nameByForm.keys()].sort((a, b) => b.length - a.length).map(escapeRegExp).join('|'))
  if (prefixes.length > 0)
    branches.push(`(?<![${TOKEN_CHAR}])(?<prefix>${prefixes.join('|')})[${TOKEN_CHAR}]{${MIN_PREFIXED_BODY_LENGTH},}`)
  if (branches.length === 0) return { redact: (value) => value, warnings }

  const pattern = new RegExp(branches.join('|'), 'g')
  const redactString = (text: string): string =>
    redactFragments(
      text.replace(
        pattern,
        (match, ...rest) =>
          `[REDACTED:${
            nameByForm.get(match)
              ?? nameByFragment.get(match.slice(0, FRAGMENT_LENGTH))
              ?? (rest.at(-1) as { prefix: string }).prefix
          }]`,
      ),
      nameByFragment,
    )

  return { redact: <T>(value: T): T => walk(value, redactString) as T, warnings }
}

function derivedForms(value: string): string[] {
  const forms = [value, ...percentEncodedForms(value)]
  const hex = /^(?:0x)?([0-9a-fA-F]+)$/.exec(value)?.[1]
  if (hex) {
    for (const digits of [hex, hex.toLowerCase(), hex.toUpperCase()]) forms.push(digits, `0x${digits}`)
  }
  forms.push(...(urlPartForms(value) ?? []))
  return forms
}

function percentEncodedForms(value: string): string[] {
  const encoded = encodeURIComponent(value)
  return [encoded, encoded.replace(/%[0-9A-F]{2}/g, (sequence) => sequence.toLowerCase())]
}

function urlPartForms(value: string): string[] | undefined {
  const url = URL.parse(value)
  if (!url?.host) return undefined
  const parts = [url.username, ...url.pathname.split('/')].filter((part) => !ORDINARY_URL_TEXT.test(decode(part)))
  if (![decode(url.username), url.protocol.slice(0, -1)].includes(decode(url.password))) parts.push(url.password)
  return parts.flatMap((part) => {
    const decoded = decode(part)
    return [part, decoded, ...percentEncodedForms(decoded)]
  })
}

function fragments(forms: readonly string[]): string[] {
  const result = []
  for (const form of forms) {
    for (const run of form.split(/\s+/)) {
      for (let start = 0; start + FRAGMENT_LENGTH <= run.length; start++)
        result.push(run.slice(start, start + FRAGMENT_LENGTH))
    }
  }
  return result
}

function redactFragments(text: string, nameByFragment: ReadonlyMap<string, string>): string {
  if (nameByFragment.size === 0) return text
  let output = ''
  let copied = 0
  let start = 0
  while (start + FRAGMENT_LENGTH <= text.length) {
    const name = nameByFragment.get(text.slice(start, start + FRAGMENT_LENGTH))
    if (!name) {
      start++
      continue
    }
    let end = start + FRAGMENT_LENGTH
    while (end < text.length && nameByFragment.has(text.slice(end + 1 - FRAGMENT_LENGTH, end + 1))) end++
    output += `${text.slice(copied, start)}[REDACTED:${name}]`
    copied = start = end
  }
  return output + text.slice(copied)
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
