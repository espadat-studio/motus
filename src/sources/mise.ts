import { execFile } from 'node:child_process'
import { mkdtemp, readdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'

import { parse } from 'smol-toml'

import { PartialLoadError, type Secret, type SecretSource } from '../sources.ts'

const run = promisify(execFile)
const BARE_KEY = /^[\w-]+$/
const ENV_FILE = /^\.?(?:mise|config)\.([\w-]+)(?:\.local)?\.toml$/
const CANDIDATES: [string, RegExp][] = [
  ['', /^\.?mise(\.[\w-]+)*\.toml$/],
  ['.config', /^mise(\.[\w-]+)*\.toml$/],
  ['.mise', /^config(\.[\w-]+)*\.toml$/],
  ['mise', /^config(\.[\w-]+)*\.toml$/],
  ['.config/mise', /^config(\.[\w-]+)*\.toml$/],
]
const TASK_DIRS = ['mise-tasks', '.mise-tasks', 'mise/tasks', '.mise/tasks', '.config/mise/tasks']
const TASK_HEADER = /^#\s*(?:MISE|\[MISE\]) (.*)$/
const TASK_ENV_ENTRY = /^\s*env\s*[.=]/
const BAD_OUTPUT = 'mise env output is not a JSON object of strings'

interface AgeKey {
  name: string
  value: Record<string, unknown>
  table: 'env' | 'task'
}

interface AgeFile {
  path: string
  keys: AgeKey[] | undefined
}

interface TaskFile extends AgeFile {
  root: string
}

interface FileLoad {
  secrets: Secret[]
  errors: string[]
}

export function miseSource(id: string, listFile: string, env: NodeJS.ProcessEnv): SecretSource {
  return {
    id,
    appliesTo: async ({ cwd }) =>
      (await cwdAgeFiles(cwd, env)).length > 0 || (await taskFiles(await ancestors(cwd))).length > 0,
    load: async ({ cwd, signal, warn }) => {
      const listed = await readList(listFile, env)
      const drift = (await cwdAgeFiles(cwd, env)).filter(({ path }) => !listed.includes(path))
      for (const { path, keys } of drift) {
        if (keys === undefined) continue
        warn(`${path} has age keys missing from ${listFile}: ${keys.map(({ name }) => name).join(', ')}`)
      }
      const files = [...listed, ...drift.map(({ path }) => path)]
      const realCwd = await realpath(cwd)
      const tasks = await taskFiles([...new Set([...await ancestors(realCwd), ...files.map(projectRoot)])])
      const { MISE_ENV: _inherited, ...baseEnv } = env
      const loads = [
        ...files.map((path) => ({ path, root: projectRoot(path), load: loadFile(id, path, env, signal) })),
        ...tasks.map(({ path, root, keys }) => ({ path, root, load: loadTaskFile(id, keys, baseEnv, signal) })),
      ]
      const outcomes = await Promise.allSettled(loads.map(({ load }) => load))
      const secrets: Secret[] = []
      const failures: string[] = []
      for (const [index, outcome] of outcomes.entries()) {
        const { path, root } = loads[index] as (typeof loads)[number]
        if (outcome.status === 'fulfilled') secrets.push(...outcome.value.secrets)
        const errors = outcome.status === 'fulfilled' ? outcome.value.errors : [reasonOf(outcome.reason)]
        if (errors.length === 0) continue
        const message = `${path} failed: ${errors.join('; ')}`
        if (covers(root, realCwd)) failures.push(message)
        else warn(message)
      }
      if (failures.length > 0) throw new PartialLoadError(failures.join('; '), secrets)
      return secrets
    },
  }
}

async function readList(listFile: string, env: NodeJS.ProcessEnv): Promise<string[]> {
  const text = await readFile(expandHome(listFile, env), 'utf8').catch(() => {
    throw new Error(`cannot read ${listFile}`)
  })
  const paths = text.split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('#'))
  return Promise.all(paths.map((line) => {
    const path = expandHome(line, env)
    if (!isAbsolute(path)) throw new Error(`${listFile} entry "${line}" is not absolute`)
    return realpath(path).catch(() => resolve(path))
  }))
}

