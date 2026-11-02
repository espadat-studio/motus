import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, test } from 'node:test'

import { type ExtensionAPI, SessionManager } from '@earendil-works/pi-coding-agent'
import { stringify } from 'smol-toml'

import { createMotus } from '../extensions/motus.ts'

const TOKEN = 'fixture-token-value-0001'
const NOT_LOADED = 'missing config'

type Handler = (event: Record<string, unknown>, ctx: unknown) => unknown

const homes: string[] = []
after(() => Promise.all(homes.map((home) => rm(home, { recursive: true, force: true }))))

async function setup(config: unknown = {}, extraEnv: Record<string, string> = {}) {
  const home = await mkdtemp(join(tmpdir(), 'motus-'))
  homes.push(home)
  await mkdir(join(home, 'vault'))
  const configPath = join(home, 'config.toml')
  if (config !== NOT_LOADED) await writeFile(configPath, typeof config === 'string' ? config : stringify(config))
  const handlers = new Map<string, Handler>()
  let command: Handler = () => undefined
  const pi = {
    on: (name: string, handler: Handler) => handlers.set(name, handler),
    registerCommand: (_name: string, { handler }: { handler: (args: string, ctx: unknown) => unknown }) => {
      command = (args, ctx) => handler(args as unknown as string, ctx)
    },
  }
  const notes: { message: string; type: string | undefined }[] = []
  const ctx = {
    cwd: home,
    signal: undefined,
    ui: { notify: (message: string, type?: string) => notes.push({ message, type }) },
  }
  createMotus({ configPath, env: { HOME: home, API_TOKEN: TOKEN, ...extraEnv } })(pi as unknown as ExtensionAPI)
  const emit = (name: string, event: Record<string, unknown> = {}) => {
    const handler = handlers.get(name)
    assert.ok(handler, `no ${name} handler`)
    return handler({ type: name, ...event }, ctx)
  }
  const motus = (args: string) => command(args as never, ctx)
  await emit('session_start', { reason: 'startup' })
  return { home, emit, motus, notes }
}

function cyclic(): Record<string, unknown> {
  const object: Record<string, unknown> = {}
  object['self'] = object
  return object
}

describe('session_start', () => {
  test('notifies counts, never values', async () => {
    const { notes } = await setup()
    assert.equal(notes.length, 1)
    assert.match(notes[0]?.message ?? '', /1 secret from env \(1\)/)
    assert.equal(notes[0]?.type, 'info')
    assert.ok(!notes[0]?.message.includes(TOKEN))
  })

  test('missing config degrades the session', async () => {
    const { notes, emit } = await setup(NOT_LOADED)
    assert.equal(notes[0]?.type, 'error')
    const result = await emit('tool_call', { toolName: 'read', input: { path: 'x' } })
    assert.deepEqual(Object.keys(result as object), ['block', 'reason'])
  })

  test('an unset variable in blockPaths degrades the session', async () => {
    const { emit } = await setup({ blockPaths: ['$MOTUS_UNSET/x'] })
    assert.ok(await emit('tool_call', { toolName: 'ls', input: {} }))
  })

  test('an optional failing source only warns', async () => {
    const { notes, emit } = await setup({ sources: [{ type: 'command', command: 'exit 3', required: false }] })
    assert.equal(notes[0]?.type, 'warning')
    assert.equal(await emit('tool_call', { toolName: 'ls', input: {} }), undefined)
  })
})

describe('degraded state', () => {
  const failing = {
    sources: [{ type: 'command', command: 'exit 3' }],
    degradedAllowTools: ['ls'],
    blockCommands: ['pa'],
  }

  test('blocks every tool except the allowlist', async () => {
    const { emit } = await setup(failing)
    assert.equal((await emit('tool_call', { toolName: 'grep', input: {} }) as { block: boolean }).block, true)
    assert.equal(await emit('tool_call', { toolName: 'ls', input: {} }), undefined)
  })

  test('allowlisting bash lets the tool through but keeps blockCommands', async () => {
    const { emit } = await setup({ ...failing, degradedAllowTools: ['bash'] })
    assert.equal(await emit('tool_call', { toolName: 'bash', input: { command: 'ls' } }), undefined)
    assert.ok(await emit('tool_call', { toolName: 'bash', input: { command: 'pa show x' } }))
  })

  test('blocks user_bash', async () => {
    const { emit, home } = await setup(failing)
    const result = await emit('user_bash', { command: 'touch made', cwd: home, excludeFromContext: false })
    assert.equal((result as { result: { exitCode: number } }).result.exitCode, 1)
    assert.ok(!existsSync(join(home, 'made')))
  })

  test('/motus continue unblocks tools but not blocks', async () => {
    const { emit, motus, notes } = await setup(failing)
    await motus('continue')
    assert.equal(notes.at(-1)?.type, 'warning')
    assert.equal(await emit('tool_call', { toolName: 'grep', input: {} }), undefined)
    assert.ok(await emit('tool_call', { toolName: 'bash', input: { command: 'pa show x' } }))
  })
})

