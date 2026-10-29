import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, test } from 'node:test'

import { PartialLoadError } from '../src/sources.ts'
import { miseSource } from '../src/sources/mise.ts'

const STUB = `#!/bin/sh
[ "$1 $2 $3" = "env --json -C" ] || exit 64
exec cat "$4/mise-stub\${MISE_ENV:+.$MISE_ENV}.json"
`

async function fixture(files: Record<string, string>): Promise<{ home: string; env: NodeJS.ProcessEnv }> {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'motus-mise-')))
  for (const [path, content] of Object.entries({ 'bin/mise': STUB, ...files })) {
    await mkdir(dirname(join(home, path)), { recursive: true })
    await writeFile(join(home, path), content)
  }
  await chmod(join(home, 'bin/mise'), 0o755)
  return { home, env: { HOME: home, PATH: `${join(home, 'bin')}:/usr/bin:/bin` } }
}

function load(home: string, env: NodeJS.ProcessEnv, cwd: string, warnings: string[] = []) {
  return miseSource('mise', '~/list', env).load({
    cwd: join(home, cwd),
    signal: new AbortController().signal,
    warn: (message) => warnings.push(message),
  })
}

const listed = {
  list: '# managed by rotate-mise-secrets\n\n~/a/.mise/config.toml\n~/a/.mise/config.prod.toml\n~/b/mise.toml\n',
  'a/.mise/config.toml': '[env]\nA_TOKEN = { age = "fixture-ciphertext" }\nPLAIN = "visible"\n',
  'a/mise-stub.json': '{"A_TOKEN":"fixture-a-token-0001","PLAIN":"visible","PATH":"/usr/bin"}',
  'a/.mise/config.prod.toml': '[env]\n"PROD_TOKEN" = { age = { value = "fixture-ciphertext" } }\n',
  'a/mise-stub.prod.json': '{"PROD_TOKEN":"fixture-prod-token-0001"}',
  'b/mise.toml': '[env]\nB_TOKEN = {age="fixture-ciphertext"}\n',
  'b/mise-stub.json': '{"B_TOKEN":"fixture-b-token-0001"}',
  'plain/mise.toml': '[env]\nPLAIN = "visible"\n',
}

describe('miseSource', () => {
  test('loads only age keys of every listed file, with MISE_ENV for env files', async () => {
    const { home, env } = await fixture(listed)
    const warnings: string[] = []
    const secrets = await load(home, env, 'plain', warnings)
    assert.deepEqual(secrets.map(({ name, value }) => [name, value]), [
      ['A_TOKEN', 'fixture-a-token-0001'],
      ['PROD_TOKEN', 'fixture-prod-token-0001'],
      ['B_TOKEN', 'fixture-b-token-0001'],
    ])
    assert.ok(secrets.every(({ source }) => source === 'mise'))
    assert.deepEqual(warnings, [])
  })

  test('loads unlisted age keys of the cwd and warns about the drift', async () => {
    const { home, env } = await fixture({
      ...listed,
      'c/mise.toml': '[env]\nC_TOKEN = { age = "fixture-ciphertext" }\n',
      'c/mise-stub.json': '{"C_TOKEN":"fixture-c-token-0001","A_TOKEN":"other"}',
    })
    const warnings: string[] = []
    const secrets = await load(home, env, 'c/sub', warnings)
    assert.deepEqual(secrets.at(-1), { name: 'C_TOKEN', value: 'fixture-c-token-0001', source: 'mise' })
    assert.deepEqual(warnings, [`${home}/c/mise.toml has age keys missing from ~/list: C_TOKEN`])
  })

  test('does not duplicate listed keys when the cwd is a listed repo', async () => {
    const { home, env } = await fixture(listed)
    const secrets = await load(home, env, 'b')
    assert.deepEqual(secrets.map(({ name }) => name), ['A_TOKEN', 'PROD_TOKEN', 'B_TOKEN'])
  })

  test('warns about a failed file that does not cover the cwd and loads the rest', async () => {
    const { home, env } = await fixture({ ...listed, 'b/mise-stub.json': 'not json' })
    const warnings: string[] = []
    const secrets = await load(home, env, 'plain', warnings)
    assert.deepEqual(secrets.map(({ name }) => name), ['A_TOKEN', 'PROD_TOKEN'])
    assert.deepEqual(warnings, [`${home}/b/mise.toml failed: mise env output is not a JSON object of strings`])
  })

  test('fails with the loaded secrets when a failed file covers the cwd', async () => {
    const { home, env } = await fixture({ ...listed, 'a/mise-stub.prod.json': '{}' })
    const warnings: string[] = []
    await assert.rejects(load(home, env, 'a/src', warnings), (error: unknown) => {
      assert.ok(error instanceof PartialLoadError)
      assert.equal(error.message, `${home}/a/.mise/config.prod.toml failed: mise env did not output PROD_TOKEN`)
      assert.deepEqual(error.secrets.map(({ name }) => name), ['A_TOKEN', 'B_TOKEN'])
      return true
    })
    assert.deepEqual(warnings, [])
  })

  test('reports a non-zero mise exit without echoing its output', async () => {
    const { home, env } = await fixture({ ...listed, 'bin/mise': '#!/bin/sh\necho fixture-a-token-0001 >&2\nexit 3\n' })
    const warnings: string[] = []
    await assert.rejects(load(home, env, 'b', warnings), (error: Error) => {
      assert.equal(error.message, `${home}/b/mise.toml failed: mise env exited with code 3`)
      return true
    })
    assert.equal(warnings.length, 2)
    assert.doesNotMatch(warnings.join('\n'), /fixture-a-token-0001/)
  })

  test('fails when the list file is unreadable', async () => {
    const { home, env } = await fixture({})
    await assert.rejects(load(home, env, '.'), { message: 'cannot read ~/list' })
  })

  test('applies only where the cwd has an age-encrypted config', async () => {
    const { home, env } = await fixture({
      ...listed,
      'd/.config/mise/config.toml': '[env]\nD_TOKEN = { age = "fixture-ciphertext" }\n',
    })
    const source = miseSource('mise', '~/list', env)
    assert.equal(await source.appliesTo({ cwd: join(home, 'a/src') }), true)
    assert.equal(await source.appliesTo({ cwd: join(home, 'd') }), true)
    assert.equal(await source.appliesTo({ cwd: join(home, 'plain') }), false)
    assert.equal(await source.appliesTo({ cwd: home }), false)
  })
})