async function loadFile(
  id: string,
  path: string,
  env: NodeJS.ProcessEnv,
  signal: AbortSignal,
): Promise<FileLoad> {
  const keys = ageKeys(
    await readFile(path, 'utf8').catch(() => {
      throw new Error('cannot read file')
    }),
  )
  if (keys === undefined) throw new Error('not valid TOML')
  const miseEnv = ENV_FILE.exec(basename(path))?.[1]
  const { MISE_ENV: _inherited, ...baseEnv } = env
  const childEnv = miseEnv && miseEnv !== 'local' ? { ...baseEnv, MISE_ENV: miseEnv } : baseEnv
  const envKeys = keys.filter(({ table }) => table === 'env')
  const taskKeys = keys.filter(({ table }) => table === 'task')
  const [fromEnv, fromTasks] = await Promise.all([
    loadEnvKeys(id, envKeys, projectRoot(path), childEnv, signal).then(
      (secrets) => ({ secrets, errors: [] }),
      (error: unknown) => ({ secrets: [], errors: [reasonOf(error)] }),
    ),
    loadTaskKeys(id, taskKeys, childEnv, signal),
  ])
  return {
    secrets: [...fromEnv.secrets, ...fromTasks.secrets],
    errors: [...fromEnv.errors, ...fromTasks.errors],
  }
}

async function loadTaskFile(
  id: string,
  keys: AgeKey[] | undefined,
  env: NodeJS.ProcessEnv,
  signal: AbortSignal,
): Promise<FileLoad> {
  if (keys === undefined) throw new Error('#MISE env header is not valid TOML')
  return loadTaskKeys(id, keys, env, signal)
}

async function loadEnvKeys(
  id: string,
  keys: AgeKey[],
  root: string,
  env: NodeJS.ProcessEnv,
  signal: AbortSignal,
): Promise<Secret[]> {
  if (keys.length === 0) return []
  const values = await miseEnvJson(root, env, signal)
  return keys.flatMap(({ name }) => {
    const value = values[name]
    if (value === undefined) throw new Error(`mise env did not output ${name}`)
    return value ? [{ name, value, source: id }] : []
  })
}

async function loadTaskKeys(
  id: string,
  keys: AgeKey[],
  env: NodeJS.ProcessEnv,
  signal: AbortSignal,
): Promise<FileLoad> {
  if (keys.length === 0) return { secrets: [], errors: [] }
  const aliases = keys.map((_, index) => `MOTUS_TASK_ENV_${index}`)
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'motus-mise-')))
  try {
    const lines = keys.map(({ value }, index) => `${aliases[index]} = ${inlineToml(value)}\n`)
    await writeFile(join(dir, 'mise.toml'), `[env]\n${lines.join('')}`)
    const values = await miseEnvJson(dir, { ...env, MISE_TRUSTED_CONFIG_PATHS: dir }, signal)
    const secrets: Secret[] = []
    const missing: string[] = []
    for (const [index, { name }] of keys.entries()) {
      const value = values[aliases[index] as string]
      if (value === undefined) missing.push(name)
      else if (value) secrets.push({ name, value, source: id })
    }
    const errors = missing.length > 0 ? [taskError(missing, 'mise env did not output them')] : []
    return { secrets, errors }
  } catch (error) {
    return { secrets: [], errors: [taskError(keys.map(({ name }) => name), reasonOf(error))] }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

function taskError(names: string[], reason: string): string {
  return `cannot decrypt task env keys ${names.join(', ')}: ${reason}`
}

async function miseEnvJson(dir: string, env: NodeJS.ProcessEnv, signal: AbortSignal): Promise<Record<string, string>> {
  const { stdout } = await run('mise', ['env', '--json', '-C', dir], {
    env,
    signal,
    maxBuffer: 16 * 1024 * 1024,
  })
    .catch((error: { code?: unknown }) => {
      throw new Error(
        typeof error.code === 'number' ? `mise env exited with code ${error.code}` : 'mise env failed to run',
      )
    })
  return parseOutput(stdout)
}

function parseOutput(stdout: string): Record<string, string> {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    throw new Error(BAD_OUTPUT)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error(BAD_OUTPUT)
  if (!Object.values(parsed).every((value) => typeof value === 'string')) throw new Error(BAD_OUTPUT)
  return parsed as Record<string, string>
}

async function cwdAgeFiles(cwd: string, env: NodeJS.ProcessEnv): Promise<AgeFile[]> {
  const activeEnvs = (env['MISE_ENV'] ?? '').split(',')
  const isActive = (name: string): boolean => {
    const miseEnv = ENV_FILE.exec(name)?.[1]
    return !miseEnv || miseEnv === 'local' || activeEnvs.includes(miseEnv)
  }
  const files: AgeFile[] = []
  for (let dir = await realpath(cwd);; dir = dirname(dir)) {
    for (const [sub, pattern] of CANDIDATES) {
      const names = await readdir(join(dir, sub)).catch((error: { code?: unknown }) => {
        if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return []
        throw error
      })
      for (const name of names.filter((name) => pattern.test(name) && isActive(name)).sort()) {
        const path = join(dir, sub, name)
        const keys = ageKeys(await readFile(path, 'utf8'))
        if (keys === undefined || keys.length > 0) files.push({ path, keys })
      }
    }
    if (dir === dirname(dir)) return files
  }
}

async function ancestors(cwd: string): Promise<string[]> {
  const dirs: string[] = []
  for (let dir = await realpath(cwd);; dir = dirname(dir)) {
    dirs.push(dir)
    if (dir === dirname(dir)) return dirs
  }
}

async function taskFiles(roots: string[]): Promise<TaskFile[]> {
  const files: TaskFile[] = []
  for (const root of roots) {
    for (const dir of TASK_DIRS) {
      for (const path of await taskScripts(join(root, dir))) {
        const keys = headerAgeKeys(await readFile(path, 'utf8'))
        if (keys === undefined || keys.length > 0) files.push({ path, root, keys })
      }
    }
  }
  return files
}

async function taskScripts(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch((error: { code?: unknown }) => {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return []
    throw error
  })
  const scripts: string[] = []
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith('.')) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) scripts.push(...await taskScripts(path))
    else if (entry.isFile() || (entry.isSymbolicLink() && (await stat(path).catch(() => undefined))?.isFile()))
      scripts.push(path)
  }
  return scripts
}

