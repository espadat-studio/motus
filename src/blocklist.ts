import { realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path'

const SEPARATORS = new Set(['|', ';', '&', '\n', '(', ')'])
const WRAPPERS = new Set(['env', 'sudo', 'command', 'exec', 'time', 'nohup', 'xargs'])
const WRAPPER_ARG_FLAGS = new Map([
  ['env', new Set(['-u', '-C'])],
  ['sudo', new Set(['-u', '-g', '-C', '-D', '-h', '-p', '-r', '-t', '-U'])],
  ['time', new Set(['-f', '-o'])],
  ['xargs', new Set(['-I', '-L', '-n', '-P', '-s', '-d', '-E', '-a'])],
])
const KEYWORDS = new Set(['!', '{', '}', 'if', 'then', 'else', 'elif', 'do', 'while', 'until'])
const SHELLS = new Set(['bash', 'sh', 'zsh'])
const SCRIPT_RUNNERS = new Set([...SHELLS, 'eval', 'source', '.'])
const HOME_PREFIXES = ['~', '$HOME', '${HOME}', '"$HOME"', '"${HOME}"']
const ASSIGNMENT = /^[A-Za-z_]\w*=/
const SCRIPT_FLAG = /^-[a-z]*c[a-z]*$/
const PLACEHOLDER = /\[REDACTED:([^\]\s]+)\]/g
const TILDE = /^~(?=\/|$)/
const PATH_CONTINUES = '(?![\\w.-])'

interface Heredoc {
  delimiter: string
  isQuoted: boolean
  shouldStripTabs: boolean
}

class ParseError extends Error {}

export function checkCommand(command: string, blockCommands: readonly string[]): string | undefined {
  try {
    for (const words of listSimpleCommands(command)) {
      const entry = blockCommands.find((candidate) => matchesEntry(words, candidate))
      if (entry !== undefined) return `command matches blockCommands entry "${entry}"`
    }
  } catch (error) {
    if (error instanceof ParseError) return `cannot parse command: ${error.message}`
    throw error
  }
  return undefined
}

export function resolveBlockPaths(entries: readonly string[], env: NodeJS.ProcessEnv): string[] {
  return entries.map((entry) => {
    const expanded = expandPath(entry, env, 'blockPaths entry')
    if (!isAbsolute(expanded)) throw new Error(`blockPaths entry "${entry}" is not absolute after expansion`)
    return resolveRealpath(resolve(expanded))
  })
}

export function checkPath(arg: string, cwd: string, blockPaths: readonly string[], home: string): string | undefined {
  const path = resolveRealpath(resolve(cwd, arg.replace(TILDE, home)))
  const entry = blockPaths.find((blocked) => path === blocked || path.startsWith(blocked + sep))
  return entry === undefined ? undefined : `path is under blockPaths entry "${entry}"`
}

export function checkBashPaths(command: string, blockPaths: readonly string[], home: string): string | undefined {
  const realHome = resolveRealpath(home)
  const entry = blockPaths.find((blocked) =>
    listSpellings(blocked, home, realHome).some((spelling) =>
      new RegExp(escapeRegExp(spelling) + PATH_CONTINUES).test(command)
    )
  )
  return entry === undefined ? undefined : `command mentions blockPaths entry "${entry}"`
}

export function checkPlaceholders(input: string, loadedNames: ReadonlySet<string>): string | undefined {
  for (const [placeholder, name] of input.matchAll(PLACEHOLDER)) {
    if (name !== undefined && loadedNames.has(name))
      return `${placeholder} stands in for a loaded secret; writing it would replace the real value`
  }
  return undefined
}

function* listSimpleCommands(source: string): Generator<string[]> {
  const bodies: string[] = []
  const commands = splitCommands(source, bodies)
  for (const words of commands) {
    const command = skipPrefixes(words)
    const name = command[0]
    if (name === undefined) continue
    yield command
    if (basename(name) === 'eval') yield* listSimpleCommands(command.slice(1).join(' '))
    if (!SHELLS.has(basename(name))) continue
    const flag = command.findIndex((word, index) => index > 0 && SCRIPT_FLAG.test(word))
    if (flag === -1) continue
    const script = command[flag + 1] === '--' ? command[flag + 2] : command[flag + 1]
    if (script !== undefined) yield* listSimpleCommands(script)
  }
  if (!commands.some(runsScript)) return
  for (const body of bodies) yield* listSimpleCommands(body)
}

