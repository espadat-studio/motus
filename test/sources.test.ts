import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, test } from 'node:test'

import { describeLoad, loadFromConfig, loadSources, PartialLoadError, type SecretSource } from '../src/sources.ts'
import { commandSource } from '../src/sources/command.ts'
import { envSource } from '../src/sources/env.ts'

const ctx = { cwd: tmpdir(), signal: new AbortController().signal, warn: () => {} }

function fakeSource(id: string, load: SecretSource['load'], applies = true): SecretSource {
  return { id, appliesTo: async () => applies, load }
}

describe('envSource', () => {
  test('loads secret-looking names and skips the denylist and empty values', async () => {
    const env = {
      API_TOKEN: 'fixture-token-0001',
      db_password: 'fixture-pass-0001',
      DATABASE_URL: 'postgres://u:fixture-pass-0002@host/db',
      SSH_AUTH_SOCK: '/run/user/1000/ssh-agent.sock',
      KITTY_PUBLIC_KEY: 'fixture-kitty-0001',
      GITHUB_TOKEN: '',
      PATH: '/usr/bin',
      HOME: '/home/fixture',
    }
    const secrets = await envSource(env).load(ctx)
    assert.deepEqual(secrets.map(({ name }) => name).sort(), ['API_TOKEN', 'DATABASE_URL', 'db_password'])
    assert.ok(secrets.every(({ source }) => source === 'env'))
  })

  test('applies everywhere', async () => {
    assert.equal(await envSource({}).appliesTo({ cwd: '/' }), true)
  })
})

describe('commandSource', () => {
  test('parses NAME: value JSON from stdout', async () => {
    const source = commandSource('vault', `printf '{"API_TOKEN":"fixture-token-0001"}'`)
    assert.deepEqual(await source.load(ctx), [{ name: 'API_TOKEN', value: 'fixture-token-0001', source: 'vault' }])
  })

  test('skips empty values', async () => {
    const source = commandSource('vault', `printf '{"EMPTY_KEY":"","API_TOKEN":"fixture-token-0001"}'`)
    assert.deepEqual((await source.load(ctx)).map(({ name }) => name), ['API_TOKEN'])
  })

  test('runs in the cwd', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'motus-'))
    await writeFile(join(cwd, 'secrets.json'), '{"FIXTURE_KEY":"fixture-key-0001"}')
    const secrets = await commandSource('vault', 'cat secrets.json').load({ ...ctx, cwd })
    assert.deepEqual(secrets.map(({ value }) => value), ['fixture-key-0001'])
  })

  test('throws on non-zero exit without echoing stderr', async () => {
    const source = commandSource('vault', 'echo fixture-token-0001 >&2; exit 3')
    await assert.rejects(source.load(ctx), (error: Error) => {
      assert.equal(error.message, 'exited with code 3')
      return true
    })
  })

  const badOutputs = [
    ['invalid JSON', `printf 'fixture-token-0001'`],
    ['an array', `printf '["fixture-token-0001"]'`],
    ['a non-string value', `printf '{"API_TOKEN":1}'`],
  ]
  for (const [label, command] of badOutputs) {
    test(`throws on ${label} without echoing stdout`, async () => {
      await assert.rejects(commandSource('vault', command as string).load(ctx), (error: Error) => {
        assert.equal(error.message, 'stdout is not a JSON object of string values')
        return true
      })
    })
  }

  test('aborts with the signal', async () => {
    const controller = new AbortController()
    const loading = commandSource('vault', 'sleep 5').load({ ...ctx, signal: controller.signal })
    controller.abort()
    await assert.rejects(loading)
  })
})

