import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, test } from 'node:test'

import { runHook } from '../src/cc-hook.ts'

const BIN = join(import.meta.dirname, '../bin/motus-cc-hook.js')

const home = realpathSync(mkdtempSync(join(tmpdir(), 'motus-cc-')))
after(() => rmSync(home, { recursive: true }))
mkdirSync(join(home, '.config/motus'), { recursive: true })
mkdirSync(join(home, '.config/mise'), { recursive: true })
const configPath = join(home, '.config/motus/config.json')
writeFileSync(
  configPath,
  JSON.stringify({
    blockPaths: ['~/.config/mise/age.txt'],
    blockCommands: ['pa', 'gh auth token'],
    claudeCode: { blockCommands: ['env', 'printenv', 'mise env', 'cat .env*'] },
  }),
)
const env = { HOME: home }

function toolUse(tool_name: string, tool_input: Record<string, unknown>): string {
  return JSON.stringify({ hook_event_name: 'PreToolUse', cwd: home, tool_name, tool_input })
}

function denyReason(output: string): string | undefined {
  if (output === '') return undefined
  const { hookSpecificOutput } = JSON.parse(output)
  assert.equal(hookSpecificOutput.hookEventName, 'PreToolUse')
  assert.equal(hookSpecificOutput.permissionDecision, 'deny')
  return hookSpecificOutput.permissionDecisionReason
}

describe('runHook', () => {
  const denied: Array<[string, Record<string, unknown>]> = [
    ['Bash', { command: 'env' }],
    ['Bash', { command: 'printenv GITHUB_TOKEN' }],
    ['Bash', { command: 'mise env' }],
    ['Bash', { command: 'cd x && mise env --json' }],
    ['Bash', { command: 'cat .env.local' }],
    ['Bash', { command: 'pa show x' }],
    ['Bash', { command: 'echo $(pa s x)' }],
    ['Bash', { command: "bash -c 'gh auth token'" }],
    ['Bash', { command: 'cat ~/.config/mise/age.txt' }],
    ['Bash', { command: 'cat $HOME/.config/mise/age.txt' }],
    ['Read', { file_path: join(home, '.config/mise/age.txt') }],
    ['Read', { file_path: '.config/mise/age.txt' }],
  ]
  for (const [tool, input] of denied) {
    test(`denies ${tool} ${JSON.stringify(input)}`, async () => {
      assert.ok(denyReason(await runHook(toolUse(tool, input), configPath, env)))
    })
  }

  const allowed: Array<[string, Record<string, unknown>]> = [
    ['Bash', { command: 'npm run paint' }],
    ['Bash', { command: 'mise run env-check' }],
    ['Bash', { command: 'cat ~/.config/mise/config.toml' }],
    ['Read', { file_path: join(home, '.config/mise/config.toml') }],
    ['Grep', { pattern: 'x' }],
    ['Edit', { file_path: join(home, 'a.ts'), old_string: 'env', new_string: 'printenv' }],
  ]
  for (const [tool, input] of allowed) {
    test(`allows ${tool} ${JSON.stringify(input)}`, async () => {
      assert.equal(await runHook(toolUse(tool, input), configPath, env), '')
    })
  }

  test('reason names the entry', async () => {
    assert.match(
      denyReason(await runHook(toolUse('Bash', { command: 'mise env' }), configPath, env)) ?? '',
      /"mise env"/,
    )
  })

  test('denies on invalid config', async () => {
    const invalid = join(home, 'invalid.json')
    writeFileSync(invalid, JSON.stringify({ blockCommands: 'pa' }))
    assert.match(denyReason(await runHook(toolUse('Bash', { command: 'ls' }), invalid, env)) ?? '', /blockCommands/)
  })

  test('denies on a missing config', async () => {
    assert.match(
      denyReason(await runHook(toolUse('Bash', { command: 'ls' }), join(home, 'nope.json'), env)) ?? '',
      /cannot read/,
    )
  })

  test('denies on an unresolvable blockPaths entry', async () => {
    const unset = join(home, 'unset.json')
    writeFileSync(unset, JSON.stringify({ blockPaths: ['$NOPE/x'] }))
    assert.match(denyReason(await runHook(toolUse('Read', { file_path: '/x' }), unset, env)) ?? '', /\$NOPE/)
  })

  for (const input of ['not json', toolUse('Bash', {}), toolUse('Read', { file_path: 1 })]) {
    test(`denies malformed input ${input}`, async () => {
      assert.ok(denyReason(await runHook(input, configPath, env)))
    })
  }
})

describe('motus-cc-hook bin', () => {
  const run = (input: string) => spawnSync(process.execPath, [BIN], { input, env: { HOME: home }, encoding: 'utf8' })

  test('denies a blocked command', () => {
    const { status, stdout } = run(toolUse('Bash', { command: 'env' }))
    assert.equal(status, 0)
    assert.match(denyReason(stdout) ?? '', /"env"/)
  })

  test('allows with empty output', () => {
    const { status, stdout } = run(toolUse('Bash', { command: 'ls' }))
    assert.equal(status, 0)
    assert.equal(stdout, '')
  })
})