function runsScript(words: string[]): boolean {
  const name = skipPrefixes(words)[0]
  return name !== undefined && SCRIPT_RUNNERS.has(basename(name))
}

function skipPrefixes(words: string[]): string[] {
  let index = 0
  let lastWrapper: number | undefined
  while (index < words.length) {
    const word = words[index] ?? ''
    if (ASSIGNMENT.test(word) || KEYWORDS.has(word)) {
      index++
      continue
    }
    const wrapper = basename(word)
    if (!WRAPPERS.has(wrapper)) break
    lastWrapper = index
    const argFlags = WRAPPER_ARG_FLAGS.get(wrapper)
    for (index++; words[index]?.startsWith('-'); index++)
      if (argFlags?.has(words[index] ?? '')) index++
  }
  const isWrapperTheCommand = index >= words.length && lastWrapper !== undefined
  return words.slice(isWrapperTheCommand ? lastWrapper : index)
}

function splitCommands(source: string, bodies: string[]): string[][] {
  const commands: string[][] = []
  let words: string[] = []
  let word: string | undefined
  let heredocs: Heredoc[] = []
  const endWord = (): void => {
    if (word !== undefined) words.push(word)
    word = undefined
  }
  const endCommand = (): void => {
    endWord()
    if (words.length > 0) commands.push(words)
    words = []
  }
  const substitute = ([start, end]: [number, number]): number => {
    commands.push(...splitCommands(source.slice(start, end), bodies))
    word ??= ''
    return end
  }

  for (let index = 0; index < source.length; index++) {
    const char = source[index] ?? ''
    const substitution = findSubstitution(source, index)
    if (substitution !== undefined)
      index = substitute(substitution)
    else if (source.startsWith('((', index)) {
      const end = findClosing(source, '))', index + 2)
      commands.push(...listBodySubstitutions(source.slice(index + 2, end), bodies))
      index = end + 1
    } else if (source.startsWith('<<<', index)) {
      word = (word ?? '') + '<<<'
      index += 2
    } else if (source.startsWith('<<', index)) {
      endWord()
      const [heredoc, end] = readHeredoc(source, index)
      heredocs.push(heredoc)
      index = end - 1
    } else if (char === '\n' && heredocs.length > 0) {
      endCommand()
      const [read, end] = readBodies(source, index, heredocs)
      for (const [body, { isQuoted }] of read) {
        bodies.push(body)
        if (!isQuoted) commands.push(...listBodySubstitutions(body, bodies))
      }
      heredocs = []
      index = end
    } else if (char === '\\') {
      word = (word ?? '') + (source[index + 1] ?? '')
      index++
    } else if (char === "'") {
      const end = findClosing(source, "'", index + 1)
      word = (word ?? '') + source.slice(index + 1, end)
      index = end
    } else if (char === '"') {
      word ??= ''
      for (index++; index < source.length && source[index] !== '"'; index++) {
        const inner = findSubstitution(source, index)
        if (inner !== undefined)
          index = substitute(inner)
        else if (source[index] === '\\' && '"\\$`'.includes(source[index + 1] ?? '')) {
          word += source[index + 1]
          index++
        } else {
          word += source[index]
        }
      }
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

function findSubstitution(source: string, index: number): [number, number] | undefined {
  if (source.startsWith('$(', index)) return [index + 2, findClosingParen(source, index + 2)]
  if (source[index] === '`') return [index + 1, findClosing(source, '`', index + 1)]
  return undefined
}

function findClosing(source: string, char: string, from: number): number {
  const index = source.indexOf(char, from)
  return index === -1 ? source.length : index
}

function findClosingParen(source: string, from: number): number {
  let depth = 1
  let heredocs: Heredoc[] = []
  for (let index = from; index < source.length; index++) {
    const char = source[index]
    if (char === '\\') index++
    else if (char === "'" || char === '"') index = findClosing(source, char, index + 1)
    else if (source.startsWith('<<<', index)) index += 2
    else if (source.startsWith('<<', index)) {
      const [heredoc, end] = readHeredoc(source, index)
      heredocs.push(heredoc)
      index = end - 1
    } else if (char === '\n' && heredocs.length > 0) {
      index = readBodies(source, index, heredocs)[1]
      heredocs = []
    } else if (char === '(') depth++
    else if (char === ')' && --depth === 0) return index
  }
  return source.length
}

function readHeredoc(source: string, from: number): [Heredoc, number] {
  let index = from + 2
  const shouldStripTabs = source[index] === '-'
  if (shouldStripTabs) index++
  while (source[index] === ' ' || source[index] === '\t') index++
  let delimiter = ''
  let isQuoted = false
  for (; index < source.length && !/[\s;&|()<>]/.test(source[index] ?? ''); index++) {
    const char = source[index] ?? ''
    if (char === "'" || char === '"') {
      const end = findClosing(source, char, index + 1)
      delimiter += source.slice(index + 1, end)
      isQuoted = true
      index = end
    } else if (char === '\\') {
      delimiter += source[index + 1] ?? ''
      isQuoted = true
      index++
    } else {
      delimiter += char
    }
  }
  if (delimiter === '' && !isQuoted) throw new ParseError('heredoc has no delimiter')
  return [{ delimiter, isQuoted, shouldStripTabs }, index]
}

function readBodies(source: string, newline: number, heredocs: Heredoc[]): [Array<[string, Heredoc]>, number] {
  const bodies: Array<[string, Heredoc]> = []
  let start = newline + 1
  for (const heredoc of heredocs) {
    let lineStart = start
    let lineEnd = findClosing(source, '\n', lineStart)
    while (!isTerminator(source.slice(lineStart, lineEnd), heredoc)) {
      if (lineEnd === source.length) throw new ParseError(`unterminated heredoc "${heredoc.delimiter}"`)
      lineStart = lineEnd + 1
      lineEnd = findClosing(source, '\n', lineStart)
    }
    bodies.push([source.slice(start, lineStart), heredoc])
    start = lineEnd + 1
  }
  return [bodies, start - 1]
}

function isTerminator(line: string, { delimiter, shouldStripTabs }: Heredoc): boolean {
  return (shouldStripTabs ? line.replace(/^\t+/, '') : line) === delimiter
}

function listBodySubstitutions(body: string, bodies: string[]): string[][] {
  const commands: string[][] = []
  for (let index = 0; index < body.length; index++) {
    const substitution = findSubstitution(body, index)
    if (body[index] === '\\') index++
    else if (substitution !== undefined) {
      commands.push(...splitCommands(body.slice(...substitution), bodies))
      index = substitution[1]
    }
  }
  return commands
}

function matchesEntry(words: readonly string[], entry: string): boolean {
  const [head, ...rest] = entry.trim().split(/\s+/).map(globToRegExp)
  const name = words[0]
  if (head === undefined || name === undefined || !head.test(basename(name))) return false
  let index = 1
  for (const pattern of rest) {
    while (index < words.length && !pattern.test(basename(words[index] ?? ''))) index++
    if (index === words.length) return false
    index++
  }
  return true
}

function globToRegExp(glob: string): RegExp {
  return new RegExp(`^${escapeRegExp(glob).replaceAll('\\*', '.*')}$`)
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function expandPath(entry: string, env: NodeJS.ProcessEnv, at: string): string {
  const home = env['HOME']
  if (home === undefined) throw new Error('HOME is not set')
  return entry.replace(TILDE, home).replace(
    /\$(?:\{(\w+)(?::-([^}]*))?\}|(\w+))/g,
    (_match, braced, fallback: string | undefined, bare) => {
      const name: string = braced ?? bare
      const value = env[name]
      if (fallback !== undefined && !value) return fallback.replace(TILDE, home)
      if (value === undefined) throw new Error(`${at} "${entry}": $${name} is not set`)
      return value
    },
  )
}

function resolveRealpath(path: string): string {
  try {
    return realpathSync(path)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'ENOENT' && code !== 'ENOTDIR') throw error
    const parent = dirname(path)
    return parent === path ? path : join(resolveRealpath(parent), basename(path))
  }
}

function listSpellings(path: string, home: string, realHome: string): string[] {
  if (!path.startsWith(realHome + sep)) return [path]
  const relative = path.slice(realHome.length)
  return [path, ...[...HOME_PREFIXES, home].map((prefix) => prefix + relative)]
}