describe('loadSources', () => {
  const secret = { name: 'API_TOKEN', value: 'fixture-token-0001', source: 'ok' }

  test('collects secrets and per-source counts', async () => {
    const result = await loadSources([
      { source: fakeSource('ok', async () => [secret]), required: true, timeoutMs: 1000 },
      { source: fakeSource('empty', async () => []), required: true, timeoutMs: 1000 },
    ], tmpdir())
    assert.deepEqual(result, {
      secrets: [secret],
      loaded: [{ id: 'ok', count: 1 }, { id: 'empty', count: 0 }],
      failures: [],
      warnings: [],
    })
  })

  test('keeps the secrets of a partial failure and reports it', async () => {
    const partial = fakeSource('mise', async () => {
      throw new PartialLoadError('a.toml failed: exited with code 1', [secret])
    })
    const result = await loadSources([{ source: partial, required: true, timeoutMs: 1000 }], tmpdir())
    assert.deepEqual(result.secrets, [secret])
    assert.deepEqual(result.loaded, [{ id: 'mise', count: 1 }])
    assert.deepEqual(result.failures, [
      { id: 'mise', required: true, applies: true, reason: 'a.toml failed: exited with code 1' },
    ])
  })

  test('collects warnings tagged with the source id', async () => {
    const warns = fakeSource('mise', async ({ warn }) => {
      warn('b.toml failed: exited with code 1')
      return [secret]
    })
    const result = await loadSources([{ source: warns, required: true, timeoutMs: 1000 }], tmpdir())
    assert.deepEqual(result.warnings, ['mise warning: b.toml failed: exited with code 1'])
  })

  test('reports failures with required and applies', async () => {
    const fail = async (): Promise<never> => {
      throw new Error('exited with code 1')
    }
    const result = await loadSources([
      { source: fakeSource('here', fail, true), required: true, timeoutMs: 1000 },
      { source: fakeSource('elsewhere', fail, false), required: true, timeoutMs: 1000 },
      { source: fakeSource('optional', fail, true), required: false, timeoutMs: 1000 },
    ], tmpdir())
    assert.deepEqual(result.failures, [
      { id: 'here', required: true, applies: true, reason: 'exited with code 1' },
      { id: 'elsewhere', required: true, applies: false, reason: 'exited with code 1' },
      { id: 'optional', required: false, applies: true, reason: 'exited with code 1' },
    ])
  })

  test('times out a source that ignores the signal', async () => {
    const hang = fakeSource('hang', () => new Promise(() => {}))
    const result = await loadSources([{ source: hang, required: true, timeoutMs: 20 }], tmpdir())
    assert.deepEqual(result.failures, [{ id: 'hang', required: true, applies: true, reason: 'timed out after 20 ms' }])
  })

  test('treats a hanging appliesTo as applying', async () => {
    const source: SecretSource = {
      id: 'stuck',
      appliesTo: () => new Promise(() => {}),
      load: async () => {
        throw new Error('failed')
      },
    }
    const result = await loadSources([{ source, required: true, timeoutMs: 20 }], tmpdir())
    assert.equal(result.failures[0]?.applies, true)
  })

  test('treats a throwing appliesTo as applying', async () => {
    const source: SecretSource = {
      id: 'broken',
      appliesTo: async () => {
        throw new Error('boom')
      },
      load: async () => {
        throw new Error('failed')
      },
    }
    const result = await loadSources([{ source, required: true, timeoutMs: 1000 }], tmpdir())
    assert.equal(result.failures[0]?.applies, true)
  })
})

describe('loadFromConfig', () => {
  test('loads sources from a valid config', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'motus-')), 'config.json')
    await writeFile(
      path,
      JSON.stringify({
        sources: [{ type: 'command', command: `printf '{"FIXTURE_KEY":"fixture-key-0001"}'` }],
      }),
    )
    const { config, result } = await loadFromConfig(path, tmpdir(), {})
    assert.ok(config)
    assert.deepEqual(result.loaded, [{ id: 'env', count: 0 }, { id: 'command', count: 1 }])
    assert.deepEqual(result.failures, [])
  })

  test('reports an invalid config as a failed required source and still loads env', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'motus-')), 'config.json')
    await writeFile(path, JSON.stringify({ blockPath: [] }))
    const { config, result } = await loadFromConfig(path, tmpdir(), { API_TOKEN: 'fixture-token-0001' })
    assert.equal(config, undefined)
    assert.deepEqual(result.loaded, [{ id: 'env', count: 1 }])
    assert.deepEqual(result.failures, [
      { id: 'config', required: true, applies: true, reason: 'unknown key "blockPath"' },
    ])
  })
})

describe('describeLoad', () => {
  test('reports counts and failures, never values', () => {
    const text = describeLoad({
      secrets: [{ name: 'API_TOKEN', value: 'fixture-token-0001', source: 'env' }],
      loaded: [{ id: 'env', count: 1 }],
      failures: [
        { id: 'mise', required: true, applies: true, reason: 'timed out after 10000 ms' },
        { id: 'vault', required: true, applies: false, reason: 'exited with code 1' },
        { id: 'extra', required: false, applies: true, reason: 'exited with code 2' },
      ],
      warnings: ['mise warning: b.toml failed: exited with code 1'],
    })
    assert.equal(
      text,
      [
        'motus: 1 secret from env (1)',
        'mise failed: timed out after 10000 ms (required, applies here)',
        'vault failed: exited with code 1 (required, not used here)',
        'extra failed: exited with code 2 (optional)',
        'mise warning: b.toml failed: exited with code 1',
      ]
        .join('\n'),
    )
    assert.doesNotMatch(text, /fixture-token-0001/)
  })
})