describe('/motus continue when blocks did not load', () => {
  const cases: [string, unknown][] = [
    ['unknown key', { nope: 1 }],
    ['bad source option', { sources: [{ type: 'command', command: 'true', bogus: 1 }] }],
    ['invalid TOML', 'not = [valid'],
    ['unset blockPaths variable', { blockPaths: ['$MOTUS_UNSET/x'], blockCommands: ['pa'] }],
    ['missing config', NOT_LOADED],
  ]

  for (const [name, config] of cases) {
    test(`refuses after ${name}`, async () => {
      const { emit, motus, notes, home } = await setup(config)
      await motus('continue')
      assert.equal(notes.at(-1)?.type, 'error')
      assert.match(notes.at(-1)?.message ?? '', /fix the config/i)
      assert.ok(await emit('tool_call', { toolName: 'grep', input: {} }))
      const shell = await emit('user_bash', { command: 'touch made', cwd: home, excludeFromContext: false })
      assert.equal((shell as { result: { exitCode: number } }).result.exitCode, 1)
    })
  }
})

describe('tool_call', () => {
  const config = { blockCommands: ['pa'], blockPaths: ['~/vault/'] }

  test('blocks commands after comments holding quotes', async () => {
    const { emit } = await setup(config)
    for (const command of ["# Let's look\npa show x", '# "x\npa show x', "echo $(# it's\npa show x)"])
      assert.ok(await emit('tool_call', { toolName: 'bash', input: { command } }), command)
  })

  test('blocks commands after a line continuation', async () => {
    const { emit } = await setup(config)
    assert.ok(await emit('tool_call', { toolName: 'bash', input: { command: 'true && \\\npa show x' } }))
  })

  test('blocks commands behind redirections', async () => {
    const { emit } = await setup({ blockCommands: ['env', 'cat .env*'] })
    for (const command of ['env 2>&1 | grep KEY', 'nohup env 2>&1', 'cat <.env'])
      assert.ok(await emit('tool_call', { toolName: 'bash', input: { command } }), command)
    assert.equal(await emit('tool_call', { toolName: 'bash', input: { command: 'env FOO=1 ls 2>&1' } }), undefined)
  })

  test('blocks commands and path spellings in bash', async () => {
    const { emit } = await setup(config)
    assert.ok(await emit('tool_call', { toolName: 'bash', input: { command: 'echo $(pa show x)' } }))
    assert.ok(await emit('tool_call', { toolName: 'bash', input: { command: 'cat ~/vault/key' } }))
    assert.equal(await emit('tool_call', { toolName: 'bash', input: { command: 'npm run paint' } }), undefined)
  })

  test('blocks blocked paths in any tool, nested arguments included', async () => {
    const { emit, home } = await setup(config)
    assert.ok(await emit('tool_call', { toolName: 'read', input: { path: 'vault/key' } }))
    assert.ok(await emit('tool_call', { toolName: 'mcp_fs_read', input: { args: { file: `${home}/vault` } } }))
    assert.equal(await emit('tool_call', { toolName: 'read', input: { path: 'notes.md' } }), undefined)
  })

  test('blocks placeholders of loaded names in write, edit and bash', async () => {
    const { emit } = await setup()
    const edit = { path: 'a', edits: [{ oldText: 'x', newText: 'k=[REDACTED:API_TOKEN]' }] }
    assert.ok(await emit('tool_call', { toolName: 'edit', input: edit }))
    assert.ok(await emit('tool_call', { toolName: 'write', input: { path: 'a', content: '[REDACTED:API_TOKEN]' } }))
    assert.equal(
      await emit('tool_call', { toolName: 'write', input: { path: 'a', content: '[REDACTED:OTHER]' } }),
      undefined,
    )
  })
})

