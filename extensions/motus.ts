import { homedir } from 'node:os'

import {
  createLocalBashOperations,
  type ExtensionAPI,
  type ExtensionContext,
  isToolCallEventType,
  type ToolCallEvent,
  truncateTail,
} from '@earendil-works/pi-coding-agent'

import {
  checkBashPaths,
  checkCommand,
  checkFileUrl,
  checkPath,
  checkPlaceholders,
  checkSearchRoot,
  normalizePiPath,
  resolveBlockPaths,
} from '../src/blocklist.ts'
import { type Config, DEFAULT_CONFIG_PATH, DEFAULT_MIN_VALUE_LENGTH, DEFAULT_PREFIXES } from '../src/config.ts'
import { createMatcher, type Matcher } from '../src/matcher.ts'
import { describeLoad, loadFromConfig, type Secret } from '../src/sources.ts'

const REDACTION_FAILED = '[motus: redaction failed, output withheld]'
const COMMAND_FAILED = '[motus: command failed or its output could not be redacted, output withheld]'
const HELD_VALUE_REFUSAL = 'motus: refused: the command holds a loaded secret value. Reference it by variable name'
const PLACEHOLDER_TOOLS = new Set(['write', 'edit', 'bash'])
const MAX_PATH_LENGTH = 4096

interface State {
  config: Config | undefined
  matcher: Matcher
  blockPaths: string[]
  blocksLoaded: boolean
  secrets: Secret[]
  loadedNames: Set<string>
  degraded: string | undefined
  continued: boolean
  report: string
  level: 'info' | 'warning' | 'error'
}

export function createMotus(
  { configPath, env }: { configPath: string; env: NodeJS.ProcessEnv },
): (pi: ExtensionAPI) => void {
  const home = env['HOME'] ?? homedir()

  return function motus(pi: ExtensionAPI): void {
    let state: State = {
      config: undefined,
      matcher: createMatcher([], { prefixes: DEFAULT_PREFIXES, minValueLength: DEFAULT_MIN_VALUE_LENGTH }),
      blockPaths: [],
      blocksLoaded: false,
      secrets: [],
      loadedNames: new Set(),
      degraded: 'secrets are not loaded yet',
      continued: false,
      report: 'motus: not loaded',
      level: 'error',
    }

    let finishLoad: () => void = () => {}
    const loaded = new Promise<void>((resolve) => {
      finishLoad = resolve
    })
    let reloads = loaded

    const checkShellCommand = (command: string): string | undefined =>
      checkCommand(command, state.config?.blockCommands ?? [])
      || checkBashPaths(command, state.blockPaths, home)

    const checkToolCall = (event: ToolCallEvent, cwd: string): string | undefined => {
      const allowed = state.config?.degradedAllowTools ?? []
      if (state.degraded && !allowed.includes(event.toolName))
        return `session is degraded (${state.degraded}); every tool except [${allowed.join(', ')}] is blocked`
      if (PLACEHOLDER_TOOLS.has(event.toolName)) {
        const reason = checkPlaceholders(
          JSON.stringify(event.input),
          state.loadedNames,
          state.config?.prefixes ?? DEFAULT_PREFIXES,
        )
        if (reason) return reason
      }
      if (isToolCallEventType('bash', event)) return checkShellCommand(event.input.command)
      if (isToolCallEventType('grep', event)) {
        const reason = checkSearchRoot(event.input.path, cwd, state.blockPaths, home)
        if (reason) return reason
      }
      for (const text of collectStrings(event.input)) {
        if (text.length > MAX_PATH_LENGTH || text.includes('\n')) continue
        const reason = checkFileUrl(text, home)
          || checkPath(text, cwd, state.blockPaths, home)
          || checkPath(normalizePiPath(text, home), cwd, state.blockPaths, home)
        if (reason) return reason
      }
      return undefined
    }

    pi.on('session_start', async (_event, ctx) => {
      try {
        state = await loadState(configPath, ctx.cwd, env)
        notifyOperator(ctx, describeState(state), state.level)
      } finally {
        finishLoad()
      }
    })

    pi.on('tool_call', (event, ctx) => {
      const reason = checkToolCall(event, ctx.cwd)
      return reason ? { block: true, reason: `motus: ${reason}` } : undefined
    })

    pi.on('tool_result', (event) => {
      try {
        const { structuredContent } = event
        return {
          content: state.matcher.redact(event.content),
          details: state.matcher.redact(event.details),
          ...(structuredContent !== undefined && { structuredContent: state.matcher.redact(structuredContent) }),
        }
      } catch {
        return { content: [{ type: 'text' as const, text: REDACTION_FAILED }], details: {}, isError: true }
      }
    })

    pi.on('message_end', async (event) => {
      await loaded
      try {
        return { message: state.matcher.redact(event.message) }
      } catch {
        const { details: _details, structuredContent: _structured, errorMessage: _error, ...rest } = event
          .message as Record<string, unknown>
        return { message: { ...rest, content: [{ type: 'text', text: REDACTION_FAILED }] } as typeof event.message }
      }
    })

    pi.on('input', async (event) => {
      await loaded
      const text = state.matcher.redact(event.text)
      return text === event.text ? { action: 'continue' } : { action: 'transform', text }
    })

    pi.on('user_bash', async (event, ctx) => {
      if (state.matcher.redact(event.command) !== event.command) throw new Error(HELD_VALUE_REFUSAL)
      const reason = state.degraded ? `session is degraded (${state.degraded})` : checkShellCommand(event.command)
      if (reason) return { result: bashResult(`motus: blocked: ${reason}`, 1) }
      try {
        return { result: await runRedacted(event.command, event.cwd, state.matcher, ctx) }
      } catch {
        return { result: bashResult(COMMAND_FAILED, 1) }
      }
    })

    pi.on('before_provider_request', async (event) => {
      await loaded
      try {
        return state.matcher.redact(event.payload)
      } catch {
        return {}
      }
    })

    pi.on('session_before_compact', (event, ctx) => {
      try {
        const { customInstructions, preparation } = event
        if (customInstructions && state.matcher.redact(customInstructions) !== customInstructions) {
          notifyOperator(ctx, 'motus: compaction cancelled: the instructions hold a loaded secret value', 'error')
          return { cancel: true }
        }
        preparation.messagesToSummarize = state.matcher.redact(preparation.messagesToSummarize)
        preparation.turnPrefixMessages = state.matcher.redact(preparation.turnPrefixMessages)
        if (preparation.previousSummary !== undefined)
          preparation.previousSummary = state.matcher.redact(preparation.previousSummary)
        return undefined
      } catch {
        return { cancel: true }
      }
    })

    pi.on('session_before_tree', (event) => {
      try {
        const { entriesToSummarize, customInstructions } = event.preparation
        entriesToSummarize.splice(0, entriesToSummarize.length, ...state.matcher.redact([...entriesToSummarize]))
        return customInstructions === undefined
          ? undefined
          : { customInstructions: state.matcher.redact(customInstructions) }
      } catch {
        return { cancel: true }
      }
    })

    pi.registerCommand('motus', {
      description: 'motus status | continue | reload',
      handler: async (args, ctx) => {
        const subcommand = args.trim()
        if (subcommand === 'status' || subcommand === '') return notifyOperator(ctx, describeState(state), 'info')
        if (subcommand === 'reload') {
          const reload = reloads.then(async () => {
            state = await loadState(configPath, ctx.cwd, env, state.secrets)
          })
          reloads = reload.catch(() => undefined)
          await reload
          return notifyOperator(ctx, describeState(state), state.level)
        }
        if (subcommand !== 'continue') {
          return notifyOperator(
            ctx,
            `motus: unknown subcommand "${subcommand}"; use status, continue or reload`,
            'error',
          )
        }
        if (!state.degraded) return notifyOperator(ctx, 'motus: session is not degraded', 'info')
        if (!state.blocksLoaded) {
          return notifyOperator(
            ctx,
            'motus: cannot continue: blocks did not load, so motus cannot enforce them. Fix the config and run /motus reload',
            'error',
          )
        }
        state = { ...state, degraded: undefined, continued: true }
        notifyOperator(ctx, 'motus: partial protection accepted for this session; blocks still apply', 'warning')
      },
    })
  }
}

