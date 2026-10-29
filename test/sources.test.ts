import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, test } from 'node:test'

import { stringify } from 'smol-toml'

import { parseConfig } from '../src/config.ts'
import { describeLoad, loadFromConfig, loadSources, PartialLoadError, type SecretSource } from '../src/sources.ts'
import { commandSource } from '../src/sources/command.ts'
import { envSource } from '../src/sources/env.ts'
import { paSource } from '../src/sources/pa.ts'

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

const FAKE_PA = `#!/bin/sh
read -r _ || true
case "$1" in
  list) cd "$PA_DIR" && find . -type f -name '*.txt' | sed 's|^\\./||;s/\\.txt$//' | sort ;;
  show)
    [ "$2" = slow ] && { echo $$ > "$PA_DIR/pid"; exec sleep 5; }
    cat "$PA_DIR/$2.txt" ;;
  *) exit 64 ;;
esac
`

async function fakePaStore(entries: Record<string, string>): Promise<{ dir: string; env: NodeJS.ProcessEnv }> {
  const root = await mkdtemp(join(tmpdir(), 'motus-pa-'))
  const bin = join(root, 'bin')
  await mkdir(bin)
  await writeFile(join(bin, 'pa'), FAKE_PA)
  await chmod(join(bin, 'pa'), 0o755)
  const dir = join(root, 'store')
  await mkdir(dir)
  for (const [name, content] of Object.entries(entries)) {
    await mkdir(dirname(join(dir, `${name}.txt`)), { recursive: true })
    await writeFile(join(dir, `${name}.txt`), content)
  }
  return { dir, env: { PATH: `${bin}:${process.env['PATH']}` } }
}

describe('paSource', () => {
  const load = async (entries: Record<string, string>, names?: string[]) => {
    const { dir, env } = await fakePaStore(entries)
    return paSource('pa', { dir, env, minValueLength: 8, ...(names && { entries: names }) }).load(ctx)
  }

  test('names a single-line entry after the entry, slashes kept', async () => {
    assert.deepEqual(await load({ 'web/github': 'fixture-pass-0001\n' }, ['web/github']), [
      { name: 'web/github', value: 'fixture-pass-0001', source: 'pa' },
    ])
  })

  test('numbers kept lines of a multi-line entry, skipping blank and short lines', async () => {
    const secrets = await load({ multi: 'fixture-pass-0001\n\nshort\nfixture-pass-0002\n' }, ['multi'])
    assert.deepEqual(secrets.map(({ name, value }) => [name, value]), [
      ['multi:1', 'fixture-pass-0001'],
      ['multi:2', 'fixture-pass-0002'],
    ])
  })

  test('yields nothing for an entry with no kept lines', async () => {
    assert.deepEqual(await load({ tiny: 'short\n\n' }, ['tiny']), [])
  })

  test('whole loads every entry except */meta', async () => {
    const secrets = await load({
      'web/github': 'fixture-pass-0001',
      'web/meta': 'fixture-meta-0001',
      mail: 'fixture-pass-0002',
    })
    assert.deepEqual(secrets.map(({ name }) => name), ['mail', 'web/github'])
  })

  test('loads a meta entry named in entries', async () => {
    assert.deepEqual((await load({ 'web/meta': 'fixture-meta-0001' }, ['web/meta'])).map(({ name }) => name), [
      'web/meta',
    ])
  })

  test('whole on an empty store throws naming the dir', async () => {
    const { dir, env } = await fakePaStore({})
    await assert.rejects(paSource('pa', { dir, env, minValueLength: 8 }).load(ctx), (error: Error) => {
      assert.equal(error.message, `no entries in ${dir}`)
      return true
    })
  })

  test('a missing listed entry throws naming the entry, never a partial list', async () => {
    await assert.rejects(load({ ok: 'fixture-pass-0001' }, ['ok', 'gone']), (error: Error) => {
      assert.equal(error.message, 'pa show "gone" exited with code 1')
      assert.doesNotMatch(error.message, /fixture-pass-0001/)
      return true
    })
  })

  test('aborting kills the in-flight pa process', async () => {
    const { dir, env } = await fakePaStore({})
    const controller = new AbortController()
    const loading = paSource('pa', { dir, env, minValueLength: 8, entries: ['slow'] }).load({
      ...ctx,
      signal: controller.signal,
    })
    const deadline = Date.now() + 1000
    const pause = () => new Promise((resolve) => setTimeout(resolve, 10))
    let pid = ''
    while (!pid && Date.now() < deadline)
      pid = await readFile(join(dir, 'pid'), 'utf8').catch(() => pause().then(() => ''))
    assert.ok(pid, 'fake pa never started')
    controller.abort()
    await assert.rejects(loading)
    const isAlive = (): boolean => {
      try {
        return process.kill(Number(pid), 0)
      } catch {
        return false
      }
    }
    while (isAlive() && Date.now() < deadline) await pause()
    assert.equal(isAlive(), false)
  })
})

describe('pa source config', () => {
  const loadVia = async (env: NodeJS.ProcessEnv, dir?: string) => {
    const [, configured] = parseConfig({ sources: [{ type: 'pa', whole: true, ...(dir && { dir }) }] }, env).sources
    return (await configured?.source.load(ctx))?.map(({ name }) => name)
  }

  test('defaults dir to PA_DIR', async () => {
    const { dir, env } = await fakePaStore({ mail: 'fixture-pass-0001' })
    assert.deepEqual(await loadVia({ ...env, HOME: '/', PA_DIR: dir }), ['mail'])
  })

  test('expands ~ and env vars in dir', async () => {
    const { dir, env } = await fakePaStore({ mail: 'fixture-pass-0001' })
    assert.deepEqual(await loadVia({ ...env, HOME: dirname(dir) }, '~/store'), ['mail'])
    assert.deepEqual(await loadVia({ ...env, HOME: '/', STORES: dirname(dir) }, '$STORES/store'), ['mail'])
  })

  test('falls back to ~/.local/share/pa', async () => {
    const { dir, env } = await fakePaStore({})
    const home = dirname(dir)
    await mkdir(join(home, '.local', 'share', 'pa'), { recursive: true })
    await writeFile(join(home, '.local', 'share', 'pa', 'mail.txt'), 'fixture-pass-0001')
    assert.deepEqual(await loadVia({ ...env, HOME: home }), ['mail'])
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
    const path = join(await mkdtemp(join(tmpdir(), 'motus-')), 'config.toml')
    await writeFile(
      path,
      stringify({
        sources: [{ type: 'command', command: `printf '{"FIXTURE_KEY":"fixture-key-0001"}'` }],
      }),
    )
    const { config, result } = await loadFromConfig(path, tmpdir(), {})
    assert.ok(config)
    assert.deepEqual(result.loaded, [{ id: 'env', count: 0 }, { id: 'command', count: 1 }])
    assert.deepEqual(result.failures, [])
  })

  test('reports an invalid config as a failed required source and still loads env', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'motus-')), 'config.toml')
    await writeFile(path, stringify({ blockPath: [] }))
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