describe('redaction', () => {
  before(() => {
    process.env['API_TOKEN'] = TOKEN
  })
  after(() => {
    delete process.env['API_TOKEN']
  })

  test('tool_result redacts content, structuredContent and details', async () => {
    const { emit } = await setup()
    const result = await emit('tool_result', {
      toolName: 'edit',
      content: [{ type: 'text', text: `t=${TOKEN}` }],
      structuredContent: { value: TOKEN },
      details: { diff: `+${TOKEN}` },
    })
    assert.deepEqual(result, {
      content: [{ type: 'text', text: 't=[REDACTED:API_TOKEN]' }],
      structuredContent: { value: '[REDACTED:API_TOKEN]' },
      details: { diff: '+[REDACTED:API_TOKEN]' },
    })
  })

  test('tool_result redacts mise state blobs in an env dump', async () => {
    const blobs = { __MISE_DIFF: 'eAFrWWJmZml4eGZmZml4dGRkY2', __MISE_SESSION: 'eAHqWWJmZml4eGZmZml4dGRkY2' }
    const { emit } = await setup({}, blobs)
    const dump = Object.entries({ PATH: '/usr/bin', API_TOKEN: TOKEN, ...blobs }).map(([k, v]) => `${k}=${v}`)
    const result = await emit('tool_result', { content: [{ type: 'text', text: dump.join('\n') }], details: {} })
    assert.deepEqual(result, {
      content: [{
        type: 'text',
        text: [
          'PATH=/usr/bin',
          'API_TOKEN=[REDACTED:API_TOKEN]',
          '__MISE_DIFF=[REDACTED:__MISE_DIFF]',
          '__MISE_SESSION=[REDACTED:__MISE_SESSION]',
        ]
          .join('\n'),
      }],
      details: {},
    })
  })

  test('tool_result returns an error marker when redaction fails', async () => {
    const { emit } = await setup()
    const result = await emit('tool_result', { content: [{ type: 'text', text: TOKEN }], details: cyclic() }) as {
      content: { text: string }[]
      details: unknown
      isError: boolean
    }
    assert.ok(!JSON.stringify(result.content).includes(TOKEN))
    assert.equal(result.details, null)
    assert.equal(result.isError, true)
  })

  test('message_end redacts every string, tool-call args included', async () => {
    const { emit } = await setup()
    const message = { role: 'assistant', content: [{ type: 'toolCall', arguments: { command: `echo ${TOKEN}` } }] }
    const result = await emit('message_end', { message }) as { message: unknown }
    assert.ok(!JSON.stringify(result.message).includes(TOKEN))
  })

  test('message_end withholds content when redaction fails', async () => {
    const { emit } = await setup()
    const message = { role: 'user', content: [{ type: 'text', text: TOKEN }], extra: cyclic() }
    const result = await emit('message_end', { message }) as { message: { role: string; content: unknown } }
    assert.equal(result.message.role, 'user')
    assert.ok(!JSON.stringify(result.message.content).includes(TOKEN))
  })

  test('input redacts pasted secrets', async () => {
    const { emit } = await setup()
    assert.deepEqual(await emit('input', { text: `use ${TOKEN}`, source: 'interactive' }), {
      action: 'transform',
      text: 'use [REDACTED:API_TOKEN]',
    })
    assert.deepEqual(await emit('input', { text: 'hi', source: 'interactive' }), { action: 'continue' })
  })

  test('user_bash runs the command and redacts its output', async () => {
    const { emit, home } = await setup()
    const result = await emit('user_bash', { command: 'echo $API_TOKEN', cwd: home, excludeFromContext: true }) as {
      result: { output: string; exitCode: number }
    }
    assert.equal(result.result.output.trim(), '[REDACTED:API_TOKEN]')
    assert.equal(result.result.exitCode, 0)
  })

  test('user_bash truncates long output after redacting it', async () => {
    const { emit, home } = await setup()
    const command = 'seq 5000; echo $API_TOKEN'
    const result = await emit('user_bash', { command, cwd: home, excludeFromContext: false }) as {
      result: { output: string; truncated: boolean }
    }
    assert.equal(result.result.truncated, true)
    assert.match(result.result.output, /\[REDACTED:API_TOKEN\]\n?$/)
    assert.ok(!result.result.output.includes('\n1\n'))
  })

  test('user_bash rejects blocked commands without running them', async () => {
    const { emit, home } = await setup({ blockCommands: ['touch'] })
    const result = await emit('user_bash', { command: 'touch made', cwd: home, excludeFromContext: false }) as {
      result: { output: string }
    }
    assert.match(result.result.output, /blockCommands/)
    assert.ok(!existsSync(join(home, 'made')))
  })

  test('before_provider_request walks the payload; on error sends an empty one', async () => {
    const { emit } = await setup()
    const payload = { messages: [{ content: `{"k":"${TOKEN}"}\n` }] }
    assert.deepEqual(await emit('before_provider_request', { payload }), {
      messages: [{ content: '{"k":"[REDACTED:API_TOKEN]"}\n' }],
    })
    assert.deepEqual(await emit('before_provider_request', { payload: cyclic() }), {})
  })
})

