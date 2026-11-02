import { setTimeout as delay } from 'node:timers/promises'

import { type Config, type ConfiguredSource, defaultEnvSource, readConfig } from './config.ts'

const ABORT_GRACE_MS = 1000

export interface Secret {
  name: string
  value: string
  source: string
}

export interface SecretSource {
  id: string
  appliesTo(ctx: { cwd: string }): Promise<boolean>
  load(ctx: { cwd: string; signal: AbortSignal; warn(message: string): void; progress(): void }): Promise<Secret[]>
}

export class PartialLoadError extends Error {
  readonly secrets: Secret[]

  constructor(message: string, secrets: Secret[]) {
    super(message)
    this.secrets = secrets
  }
}

export interface SourceFailure {
  id: string
  required: boolean
  applies: boolean
  reason: string
}

export interface LoadResult {
  secrets: Secret[]
  loaded: { id: string; count: number }[]
  failures: SourceFailure[]
  warnings: string[]
}

export async function loadSources(sources: readonly ConfiguredSource[], cwd: string): Promise<LoadResult> {
  const outcomes = await Promise.all(sources.map((configured) => loadOne(configured, cwd)))
  const result: LoadResult = { secrets: [], loaded: [], failures: [], warnings: [] }
  for (const { id, secrets, failure, warnings } of outcomes) {
    result.warnings.push(...warnings)
    if (failure) result.failures.push(failure)
    if (!secrets) continue
    result.secrets.push(...secrets)
    result.loaded.push({ id, count: secrets.length })
  }
  return result
}

export async function loadFromConfig(
  path: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<{ config: Config | undefined; result: LoadResult }> {
  try {
    const config = await readConfig(path, env)
    return { config, result: await loadSources(config.sources, cwd) }
  } catch (error) {
    const result = await loadSources([defaultEnvSource(env)], cwd)
    result.failures.unshift({ id: 'config', required: true, applies: true, reason: reasonOf(error) })
    return { config: undefined, result }
  }
}

export function describeLoad({ secrets, loaded, failures, warnings }: LoadResult): string {
  const counts = loaded.map(({ id, count }) => `${id} (${count})`).join(', ')
  const lines = [`motus: ${secrets.length} secret${secrets.length === 1 ? '' : 's'} from ${counts || 'no sources'}`]
  for (const { id, required, applies, reason } of failures) {
    const scope = !required ? 'optional' : applies ? 'required, applies here' : 'required, not used here'
    lines.push(`${id} failed: ${reason} (${scope})`)
  }
  lines.push(...warnings)
  return lines.join('\n')
}

async function loadOne(
  { source, required, timeoutMs }: ConfiguredSource,
  cwd: string,
): Promise<{ id: string; secrets?: Secret[]; failure?: SourceFailure; warnings: string[] }> {
  const timeout = `timed out after ${timeoutMs} ms`
  const controller = new AbortController()
  const { signal } = controller
  let timer: NodeJS.Timeout | undefined
  const progress = (): void => {
    if (signal.aborted) return
    clearTimeout(timer)
    timer = setTimeout(() => controller.abort(new DOMException(timeout, 'TimeoutError')), timeoutMs)
  }
  progress()
  const warnings: string[] = []
  const warn = (message: string): void => {
    warnings.push(`${source.id} warning: ${message}`)
  }
  const settled = source.load({ cwd, signal, warn, progress }).then(
    (secrets): Settled => ({ secrets }),
    (error: unknown): Settled => ({ error }),
  )
  const aborted = rejectOnAbort(signal).catch(() => undefined)
  const first = await Promise.race([settled, aborted])
  clearTimeout(timer)
  const outcome = first ?? (await settleWithin(settled, ABORT_GRACE_MS))
  if (outcome && 'secrets' in outcome) return { id: source.id, secrets: outcome.secrets, warnings }
  const error = outcome?.error
  if (error instanceof PartialLoadError) {
    const reason = signal.aborted ? `${timeout}: ${error.message}` : error.message
    return {
      id: source.id,
      secrets: error.secrets,
      failure: { id: source.id, required, applies: true, reason },
      warnings,
    }
  }
  const reason = signal.aborted ? timeout : reasonOf(error)
  const applies = await Promise
    .race([source.appliesTo({ cwd }), rejectOnAbort(AbortSignal.timeout(timeoutMs))])
    .catch(() => true)
  return { id: source.id, failure: { id: source.id, required, applies, reason }, warnings }
}

async function settleWithin<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  const timer = new AbortController()
  const expired = delay(ms, undefined, { signal: timer.signal, ref: false }).catch(() => undefined)
  try {
    return await Promise.race([promise, expired])
  } finally {
    timer.abort()
  }
}

type Settled = { secrets: Secret[] } | { error: unknown }

function rejectOnAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
