import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type { SecretSource } from './sources.ts'
import { commandSource } from './sources/command.ts'
import { envSource } from './sources/env.ts'

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

export const DEFAULT_CONFIG_PATH = join(homedir(), '.config', 'motus', 'config.json')
export const DEFAULT_PREFIXES = ['sk-ant-', 'ghp_', 'github_pat_', 'AKIA', 'xox[bp]-']

export const DEFAULT_TIMEOUT_MS = 10_000
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
  { keys: string[]; create(id: string, options: Options, at: string, env: NodeJS.ProcessEnv): SecretSource }
> = {
  env: { keys: [], create: (id, _options, _at, env) => envSource(env, id) },
  command: {
    keys: ['command'],
    create: (id, { command }, at) => {
      if (typeof command !== 'string' || command === '') throw new Error(`${at}.command must be a non-empty string`)
      return commandSource(id, command)
    },
  },
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
    raw = JSON.parse(text)
  } catch {
    throw new Error(`${path} is not valid JSON`)
  }
  return parseConfig(raw, env)
}

export function parseConfig(raw: unknown, env: NodeJS.ProcessEnv = process.env): Config {
  const config = asObject(raw, 'config')
  rejectUnknownKeys(config, TOP_LEVEL_KEYS, 'config')
  const claudeCode = asObject(config['claudeCode'] ?? {}, 'claudeCode')
  rejectUnknownKeys(claudeCode, ['blockCommands'], 'claudeCode')
  return {
    sources: parseSources(config['sources'] ?? [], env),
    prefixes: asStrings(config['prefixes'] ?? DEFAULT_PREFIXES, 'prefixes'),
    blockPaths: asStrings(config['blockPaths'] ?? [], 'blockPaths'),
    blockCommands: asStrings(config['blockCommands'] ?? [], 'blockCommands'),
    degradedAllowTools: asStrings(config['degradedAllowTools'] ?? [], 'degradedAllowTools'),
    minValueLength: asPositiveInteger(config['minValueLength'] ?? 8, 'minValueLength'),
    claudeCode: { blockCommands: asStrings(claudeCode['blockCommands'] ?? [], 'claudeCode.blockCommands') },
  }
}

function parseSources(raw: unknown, env: NodeJS.ProcessEnv): ConfiguredSource[] {
  if (!Array.isArray(raw)) throw new Error('sources must be an array')
  const sources = raw.map((entry, index) => parseSource(entry, `sources[${index}]`, env))
  if (!(raw as Options[]).some(({ type }) => type === 'env')) sources.unshift(defaultEnvSource(env))
  const ids = sources.map(({ source }) => source.id)
  const duplicate = ids.find((id, index) => ids.indexOf(id) !== index)
  if (duplicate !== undefined) throw new Error(`source id "${duplicate}" is used more than once`)
  return sources
}

function parseSource(raw: unknown, at: string, env: NodeJS.ProcessEnv): ConfiguredSource {
  const options = asObject(raw, at)
  const { type, id = type, required = true, timeoutMs = DEFAULT_TIMEOUT_MS } = options
  const adapter = typeof type === 'string' ? ADAPTERS[type] : undefined
  if (!adapter) throw new Error(`${at}.type ${JSON.stringify(type)} is unknown`)
  rejectUnknownKeys(options, [...COMMON_SOURCE_KEYS, ...adapter.keys], at)
  if (typeof id !== 'string' || id === '') throw new Error(`${at}.id must be a non-empty string`)
  if (typeof required !== 'boolean') throw new Error(`${at}.required must be a boolean`)
  return {
    source: adapter.create(id, options, at, env),
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
