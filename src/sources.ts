import { type Config, type ConfiguredSource, defaultEnvSource, readConfig } from './config.ts'

export interface Secret {
  name: string
  value: string
  source: string
}

export interface SecretSource {
  id: string
  appliesTo(ctx: { cwd: string }): Promise<boolean>
  load(ctx: { cwd: string; signal: AbortSignal; warn(message: string): void }): Promise<Secret[]>
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
  const signal = AbortSignal.timeout(timeoutMs)
  const warnings: string[] = []
  const warn = (message: string): void => {
    warnings.push(`${source.id} warning: ${message}`)
  }
  try {
    const secrets = await Promise.race([source.load({ cwd, signal, warn }), rejectOnAbort(signal)])
    return { id: source.id, secrets, warnings }
  } catch (error) {
    const reason = signal.aborted ? `timed out after ${timeoutMs} ms` : reasonOf(error)
    const applies = await Promise
      .race([source.appliesTo({ cwd }), rejectOnAbort(AbortSignal.timeout(timeoutMs))])
      .catch(() => true)
    const failure = { id: source.id, required, applies, reason }
    if (error instanceof PartialLoadError) return { id: source.id, secrets: error.secrets, failure, warnings }
    return { id: source.id, failure, warnings }
  }
}

function rejectOnAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
