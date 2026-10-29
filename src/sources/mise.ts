import { execFile } from 'node:child_process'
import { readdir, readFile } from 'node:fs/promises'
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
    appliesTo: async ({ cwd }) => (await cwdAgeFiles(cwd)).length > 0,
    load: async ({ cwd, signal, warn }) => {
      const listed = await readList(listFile, env)
      const drift = (await cwdAgeFiles(cwd)).filter(({ path }) => !listed.includes(path))
      for (const { path, keys } of drift) warn(`${path} has age keys missing from ${listFile}: ${keys.join(', ')}`)
      const files = [...listed, ...drift.map(({ path }) => path)]
      const outcomes = await Promise.all(files.map((path) => loadFile(id, path, env, signal)))
      const secrets: Secret[] = []
      const failures: string[] = []
      for (const [index, outcome] of outcomes.entries()) {
        const path = files[index] as string
        if (Array.isArray(outcome)) secrets.push(...outcome)
        else if (covers(projectRoot(path), cwd)) failures.push(`${path} failed: ${outcome.message}`)
        else warn(`${path} failed: ${outcome.message}`)
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
  return paths.map((line) => {
    const path = expandHome(line, env)
    if (!isAbsolute(path)) throw new Error(`${listFile} entry "${line}" is not absolute`)
    return resolve(path)
  })
}

async function loadFile(
  id: string,
  path: string,
  env: NodeJS.ProcessEnv,
  signal: AbortSignal,
): Promise<Secret[] | Error> {
  try {
    const keys = ageKeys(
      await readFile(path, 'utf8').catch(() => {
        throw new Error('cannot read file')
      }),
    )
    const miseEnv = ENV_FILE.exec(basename(path))?.[1]
    const childEnv = miseEnv && miseEnv !== 'local' ? { ...env, MISE_ENV: miseEnv } : env
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
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error))
  }
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

async function cwdAgeFiles(cwd: string): Promise<AgeFile[]> {
  const files: AgeFile[] = []
  for (let dir = resolve(cwd);; dir = dirname(dir)) {
    for (const [sub, pattern] of CANDIDATES) {
      const names = await readdir(join(dir, sub)).catch(() => [])
      for (const name of names.filter((name) => pattern.test(name)).sort()) {
        const path = join(dir, sub, name)
        const keys = ageKeys(await readFile(path, 'utf8').catch(() => ''))
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
  const path = relative(root, resolve(cwd))
  return !path.startsWith('..') && !isAbsolute(path)
}

function expandHome(path: string, env: NodeJS.ProcessEnv): string {
  if (!/^~(?=\/|$)/.test(path)) return path
  const home = env['HOME']
  if (home === undefined) throw new Error('HOME is not set')
  return home + path.slice(1)
}
