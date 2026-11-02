export interface MatcherOptions {
  prefixes: readonly string[]
  minValueLength: number
}

export interface Matcher {
  redact<T>(value: T): T
  readonly warnings: readonly string[]
}

const TOKEN_CHAR = 'A-Za-z0-9_-'
const ESCAPE_RESIDUE = String
  .raw`\\(?:[bfnrt"\\/]|u[0-9a-fA-F]{4})|%[0-9a-fA-F]{2}|(?:\x1b|\\u001[bB]|\\x1[bB]|\\033|\\e)\[[0-?]*[ -/]*[@-~]`
const MIN_PREFIXED_BODY_LENGTH = 8
const FRAGMENT_LENGTH = 12
const ORDINARY_URL_TEXT = /^[a-z_-]*$/

export function prefixBranch(prefixes: readonly string[]): string {
  return `(?:(?<![${TOKEN_CHAR}])|(?<=${ESCAPE_RESIDUE}))(?<prefix>${
    prefixes.join('|')
  })[${TOKEN_CHAR}]{${MIN_PREFIXED_BODY_LENGTH},}`
}

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
    branches.push(prefixBranch(prefixes))
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
  const forms = [value, ...percentEncodedForms(value), ...escapedForms(value)]
  const hex = /^(?:0x)?([0-9a-fA-F]+)$/.exec(value)?.[1]
  if (hex) {
    for (const digits of [hex, hex.toLowerCase(), hex.toUpperCase()]) forms.push(digits, `0x${digits}`)
  }
  forms.push(...(urlPartForms(value) ?? []))
  return forms
}

function escapedForms(value: string): string[] {
  const json = JSON.stringify(value).slice(1, -1)
  const doubleQuoted = value.replace(/[\\"$`]/g, '\\$&')
  const singleQuoted = value.replaceAll("'", "'\\''")
  return [json, doubleQuoted, singleQuoted, ansiCQuoted(value)].filter((form) => form !== value)
}

const ANSI_C_ESCAPES: Record<string, string> = {
  '\x07': '\\a',
  '\b': '\\b',
  '\x1b': '\\E',
  '\f': '\\f',
  '\n': '\\n',
  '\r': '\\r',
  '\t': '\\t',
  '\v': '\\v',
  '\\': '\\\\',
  "'": "\\'",
}

function ansiCQuoted(value: string): string {
  return value.replace(
    /[\p{Cc}\\']/gu,
    (char) => {
      const code = char.charCodeAt(0)
      if (code > 0x1f && code !== 0x7f && !(char in ANSI_C_ESCAPES)) return char
      return ANSI_C_ESCAPES[char] ?? `\\${code.toString(8).padStart(3, '0')}`
    },
  )
}

const PERCENT_VARIANTS: readonly (readonly [RegExp, (match: string) => string])[] = [
  [/%20/g, () => '+'],
  [/%2F/g, () => '/'],
  [/~/g, () => '%7E'],
  [/[!'()]/g, (char: string) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`],
  [/\*/g, () => '%2A'],
]

function percentEncodedForms(value: string): string[] {
  const base = encodeURIComponent(value)
  const forms = new Set<string>()
  for (let mask = 0; mask < 1 << PERCENT_VARIANTS.length; mask++) {
    const encoded = PERCENT_VARIANTS.reduce(
      (text, [pattern, replacement], index) => (mask & (1 << index) ? text.replace(pattern, replacement) : text),
      base,
    )
    forms.add(encoded)
    forms.add(lowercaseEscapes(encoded))
  }
  return [...forms]
}

function lowercaseEscapes(text: string): string {
  return text.replace(/%[0-9A-F]{2}/g, (sequence) => sequence.toLowerCase())
}

function urlPartForms(value: string): string[] | undefined {
  const url = URL.parse(value)
  if (!url?.host) return undefined
  const parts = [
    url.username,
    ...url.pathname.split('/'),
    ...url.search.slice(1).split('&').map(parameterValue),
    url.hash.slice(1),
    ...url.hash.slice(1).split('&').map(parameterValue),
  ]
    .filter((part) => !ORDINARY_URL_TEXT.test(decode(part)))
  if (![decode(url.username), url.protocol.slice(0, -1)].includes(decode(url.password))) parts.push(url.password)
  return parts.flatMap((part) => {
    const decoded = decode(part)
    return [part, lowercaseEscapes(part), decoded, ...percentEncodedForms(decoded)]
  })
}

function parameterValue(pair: string): string {
  return pair.slice(pair.indexOf('=') + 1)
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
