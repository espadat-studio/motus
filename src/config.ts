import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'

import { parse } from 'smol-toml'

import type { SecretSource } from './sources.ts'
import { commandSource } from './sources/command.ts'
import { envSource } from './sources/env.ts'
import { miseSource } from './sources/mise.ts'
import { isOnePasswordRef, isSecretName, onePasswordSource } from './sources/onepassword.ts'
import { paSource } from './sources/pa.ts'

export interface ConfiguredSource {
  source: SecretSource
  required: boolean
  timeoutMs: number
}

export interface Config {
  sources: ConfiguredSource[]
  prefixes: string[]
  blockPaths: string[]
  blockCommands: string[]
  degradedAllowTools: string[]
  minValueLength: number
  claudeCode: { blockCommands: string[] }
}

type Options = Record<string, unknown>

export const DEFAULT_CONFIG_PATH = join(homedir(), '.config', 'motus', 'config.toml')
export const DEFAULT_PREFIXES = ['sk-ant-', 'ghp_', 'github_pat_', 'AKIA', 'xox[bp]-']

export const DEFAULT_TIMEOUT_MS = 10_000
export const DEFAULT_MIN_VALUE_LENGTH = 8
const DEFAULT_PA_DIR = '~/.local/share/pa'
const TILDE = /^~(?=\/|$)/
const TOP_LEVEL_KEYS = [
  'sources',
  'prefixes',
  'blockPaths',
  'blockCommands',
  'degradedAllowTools',
  'minValueLength',
  'claudeCode',
]
const COMMON_SOURCE_KEYS = ['type', 'id', 'required', 'timeoutMs']
const ADAPTERS: Record<
  string,
  {
    keys: string[]
    create(id: string, options: Options, at: string, env: NodeJS.ProcessEnv, minValueLength: number): SecretSource
  }
> = {
  env: { keys: [], create: (id, _options, _at, env) => envSource(env, id) },
  command: {
    keys: ['command'],
    create: (id, { command }, at) => {
      if (typeof command !== 'string' || command === '') throw new Error(`${at}.command must be a non-empty string`)
      return commandSource(id, command)
    },
  },
  mise: {
    keys: ['listFile'],
    create: (id, { listFile }, at, env) => {
      if (typeof listFile !== 'string' || listFile === '') throw new Error(`${at}.listFile must be a non-empty string`)
      return miseSource(id, listFile, env)
    },
  },
  '1password': {
    keys: ['refs', 'fromEnv'],
    create: (id, { refs = {}, fromEnv = false }, at, env) => {
      const refMap = asObject(refs, `${at}.refs`)
      for (const [name, ref] of Object.entries(refMap)) {
        if (!isSecretName(name)) throw new Error(`${at}.refs key ${JSON.stringify(name)} is not a valid name`)
        if (typeof ref !== 'string' || !isOnePasswordRef(ref))
          throw new Error(`${at}.refs.${name} must be an op:// reference`)
      }
      if (typeof fromEnv !== 'boolean') throw new Error(`${at}.fromEnv must be a boolean`)
      if (Object.keys(refMap).length === 0 && !fromEnv) throw new Error(`${at} needs refs or fromEnv: true`)
      return onePasswordSource(id, refMap as Record<string, string>, fromEnv, env)
    },
  },
  pa: {
    keys: ['dir', 'entries', 'whole'],
    create: (id, { dir, entries, whole }, at, env, minValueLength) => {
      if ((entries === undefined) === (whole === undefined))
        throw new Error(`${at} needs exactly one of entries or whole`)
      if (whole !== undefined && whole !== true) throw new Error(`${at}.whole must be true`)
      const names = entries === undefined ? undefined : asStrings(entries, `${at}.entries`)
      if (names?.length === 0 || names?.includes(''))
        throw new Error(`${at}.entries must be a non-empty array of non-empty strings`)
      if (dir !== undefined && (typeof dir !== 'string' || dir === ''))
        throw new Error(`${at}.dir must be a non-empty string`)
      return paSource(id, {
        dir: resolvePaDir(dir ?? (env['PA_DIR'] || DEFAULT_PA_DIR), at, env),
        minValueLength,
        env,
        ...(names && { entries: names }),
      })
    },
  },
}