export default createMotus({ configPath: DEFAULT_CONFIG_PATH, env: process.env })

async function loadState(
  configPath: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  previous: Secret[] = [],
): Promise<State> {
  const { config, result } = await loadFromConfig(configPath, cwd, env)
  const values = new Set(result.secrets.map(({ value }) => value))
  const kept = previous.filter(({ value }) => !values.has(value))
  const secrets = [...result.secrets, ...kept]
  let blockPaths: string[] = []
  let blocksLoaded = config !== undefined
  try {
    blockPaths = resolveBlockPaths(config?.blockPaths ?? [], env)
  } catch (error) {
    blocksLoaded = false
    result.failures.push({ id: 'config', required: true, applies: true, reason: (error as Error).message })
  }
  const matcher = createMatcher(secrets, {
    prefixes: config?.prefixes ?? DEFAULT_PREFIXES,
    minValueLength: config?.minValueLength ?? DEFAULT_MIN_VALUE_LENGTH,
  })
  const failed = result
    .failures
    .filter(({ required, applies }) => required && applies)
    .map(({ id, reason }) => `${id} (${reason})`)
  return {
    config,
    matcher,
    blockPaths,
    blocksLoaded,
    secrets,
    loadedNames: new Set(secrets.map(({ name }) => name)),
    degraded: failed.length > 0 ? `required source failed: ${failed.join(', ')}` : undefined,
    continued: false,
    report: [
      describeLoad(result),
      ...(kept.length > 0
        ? [`still redacting ${kept.length} secret${kept.length === 1 ? '' : 's'} from earlier loads`]
        : []),
      ...matcher.warnings,
    ]
      .join('\n'),
    level: failed.length > 0 ? 'error' : result.failures.length + matcher.warnings.length > 0 ? 'warning' : 'info',
  }
}

function notifyOperator(ctx: ExtensionContext, message: string, level: State['level']): void {
  if (ctx.hasUI) ctx.ui.notify(message, level)
  else process.stderr.write(`${message}\n`)
}

function describeState({ report, degraded, continued, blocksLoaded }: State): string {
  const mode = degraded
    ? `degraded: ${degraded}. ${
      blocksLoaded
        ? '/motus reload retries the sources; /motus continue accepts partial protection'
        : 'fix the config and run /motus reload: /motus continue is refused until blocks load'
    }`
    : continued
    ? 'partial protection accepted for this session'
    : 'active'
  return `${report}\nstatus: ${mode}`
}

async function runRedacted(command: string, cwd: string, matcher: Matcher, ctx: ExtensionContext) {
  const chunks: Buffer[] = []
  const { exitCode } = await createLocalBashOperations().exec(command, cwd, {
    onData: (data) => chunks.push(data),
    ...(ctx.signal && { signal: ctx.signal }),
  })
  const { content, truncated } = truncateTail(matcher.redact(Buffer.concat(chunks).toString('utf8')))
  return bashResult(content, exitCode ?? undefined, truncated)
}

function bashResult(output: string, exitCode: number | undefined, truncated = false) {
  return { output, exitCode, cancelled: false, truncated }
}

function collectStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (value !== null && typeof value === 'object') return Object.values(value).flatMap(collectStrings)
  return []
}