describe('summarization hooks', () => {
  const preparation = () => ({
    messagesToSummarize: [{ role: 'user', content: `key ${TOKEN}` }],
    turnPrefixMessages: [{ role: 'user', content: `key ${TOKEN}` }],
    previousSummary: `old ${TOKEN}`,
  })

  test('compaction redacts every summarized input in place', async () => {
    const { emit } = await setup()
    const prep = preparation()
    assert.equal(
      await emit('session_before_compact', { preparation: prep, customInstructions: 'focus on tests' }),
      undefined,
    )
    assert.ok(!JSON.stringify(prep).includes(TOKEN))
    assert.match(prep.previousSummary, /\[REDACTED:API_TOKEN\]/)
  })

  test('compaction cancels when instructions hold a loaded value', async () => {
    const { emit, notes } = await setup()
    const result = await emit('session_before_compact', { preparation: preparation(), customInstructions: TOKEN })
    assert.deepEqual(result, { cancel: true })
    assert.ok(!notes.at(-1)?.message.includes(TOKEN))
  })

  test('compaction cancels on redaction failure', async () => {
    const { emit } = await setup()
    const prep = { ...preparation(), messagesToSummarize: [cyclic()] }
    assert.deepEqual(await emit('session_before_compact', { preparation: prep }), { cancel: true })
  })

  test('branch summary redacts the existing entries array and instructions', async () => {
    const { emit } = await setup()
    const entriesToSummarize = [{ type: 'message', message: { role: 'user', content: TOKEN } }]
    const result = await emit('session_before_tree', {
      preparation: { entriesToSummarize, customInstructions: `use ${TOKEN}` },
    })
    assert.ok(!JSON.stringify(entriesToSummarize).includes(TOKEN))
    assert.deepEqual(result, { customInstructions: 'use [REDACTED:API_TOKEN]' })
  })

  test('branch summary cancels on redaction failure', async () => {
    const { emit } = await setup()
    assert.deepEqual(await emit('session_before_tree', { preparation: { entriesToSummarize: [cyclic()] } }), {
      cancel: true,
    })
  })
})

describe('user_bash with a loaded value', () => {
  const REFUSED = /Reference it by variable name/

  async function pasteIntoSession(command: string, config: unknown = {}) {
    const { emit, home } = await setup(config)
    const dir = join(home, 'sessions')
    const session = SessionManager.create(home, dir)
    session.appendMessage({ role: 'user', content: 'hi', timestamp: 0 })
    let error: unknown
    try {
      const result = await emit('user_bash', { command, cwd: home, excludeFromContext: false }) as {
        result: { output: string; exitCode: number }
      }
      session.appendMessage({ role: 'bashExecution', command, timestamp: 0, ...result.result } as never)
    } catch (caught) {
      error = caught
    }
    const [file] = await readdir(dir)
    return { home, error, jsonl: await readFile(join(dir, file ?? ''), 'utf8') }
  }

  test('throws, does not run and leaves no raw value in the session file', async () => {
    const { error, jsonl, home } = await pasteIntoSession(`touch made; echo ${TOKEN}`)
    assert.match((error as Error).message, REFUSED)
    assert.ok(!(error as Error).message.includes(TOKEN))
    assert.ok(!existsSync(join(home, 'made')))
    assert.ok(!jsonl.includes(TOKEN))
    assert.ok(!jsonl.includes('bashExecution'))
  })

  test('throws for commands motus would block', async () => {
    const { error, jsonl } = await pasteIntoSession(`touch ${TOKEN}`, { blockCommands: ['touch'] })
    assert.match((error as Error).message, REFUSED)
    assert.ok(!jsonl.includes(TOKEN))
  })

  test('throws in a degraded session', async () => {
    const { error, jsonl } = await pasteIntoSession(`echo ${TOKEN}`, {
      sources: [{ type: 'command', command: 'exit 3' }],
    })
    assert.match((error as Error).message, REFUSED)
    assert.ok(!jsonl.includes(TOKEN))
  })

  test('a command referencing $VAR runs and is recorded', async () => {
    const { error, jsonl } = await pasteIntoSession('echo $API_TOKEN')
    assert.equal(error, undefined)
    assert.ok(jsonl.includes('echo $API_TOKEN'))
  })
})

describe('/motus', () => {
  test('status reports state', async () => {
    const { motus, notes } = await setup()
    await motus('status')
    assert.match(notes.at(-1)?.message ?? '', /active/)
  })

  test('rejects unknown subcommands, including off', async () => {
    const { motus, notes } = await setup()
    await motus('off')
    assert.equal(notes.at(-1)?.type, 'error')
  })
})
