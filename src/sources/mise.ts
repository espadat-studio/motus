import { execFile } from 'node:child_process'
import { readdir, readFile, realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'

import { PartialLoadError, type Secret, type SecretSource } from '../sources.ts'

const run = promisify(execFile)
// ponytail: line regex, not a TOML parser; misses age keys in multi-line tables or dotted `env.KEY` form
const AGE_KEY = /^\s*["']?([A-Za-z_]\w*)["']?\s*=\s*\{\s*age\s*=/gm
const ENV_FILE = /^\.?(?:mise|config)\.([\w-]+)(?:\.local)?\.toml$/
const CANDIDATES: [string, RegExp][] = [
  ['', /^\.?mise(\.[\w-]+)*\.toml$/],
  ['.config', /^mise(\.[\w-]+)*\.toml$/],
  ['.mise', /^config(\.[\w-]+)*\.toml$/],
  ['mise', /^config(\.[\w-]+)*\.toml$/],
  ['.config/mise', /^config(\.[\w-]+)*\.toml$/],
]
const BAD_OUTPUT = 'mise env output is not a JSON object of strings'

interface AgeFile {
  path: string
  keys: string[]
}

export function miseSource(id: string, listFile: string, env: NodeJS.ProcessEnv): SecretSource {
  return {
    id,
    appliesTo: async ({ cwd }) => (await cwdAgeFiles(cwd, env)).length > 0,
    load: async ({ cwd, signal, warn }) => {
      const listed = await readList(listFile, env)
      const drift = (await cwdAgeFiles(cwd, env)).filter(({ path }) => !listed.includes(path))
      for (const { path, keys } of drift) warn(`${path} has age keys missing from ${listFile}: ${keys.join(', ')}`)
      const files = [...listed, ...drift.map(({ path }) => path)]
      const outcomes = await Promise.allSettled(files.map((path) => loadFile(id, path, env, signal)))
      const realCwd = await realpath(cwd)
      const secrets: Secret[] = []
      const failures: string[] = []
      for (const [index, outcome] of outcomes.entries()) {
        if (outcome.status === 'fulfilled') {
          secrets.push(...outcome.value)
          continue
        }
        const path = files[index] as string
        const message = `${path} failed: ${reasonOf(outcome.reason)}`
        if (covers(projectRoot(path), realCwd)) failures.push(message)
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
): Promise<Secret[]> {
  const keys = ageKeys(
    await readFile(path, 'utf8').catch(() => {
      throw new Error('cannot read file')
    }),
  )
  const miseEnv = ENV_FILE.exec(basename(path))?.[1]
  const { MISE_ENV: _inherited, ...baseEnv } = env
  const childEnv = miseEnv && miseEnv !== 'local' ? { ...baseEnv, MISE_ENV: miseEnv } : baseEnv
  const { stdout } = await run('mise', ['env', '--json', '-C', projectRoot(path)], {
    env: childEnv,
    signal,
    maxBuffer: 16 * 1024 * 1024,
  })
    .catch((error: { code?: unknown }) => {
      throw new Error(
        typeof error.code === 'number' ? `mise env exited with code ${error.code}` : 'mise env failed to run',
      )
    })
  const values = parseOutput(stdout)
  return keys.flatMap((name) => {
    const value = values[name]
    if (value === undefined) throw new Error(`mise env did not output ${name}`)
    return value ? [{ name, value, source: id }] : []
  })
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
        if (keys.length > 0) files.push({ path, keys })
      }
    }
    if (dir === dirname(dir)) return files
  }
}

function ageKeys(toml: string): string[] {
  return [...toml.matchAll(AGE_KEY)].map((match) => match[1] as string)
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
