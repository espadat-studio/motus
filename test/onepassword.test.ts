import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, test } from 'node:test'

import { onePasswordSource } from '../src/sources/onepassword.ts'

const FIXTURES: Record<string, string> = {
  'op://dev/api/token': 'fixture-api-token-0001',
  'op://dev/db/password': 'fixture"pass\\0001',
  'op://dev vault/gh/token': 'fixture-gh-token-0001',
}

function stub(fixtures: Record<string, string>, body?: string, trailing = '\\n'): string {
  const seds = Object.entries(fixtures).map(([ref, value]) => `-e 's|{{ ${ref} }}|${value.replace(/\\/g, '\\\\')}|'`)
  return `#!/bin/sh
echo "$*" >> "$HOME/op.log"
[ "$*" = "inject" ] || exit 64
${body ?? ''}
out=$(sed -e '' ${seds.join(' ')})
case $out in *'{{'*) echo "could not resolve item" >&2; exit 1;; esac
printf '%s${trailing}' "$out"
`
}

async function fixture(script = stub(FIXTURES)): Promise<{ home: string; env: NodeJS.ProcessEnv }> {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'motus-op-')))
  await mkdir(join(home, 'bin'))
  await writeFile(join(home, 'bin/op'), script)
  await chmod(join(home, 'bin/op'), 0o755)
  return { home, env: { HOME: home, PATH: `${join(home, 'bin')}:/usr/bin:/bin` } }
}

function load(source: ReturnType<typeof onePasswordSource>, signal = new AbortController().signal) {
  return source.load({ cwd: tmpdir(), signal, warn: () => {} })
}

async function calls(home: string): Promise<string[]> {
  return (await readFile(join(home, 'op.log'), 'utf8').catch(() => '')).split('\n').filter(Boolean)
}

describe('onePasswordSource', () => {
  test('resolves refs and fromEnv refs with one op inject call', async () => {
    const { home, env } = await fixture()
    const source = onePasswordSource(
      '1password',
      {
        API_TOKEN: 'op://dev/api/token',
        DB_PASSWORD: 'op://dev/db/password',
      },
      true,
      { ...env, GH_TOKEN: 'op://dev vault/gh/token', PLAIN: 'visible' },
    )
    const secrets = await load(source)
    assert.deepEqual(secrets.map(({ name, value, source }) => [name, value, source]), [
      ['API_TOKEN', 'fixture-api-token-0001', '1password'],
      ['DB_PASSWORD', 'fixture"pass\\0001', '1password'],
      ['GH_TOKEN', 'fixture-gh-token-0001', '1password'],
    ])
    assert.deepEqual(await calls(home), ['inject'])
  })

  test('parses output whether or not op keeps the final newline', async () => {
    const { env } = await fixture(stub(FIXTURES, undefined, ''))
    const source = onePasswordSource('1password', { API_TOKEN: 'op://dev/api/token' }, false, env)
    assert.deepEqual((await load(source)).map(({ value }) => value), ['fixture-api-token-0001'])
  })

  test('ignores env refs without fromEnv', async () => {
    const { env } = await fixture()
    const source = onePasswordSource('1password', { API_TOKEN: 'op://dev/api/token' }, false, {
      ...env,
      GH_TOKEN: 'op://dev vault/gh/token',
    })
    assert.deepEqual((await load(source)).map(({ name }) => name), ['API_TOKEN'])
  })

  test('returns an empty list without running op when fromEnv finds no refs', async () => {
    const { home, env } = await fixture()
    assert.deepEqual(await load(onePasswordSource('1password', {}, true, env)), [])
    assert.deepEqual(await calls(home), [])
  })

  test('rejects a name in both refs and env', async () => {
    const { env } = await fixture()
    const source = onePasswordSource('1password', { GH_TOKEN: 'op://dev/api/token' }, true, {
      ...env,
      GH_TOKEN: 'op://dev vault/gh/token',
    })
    await assert.rejects(load(source), /GH_TOKEN is set in both refs and env/)
  })

  test('rejects an env ref that breaks the template', async () => {
    const { env } = await fixture()
    const source = onePasswordSource('1password', {}, true, { ...env, GH_TOKEN: 'op://dev/gh/token }}' })
    await assert.rejects(load(source), /GH_TOKEN is not a valid op:\/\/ reference/)
  })

  const failures: [string, string, RegExp][] = [
    ['an unknown ref', stub({}), /op inject exited with code 1 for API_TOKEN=op:\/\/dev\/api\/token/],
    ['auth failure', stub(FIXTURES, 'echo "fixture-api-token-0001" >&2; exit 6'), /exited with code 6/],
    ['output that does not match the template', stub(FIXTURES, 'echo garbage; exit 0'), /op inject output/],
  ]
  for (const [label, script, message] of failures) {
    test(`throws on ${label}, never a partial list or a value`, async () => {
      const { env } = await fixture(script)
      const source = onePasswordSource('1password', { API_TOKEN: 'op://dev/api/token' }, false, env)
      await assert.rejects(load(source), (error: Error) => {
        assert.match(error.message, message)
        assert.doesNotMatch(error.message, /fixture-api-token-0001/)
        return true
      })
    })
  }

  test('throws when op is missing', async () => {
    const source = onePasswordSource('1password', { API_TOKEN: 'op://dev/api/token' }, false, { PATH: '/nonexistent' })
    await assert.rejects(load(source), /op inject failed to run/)
  })

  test('applies everywhere', async () => {
    assert.equal(await onePasswordSource('1password', {}, true, {}).appliesTo({ cwd: '/' }), true)
  })
})
