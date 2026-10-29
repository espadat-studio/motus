import { homedir } from 'node:os'

import {
  createLocalBashOperations,
  type ExtensionAPI,
  type ExtensionContext,
  isToolCallEventType,
  type ToolCallEvent,
} from '@earendil-works/pi-coding-agent'

import { checkBashPaths, checkCommand, checkPath, checkPlaceholders, resolveBlockPaths } from '../src/blocklist.ts'
import { type Config, DEFAULT_CONFIG_PATH, DEFAULT_PREFIXES } from '../src/config.ts'
import { createMatcher, type Matcher } from '../src/matcher.ts'
import { describeLoad, loadFromConfig } from '../src/sources.ts'

const REDACTION_FAILED = '[motus: redaction failed, output withheld]'
const PLACEHOLDER_TOOLS = new Set(['write', 'edit', 'bash'])
const MAX_PATH_LENGTH = 4096

interface State {
  config: Config | undefined
  matcher: Matcher
  blockPaths: string[]
  loadedNames: Set<string>
  degraded: string | undefined
  continued: boolean
  report: string
  level: 'info' | 'warning' | 'error'
}

export function createMotus({ configPath, env }: { configPath: string; env: NodeJS.ProcessEnv }) {
  const home = env['HOME'] ?? homedir()

  return function motus(pi: ExtensionAPI): void {
    let state: State = {
      config: undefined,
      matcher: createMatcher([], { prefixes: DEFAULT_PREFIXES, minValueLength: 8 }),
      blockPaths: [],
      loadedNames: new Set(),
      degraded: 'secrets are not loaded yet',
      continued: false,
      report: 'motus: not loaded',
      level: 'error',
    }

    const checkShell = (command: string): string | undefined =>
      (state.degraded && `session is degraded (${state.degraded})`)
      || checkCommand(command, state.config?.blockCommands ?? [])
      || checkBashPaths(command, state.blockPaths, home)

    const checkToolCall = (event: ToolCallEvent, cwd: string): string | undefined => {
      const allowed = state.config?.degradedAllowTools ?? []
      if (state.degraded && !allowed.includes(event.toolName))
        return `session is degraded (${state.degraded}); every tool except [${allowed.join(', ')}] is blocked`
      if (PLACEHOLDER_TOOLS.has(event.toolName)) {
        const reason = checkPlaceholders(JSON.stringify(event.input), state.loadedNames)
        if (reason) return reason
      }
      if (isToolCallEventType('bash', event)) return checkShell(event.input.command)
      for (const text of listStrings(event.input)) {
        if (text.length > MAX_PATH_LENGTH || text.includes('\n')) continue
        const reason = checkPath(text, cwd, state.blockPaths, home)
        if (reason) return reason
      }
      return undefined
    }

    pi.on('session_start', async (_event, ctx) => {
      state = await loadState(configPath, ctx.cwd, env)
      ctx.ui.notify(describeState(state), state.level)
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
        return { content: [{ type: 'text' as const, text: REDACTION_FAILED }], details: null, isError: true }
      }
    })

    pi.on('message_end', (event) => ({ message: state.matcher.redact(event.message) }))

    pi.on('input', (event) => {
      const text = state.matcher.redact(event.text)
      return text === event.text ? { action: 'continue' } : { action: 'transform', text }
    })

    pi.on('user_bash', async (event, ctx) => {
      const reason = checkShell(event.command)
      if (reason) return { result: bashResult(`motus: blocked: ${reason}`, 1) }
      try {
        return { result: await runRedacted(event.command, event.cwd, state.matcher, ctx) }
      } catch {
        return { result: bashResult(REDACTION_FAILED, 1) }
      }
    })

    pi.on('before_provider_request', (event) => {
      try {
        return state.matcher.redact(event.payload)
      } catch {
        return {}
      }
    })

    pi.registerCommand('motus', {
      description: 'motus status | continue',
      handler: async (args, ctx) => {
        const subcommand = args.trim()
        if (subcommand === 'status' || subcommand === '') return ctx.ui.notify(describeState(state), 'info')
        if (subcommand !== 'continue')
          return ctx.ui.notify(`motus: unknown subcommand "${subcommand}"; use status or continue`, 'error')
        if (!state.degraded) return ctx.ui.notify('motus: session is not degraded', 'info')
        state = { ...state, degraded: undefined, continued: true }
        ctx.ui.notify('motus: partial protection accepted for this session; blocks still apply', 'warning')
      },
    })
  }
}

export default createMotus({ configPath: DEFAULT_CONFIG_PATH, env: process.env })

async function loadState(configPath: string, cwd: string, env: NodeJS.ProcessEnv): Promise<State> {
  const { config, result } = await loadFromConfig(configPath, cwd, env)
  let blockPaths: string[] = []
  try {
    blockPaths = resolveBlockPaths(config?.blockPaths ?? [], env)
  } catch (error) {
    result.failures.push({ id: 'config', required: true, applies: true, reason: (error as Error).message })
  }
  const matcher = createMatcher(result.secrets, {
    prefixes: config?.prefixes ?? DEFAULT_PREFIXES,
    minValueLength: config?.minValueLength ?? 8,
  })
  const failed = result.failures.filter(({ required, applies }) => required && applies).map(({ id }) => id)
  return {
    config,
    matcher,
    blockPaths,
    loadedNames: new Set(result.secrets.map(({ name }) => name)),
    degraded: failed.length > 0 ? `required source failed: ${failed.join(', ')}` : undefined,
    continued: false,
    report: [describeLoad(result), ...matcher.warnings].join('\n'),
    level: failed.length > 0 ? 'error' : result.failures.length + matcher.warnings.length > 0 ? 'warning' : 'info',
  }
}

function describeState({ report, degraded, continued }: State): string {
  const mode = degraded
    ? `degraded: ${degraded}. /motus continue accepts partial protection`
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
  return bashResult(matcher.redact(Buffer.concat(chunks).toString('utf8')), exitCode ?? undefined)
}

function bashResult(output: string, exitCode: number | undefined) {
  return { output, exitCode, cancelled: false, truncated: false }
}

function listStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (value !== null && typeof value === 'object') return Object.values(value).flatMap(listStrings)
  return []
}
