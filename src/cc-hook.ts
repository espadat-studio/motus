import { text } from 'node:stream/consumers'

import { checkBashPaths, checkCommand, checkPath, resolveBlockPaths } from './blocklist.ts'
import { DEFAULT_CONFIG_PATH, readConfig } from './config.ts'

interface ToolUse {
  cwd: string
  tool_name: string
  tool_input: Record<string, unknown>
}

export async function main(): Promise<void> {
  process.stdout.write(await runHook(await text(process.stdin), DEFAULT_CONFIG_PATH, process.env))
}

export async function runHook(input: string, configPath: string, env: NodeJS.ProcessEnv): Promise<string> {
  try {
    const reason = await checkToolUse(JSON.parse(input), configPath, env)
    return reason === undefined ? '' : deny(reason)
  } catch (error) {
    return deny(`failing closed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function checkToolUse(
  { cwd, tool_name, tool_input }: ToolUse,
  configPath: string,
  env: NodeJS.ProcessEnv,
): Promise<string | undefined> {
  const home = env['HOME']
  if (home === undefined) throw new Error('HOME is not set')
  const config = await readConfig(configPath, env)
  const blockPaths = resolveBlockPaths(config.blockPaths, env)
  if (tool_name === 'Bash') {
    const command = asString(tool_input['command'], 'command')
    return checkCommand(command, [...config.blockCommands, ...config.claudeCode.blockCommands])
      ?? checkBashPaths(command, blockPaths, home)
  }
  if (tool_name === 'Read') return checkPath(asString(tool_input['file_path'], 'file_path'), cwd, blockPaths, home)
  return undefined
}

function asString(value: unknown, at: string): string {
  if (typeof value !== 'string') throw new Error(`tool_input.${at} must be a string`)
  return value
}

function deny(reason: string): string {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: `motus: ${reason}`,
    },
  })
}