function headerAgeKeys(script: string): AgeKey[] | undefined {
  const entries = script.split('\n').flatMap((line) => {
    const content = TASK_HEADER.exec(line)?.[1]
    return content !== undefined && TASK_ENV_ENTRY.test(content) ? [content] : []
  })
  try {
    return entries.flatMap((entry) => envAgeKeys(parse(entry)['env'], 'task'))
  } catch {
    return undefined
  }
}

function ageKeys(toml: string): AgeKey[] | undefined {
  let config: Record<string, unknown>
  try {
    config = parse(toml)
  } catch {
    return undefined
  }
  const tasks = isTable(config['tasks']) ? Object.values(config['tasks']) : []
  return [
    ...envAgeKeys(config['env'], 'env'),
    ...tasks.flatMap((task) => (isTable(task) ? envAgeKeys(task['env'], 'task') : [])),
  ]
}

function envAgeKeys(env: unknown, table: AgeKey['table']): AgeKey[] {
  const tables = Array.isArray(env) ? env : [env]
  return tables.filter(isTable).flatMap((entries) =>
    Object.entries(entries).flatMap(([name, value]) => isTable(value) && 'age' in value ? [{ name, value, table }] : [])
  )
}

function isTable(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date)
}

function inlineToml(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(inlineToml).join(', ')}]`
  if (!isTable(value)) return typeof value === 'string' ? JSON.stringify(value) : String(value)
  const entries = Object.entries(value).map(([key, item]) =>
    `${BARE_KEY.test(key) ? key : JSON.stringify(key)} = ${inlineToml(item)}`
  )
  return `{ ${entries.join(', ')} }`
}

function projectRoot(path: string): string {
  const dir = basename(path).startsWith('config') ? dirname(dirname(path)) : dirname(path)
  return basename(dir) === '.config' ? dirname(dir) : dir
}

function covers(root: string, cwd: string): boolean {
  const path = relative(root, cwd)
  return !path.startsWith('..') && !isAbsolute(path)
}

function expandHome(path: string, env: NodeJS.ProcessEnv): string {
  if (!/^~(?=\/|$)/.test(path)) return path
  const home = env['HOME']
  if (home === undefined) throw new Error('HOME is not set')
  return home + path.slice(1)
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
