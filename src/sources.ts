import { type Config, type ConfiguredSource, defaultEnvSource, readConfig } from './config.ts'

export interface Secret {
  name: string
  value: string
  source: string
}

export interface SecretSource {
  id: string
  appliesTo(ctx: { cwd: string }): Promise<boolean>
  load(ctx: { cwd: string; signal: AbortSignal }): Promise<Secret[]>
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
}

export async function loadSources(sources: readonly ConfiguredSource[], cwd: string): Promise<LoadResult> {
  const outcomes = await Promise.all(sources.map((configured) => loadOne(configured, cwd)))
  const result: LoadResult = { secrets: [], loaded: [], failures: [] }
  for (const outcome of outcomes) {
    if ('failure' in outcome) {
      result.failures.push(outcome.failure)
      continue
    }
    result.secrets.push(...outcome.secrets)
    result.loaded.push({ id: outcome.id, count: outcome.secrets.length })
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

export function describeLoad({ secrets, loaded, failures }: LoadResult): string {
  const counts = loaded.map(({ id, count }) => `${id} (${count})`).join(', ')
  const lines = [`motus: ${secrets.length} secret${secrets.length === 1 ? '' : 's'} from ${counts || 'no sources'}`]
  for (const { id, required, applies, reason } of failures) {
    const scope = !required ? 'optional' : applies ? 'required, applies here' : 'required, not used here'
    lines.push(`${id} failed: ${reason} (${scope})`)
  }
  return lines.join('\n')
}

async function loadOne(
  { source, required, timeoutMs }: ConfiguredSource,
  cwd: string,
): Promise<{ id: string; secrets: Secret[] } | { failure: SourceFailure }> {
  const signal = AbortSignal.timeout(timeoutMs)
  try {
    const secrets = await Promise.race([source.load({ cwd, signal }), rejectOnAbort(signal)])
    return { id: source.id, secrets }
  } catch (error) {
    const reason = signal.aborted ? `timed out after ${timeoutMs} ms` : reasonOf(error)
    const applies = await Promise
      .race([source.appliesTo({ cwd }), rejectOnAbort(AbortSignal.timeout(timeoutMs))])
      .catch(() => true)
    return { failure: { id: source.id, required, applies, reason } }
  }
}

function rejectOnAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