function resolvePaDir(dir: string, at: string, env: NodeJS.ProcessEnv): string {
  if (TILDE.test(dir) && !env['HOME']) throw new Error(`${at}.dir needs HOME to expand ~`)
  const expanded = dir.replace(TILDE, env['HOME'] ?? '')
  if (!isAbsolute(expanded)) throw new Error(`${at}.dir is not absolute after expansion`)
  return expanded
}

export function defaultEnvSource(env: NodeJS.ProcessEnv): ConfiguredSource {
  return { source: envSource(env), required: true, timeoutMs: DEFAULT_TIMEOUT_MS }
}

export async function readConfig(path: string, env: NodeJS.ProcessEnv = process.env): Promise<Config> {
  const text = await readFile(path, 'utf8').catch(() => {
    throw new Error(`cannot read ${path}`)
  })
  let raw: unknown
  try {
    raw = parse(text)
  } catch {
    throw new Error(`${path} is not valid TOML`)
  }
  return parseConfig(raw, env)
}

export function parseConfig(raw: unknown, env: NodeJS.ProcessEnv = process.env): Config {
  const config = asObject(raw, 'config')
  rejectUnknownKeys(config, TOP_LEVEL_KEYS, 'config')
  const claudeCode = asObject(config['claudeCode'] ?? {}, 'claudeCode')
  rejectUnknownKeys(claudeCode, ['blockCommands'], 'claudeCode')
  const minValueLength = asPositiveInteger(config['minValueLength'] ?? DEFAULT_MIN_VALUE_LENGTH, 'minValueLength')
  return {
    sources: parseSources(config['sources'] ?? [], env, minValueLength),
    prefixes: asStrings(config['prefixes'] ?? DEFAULT_PREFIXES, 'prefixes'),
    blockPaths: asStrings(config['blockPaths'] ?? [], 'blockPaths'),
    blockCommands: asStrings(config['blockCommands'] ?? [], 'blockCommands'),
    degradedAllowTools: asStrings(config['degradedAllowTools'] ?? [], 'degradedAllowTools'),
    minValueLength,
    claudeCode: { blockCommands: asStrings(claudeCode['blockCommands'] ?? [], 'claudeCode.blockCommands') },
  }
}

function parseSources(raw: unknown, env: NodeJS.ProcessEnv, minValueLength: number): ConfiguredSource[] {
  if (!Array.isArray(raw)) throw new Error('sources must be an array')
  const sources = raw.map((entry, index) => parseSource(entry, `sources[${index}]`, env, minValueLength))
  if (!(raw as Options[]).some(({ type }) => type === 'env')) sources.unshift(defaultEnvSource(env))
  const ids = sources.map(({ source }) => source.id)
  const duplicate = ids.find((id, index) => ids.indexOf(id) !== index)
  if (duplicate !== undefined) throw new Error(`source id "${duplicate}" is used more than once`)
  return sources
}

function parseSource(raw: unknown, at: string, env: NodeJS.ProcessEnv, minValueLength: number): ConfiguredSource {
  const options = asObject(raw, at)
  const { type, id = type, required = true, timeoutMs = DEFAULT_TIMEOUT_MS } = options
  const adapter = typeof type === 'string' ? ADAPTERS[type] : undefined
  if (!adapter) throw new Error(`${at}.type ${JSON.stringify(type)} is unknown`)
  rejectUnknownKeys(options, [...COMMON_SOURCE_KEYS, ...adapter.keys], at)
  if (typeof id !== 'string' || id === '') throw new Error(`${at}.id must be a non-empty string`)
  if (typeof required !== 'boolean') throw new Error(`${at}.required must be a boolean`)
  return {
    source: adapter.create(id, options, at, env, minValueLength),
    required,
    timeoutMs: asPositiveInteger(timeoutMs, `${at}.timeoutMs`),
  }
}

function asPositiveInteger(raw: unknown, at: string): number {
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1) throw new Error(`${at} must be a positive integer`)
  return raw
}

function asObject(raw: unknown, at: string): Options {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error(`${at} must be an object`)
  return raw as Options
}

function asStrings(raw: unknown, at: string): string[] {
  if (!Array.isArray(raw) || !raw.every((item) => typeof item === 'string'))
    throw new Error(`${at} must be an array of strings`)
  return raw
}

function rejectUnknownKeys(object: Options, allowed: readonly string[], at: string): void {
  const unknown = Object.keys(object).find((key) => !allowed.includes(key))
  if (unknown === undefined) return
  throw new Error(at === 'config' ? `unknown key "${unknown}"` : `${at} has unknown key "${unknown}"`)
}
