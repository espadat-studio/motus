import { realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path'

const SEPARATORS = new Set(['|', ';', '&', '\n', '(', ')'])
const WRAPPERS = new Set(['env', 'sudo', 'command', 'exec', 'time', 'nohup', 'xargs'])
const KEYWORDS = new Set(['!', '{', '}', 'if', 'then', 'else', 'elif', 'do', 'while', 'until'])
const SHELLS = new Set(['bash', 'sh', 'zsh'])
const ASSIGNMENT = /^[A-Za-z_]\w*=/
const SCRIPT_FLAG = /^-[a-z]*c[a-z]*$/
const PLACEHOLDER = /\[REDACTED:([^\]\s]+)\]/g

export function commandBlockReason(command: string, blockCommands: readonly string[]): string | undefined {
  for (const words of simpleCommands(command)) {
    const entry = blockCommands.find((candidate) => matchesEntry(words, candidate))
    if (entry !== undefined) return `command matches blockCommands entry "${entry}"`
  }
  return undefined
}

export function resolveBlockPaths(entries: readonly string[], env: NodeJS.ProcessEnv): string[] {
  return entries.map((entry) => {
    const expanded = expandPath(entry, env)
    if (!isAbsolute(expanded)) throw new Error(`blockPaths entry "${entry}" is not absolute after expansion`)
    return realpathLoose(resolve(expanded))
  })
}

export function pathBlockReason(
  arg: string,
  cwd: string,
  blockPaths: readonly string[],
  home: string,
): string | undefined {
  const path = realpathLoose(resolve(cwd, arg.replace(/^~(?=\/|$)/, home)))
  const entry = blockPaths.find((blocked) => path === blocked || path.startsWith(blocked + sep))
  return entry === undefined ? undefined : `path is under blockPaths entry "${entry}"`
}

export function bashPathBlockReason(
  command: string,
  blockPaths: readonly string[],
  home: string,
): string | undefined {
  const realHome = realpathLoose(home)
  const entry = blockPaths.find((blocked) =>
    spellings(blocked, home, realHome).some((spelling) => command.includes(spelling))
  )
  return entry === undefined ? undefined : `command mentions blockPaths entry "${entry}"`
}

export function placeholderBlockReason(input: string, loadedNames: ReadonlySet<string>): string | undefined {
  for (const [placeholder, name] of input.matchAll(PLACEHOLDER)) {
    if (name !== undefined && loadedNames.has(name))
      return `${placeholder} stands in for a loaded secret; writing it would replace the real value`
  }
  return undefined
}

function* simpleCommands(source: string): Generator<string[]> {
  for (const words of splitCommands(source)) {
    const command = skipPrefixes(words)
    const name = command[0]
    if (name === undefined) continue
    yield command
    if (basename(name) === 'eval') yield* simpleCommands(command.slice(1).join(' '))
    if (!SHELLS.has(basename(name))) continue
    const flag = command.findIndex((word, index) => index > 0 && SCRIPT_FLAG.test(word))
    const script = flag === -1 ? undefined : command[flag + 1]
    if (script !== undefined) yield* simpleCommands(script)
  }
}

function skipPrefixes(words: string[]): string[] {
  let index = 0
  while (index < words.length) {
    const word = words[index] ?? ''
    if (ASSIGNMENT.test(word) || KEYWORDS.has(word)) {
      index++
      continue
    }
    if (!WRAPPERS.has(basename(word))) break
    index++
    while (words[index]?.startsWith('-')) index++
  }
  return words.slice(index)
}

function splitCommands(source: string): string[][] {
  const commands: string[][] = []
  let words: string[] = []
  let word: string | undefined
  const endWord = (): void => {
    if (word !== undefined) words.push(word)
    word = undefined
  }
  const endCommand = (): void => {
    endWord()
    if (words.length > 0) commands.push(words)
    words = []
  }
  const substitute = (start: number, end: number): void => {
    commands.push(...splitCommands(source.slice(start, end)))
    word ??= ''
  }

  for (let index = 0; index < source.length; index++) {
    const char = source[index] ?? ''
    if (char === '\\') {
      word = (word ?? '') + (source[index + 1] ?? '')
      index++
    } else if (char === "'") {
      const end = closingIndex(source, "'", index + 1)
      word = (word ?? '') + source.slice(index + 1, end)
      index = end
    } else if (char === '"') {
      word ??= ''
      for (index++; index < source.length && source[index] !== '"'; index++) {
        const inner = source[index] ?? ''
        if (inner === '\\' && '"\\$`'.includes(source[index + 1] ?? '')) {
          word += source[index + 1]
          index++
        } else if (inner === '$' && source[index + 1] === '(') {
          const end = closingParen(source, index + 2)
          substitute(index + 2, end)
          index = end
        } else if (inner === '`') {
          const end = closingIndex(source, '`', index + 1)
          substitute(index + 1, end)
          index = end
        } else {
          word += inner
        }
      }
    } else if (char === '$' && source[index + 1] === '(') {
      const end = closingParen(source, index + 2)
      substitute(index + 2, end)
      index = end
    } else if (char === '`') {
      const end = closingIndex(source, '`', index + 1)
      substitute(index + 1, end)
      index = end
    } else if (char === ' ' || char === '\t')
      endWord()
    else if (SEPARATORS.has(char))
      endCommand()
    else
      word = (word ?? '') + char
  }
  endCommand()
  return commands
}

function closingIndex(source: string, char: string, from: number): number {
  const index = source.indexOf(char, from)
  return index === -1 ? source.length : index
}

function closingParen(source: string, from: number): number {
  let depth = 1
  for (let index = from; index < source.length; index++) {
    const char = source[index]
    if (char === '\\') index++
    else if (char === "'" || char === '"') index = closingIndex(source, char, index + 1)
    else if (char === '(') depth++
    else if (char === ')' && --depth === 0) return index
  }
  return source.length
}

function matchesEntry(words: readonly string[], entry: string): boolean {
  const [head, ...rest] = entry.trim().split(/\s+/).map(globToRegExp)
  const name = words[0]
  if (head === undefined || name === undefined || !head.test(basename(name))) return false
  let index = 1
  for (const pattern of rest) {
    while (index < words.length && !pattern.test(words[index] ?? '')) index++
    if (index === words.length) return false
    index++
  }
  return true
}

function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*')
  return new RegExp(`^${escaped}$`)
}

function expandPath(entry: string, env: NodeJS.ProcessEnv): string {
  const home = env['HOME']
  if (home === undefined) throw new Error('HOME is not set')
  return entry.replace(/^~(?=\/|$)/, home).replace(/\$(?:\{(\w+)\}|(\w+))/g, (_match, braced, bare) => {
    const name: string = braced ?? bare
    const value = env[name]
    if (value === undefined) throw new Error(`blockPaths entry "${entry}": $${name} is not set`)
    return value
  })
}

function realpathLoose(path: string): string {
  try {
    return realpathSync(path)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'ENOENT' && code !== 'ENOTDIR') throw error
    const parent = dirname(path)
    return parent === path ? path : join(realpathLoose(parent), basename(path))
  }
}

function spellings(path: string, home: string, realHome: string): string[] {
  if (!path.startsWith(realHome + sep)) return [path]
  const relative = path.slice(realHome.length)
  return [path, ...['~', '$HOME', '${HOME}', home].map((prefix) => prefix + relative)]
}
