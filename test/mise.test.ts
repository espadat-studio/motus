import assert from 'node:assert/strict'
import { access, chmod, mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, test } from 'node:test'

import { PartialLoadError } from '../src/sources.ts'
import { miseSource } from '../src/sources/mise.ts'

const STUB = `#!/bin/sh
[ "$1 $2 $3" = "env --json -C" ] || exit 64
if [ "$MISE_TRUSTED_CONFIG_PATHS" = "$4" ]; then
  echo "$4" >> "$HOME/temp-dirs"
  cat "$4/mise.toml" >> "$HOME/temp-configs"
  grep -q fixture-undecryptable "$4/mise.toml" && exit 1
  exec awk -F'"' 'BEGIN { printf "{" } /= \\{ age = "fixture-task/ { printf "%s\\"%s\\":\\"plain-%s\\"", sep, substr($1, 1, index($1, " ") - 1), $2; sep = "," } END { print "}" }' "$4/mise.toml"
fi
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
  'a/src/.keep': '',
  'c/sub/.keep': '',
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

  test('ignores an inherited MISE_ENV for base files', async () => {
    const { home, env } = await fixture(listed)
    const secrets = await load(home, { ...env, MISE_ENV: 'prod' }, 'plain')
    assert.deepEqual(secrets.map(({ name }) => name), ['A_TOKEN', 'PROD_TOKEN', 'B_TOKEN'])
  })

  test('skips cwd env files that are not active', async () => {
    const { home, env } = await fixture({
      ...listed,
      'e/mise.staging.toml': '[env]\nE_TOKEN = { age = "fixture-ciphertext" }\n',
      'e/mise-stub.staging.json': '{"E_TOKEN":"fixture-e-token-0001"}',
    })
    const warnings: string[] = []
    await load(home, env, 'e', warnings)
    assert.deepEqual(warnings, [])
    assert.equal(await miseSource('mise', '~/list', env).appliesTo({ cwd: join(home, 'e') }), false)
    const staged = { ...env, MISE_ENV: 'staging' }
    assert.equal(await miseSource('mise', '~/list', staged).appliesTo({ cwd: join(home, 'e') }), true)
    const secrets = await load(home, staged, 'e', warnings)
    assert.deepEqual(secrets.at(-1)?.name, 'E_TOKEN')
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

  test('loads task env age keys through a temporary config next to the [env] ones', async () => {
    const { home, env } = await fixture({
      list: '~/t/mise.toml\n',
      't/mise.toml': [
        '[env]',
        'A_TOKEN = { age = "fixture-ciphertext" }',
        'SHARED = { age = "fixture-ciphertext" }',
        '[tasks.dev]',
        'run = "dev"',
        '[tasks.dev.env]',
        'DEV_TOKEN = { age = "fixture-task-dev" } # dev',
        'SHARED = { age = "fixture-task-shared-dev" }',
        '[tasks."build:all".env]',
        'SHARED = { age = "fixture-task-shared-build" }',
        '[tools]',
        'node = "26"',
        '',
      ]
        .join('\n'),
      't/mise-stub.json': '{"A_TOKEN":"fixture-a-token-0001","SHARED":"fixture-shared-0001"}',
    })
    const secrets = await load(home, env, 't')
    assert.deepEqual(secrets.map(({ name, value }) => [name, value]), [
      ['A_TOKEN', 'fixture-a-token-0001'],
      ['SHARED', 'fixture-shared-0001'],
      ['DEV_TOKEN', 'plain-fixture-task-dev'],
      ['SHARED', 'plain-fixture-task-shared-dev'],
      ['SHARED', 'plain-fixture-task-shared-build'],
    ])
    assert.equal(
      await readFile(join(home, 'temp-configs'), 'utf8'),
      [
        '[env]',
        'MOTUS_TASK_ENV_0 = { age = "fixture-task-dev" }',
        'MOTUS_TASK_ENV_1 = { age = "fixture-task-shared-dev" }',
        'MOTUS_TASK_ENV_2 = { age = "fixture-task-shared-build" }',
        '',
      ]
        .join('\n'),
    )
    await assertTempDirsGone(home)
  })

  test('keeps [env] secrets and names each task env key that failed to decrypt', async () => {
    const { home, env } = await fixture({
      ...listed,
      'b/mise.toml': [
        '[env]',
        'B_TOKEN = {age="fixture-ciphertext"}',
        '[tasks.x.env]',
        'X_TOKEN = { age = "fixture-task-x" }',
        'Y_TOKEN = { age = "fixture-missing" }',
        'Z_TOKEN = { age = "fixture-missing" }',
        '',
      ]
        .join('\n'),
    })
    const warnings: string[] = []
    const secrets = await load(home, env, 'plain', warnings)
    assert.deepEqual(secrets.map(({ name }) => name), ['A_TOKEN', 'PROD_TOKEN', 'B_TOKEN', 'X_TOKEN'])
    assert.deepEqual(warnings, [
      `${home}/b/mise.toml failed: cannot decrypt task env keys Y_TOKEN, Z_TOKEN: mise env did not output them`,
    ])
    await assertTempDirsGone(home)
  })

  test('fails with the [env] secrets when task env decryption fails inside the project', async () => {
    const { home, env } = await fixture({
      ...listed,
      'b/mise.toml': [
        '[env]',
        'B_TOKEN = {age="fixture-ciphertext"}',
        '[tasks.x.env]',
        'X_TOKEN = { age = "fixture-task-x" }',
        'Y_TOKEN = { age = "fixture-undecryptable" }',
        '',
      ]
        .join('\n'),
    })
    await assert.rejects(load(home, env, 'b'), (error: unknown) => {
      assert.ok(error instanceof PartialLoadError)
      assert.equal(
        error.message,
        `${home}/b/mise.toml failed: cannot decrypt task env keys X_TOKEN, Y_TOKEN: mise env exited with code 1`,
      )
      assert.deepEqual(error.secrets.map(({ name }) => name), ['A_TOKEN', 'PROD_TOKEN', 'B_TOKEN'])
      return true
    })
    await assertTempDirsGone(home)
  })

  test('counts task env age keys toward appliesTo and drift', async () => {
    const { home, env } = await fixture({
      ...listed,
      'c/mise.toml': '[tasks.dev.env]\nC_TOKEN = { age = "fixture-task-c" }\n',
    })
    assert.equal(await miseSource('mise', '~/list', env).appliesTo({ cwd: join(home, 'c') }), true)
    const warnings: string[] = []
    const secrets = await load(home, env, 'c/sub', warnings)
    assert.deepEqual(secrets.at(-1), { name: 'C_TOKEN', value: 'plain-fixture-task-c', source: 'mise' })
    assert.deepEqual(warnings, [`${home}/c/mise.toml has age keys missing from ~/list: C_TOKEN`])
  })

  test('loads dotted, multi-line and inline age keys of [env] and task env', async () => {
    const { home, env } = await fixture({
      list: '~/i/mise.toml\n',
      'i/mise.toml': [
        'env.DOTTED = { age = "fixture-ciphertext" }',
        'env.PLAIN = "visible"',
        'env.MULTI = { age = """',
        'fixture-ciphertext',
        '""" }',
        '[tasks.dev]',
        'env = { DEV_TOKEN = { age = "fixture-task-dev" }, PLAIN = "visible" }',
        '[tasks.build]',
        'env.BUILD_TOKEN = { age = "fixture-task-build" }',
        '',
      ]
        .join('\n'),
      'i/mise-stub.json': '{"DOTTED":"fixture-dotted-0001","MULTI":"fixture-multi-0001","PLAIN":"visible"}',
    })
    const secrets = await load(home, env, 'i')
    assert.deepEqual(secrets.map(({ name, value }) => [name, value]), [
      ['DOTTED', 'fixture-dotted-0001'],
      ['MULTI', 'fixture-multi-0001'],
      ['DEV_TOKEN', 'plain-fixture-task-dev'],
      ['BUILD_TOKEN', 'plain-fixture-task-build'],
    ])
    assert.equal(
      await readFile(join(home, 'temp-configs'), 'utf8'),
      [
        '[env]',
        'MOTUS_TASK_ENV_0 = { age = "fixture-task-dev" }',
        'MOTUS_TASK_ENV_1 = { age = "fixture-task-build" }',
        '',
      ]
        .join('\n'),
    )
  })

  test('fails a config that is not TOML and loads the rest', async () => {
    const { home, env } = await fixture({
      ...listed,
      'b/mise.toml': '[env\nB_TOKEN = { age = "fixture-ciphertext" }\n',
    })
    const warnings: string[] = []
    const secrets = await load(home, env, 'plain', warnings)
    assert.deepEqual(secrets.map(({ name }) => name), ['A_TOKEN', 'PROD_TOKEN'])
    assert.deepEqual(warnings, [`${home}/b/mise.toml failed: not valid TOML`])
  })

  test('applies to and fails a cwd config that is not TOML', async () => {
    const { home, env } = await fixture({ ...listed, 'c/mise.toml': 'not = = toml\n' })
    assert.equal(await miseSource('mise', '~/list', env).appliesTo({ cwd: join(home, 'c') }), true)
    const warnings: string[] = []
    await assert.rejects(load(home, env, 'c/sub', warnings), (error: unknown) => {
      assert.ok(error instanceof PartialLoadError)
      assert.equal(error.message, `${home}/c/mise.toml failed: not valid TOML`)
      assert.deepEqual(error.secrets.map(({ name }) => name), ['A_TOKEN', 'PROD_TOKEN', 'B_TOKEN'])
      return true
    })
    assert.deepEqual(warnings, [])
  })
})

describe('miseSource file tasks', () => {
  const taskDirs = ['mise-tasks', '.mise-tasks', 'mise/tasks', '.mise/tasks', '.config/mise/tasks']

  test('loads #MISE and # [MISE] env age keys of every default task dir', async () => {
    const { home, env } = await fixture({
      ...listed,
      ...Object.fromEntries(
        taskDirs.map((dir, index) => [
          `b/${dir}/nested/t${index}`,
          `#!/bin/sh
#MISE env={T${index}={age="fixture-task-${index}"}}
`,
        ]),
      ),
      'b/mise-tasks/bracket': [
        '#!/bin/sh',
        '#MISE description="bracket"',
        '# [MISE] env.BRACKET = { age = "fixture-task-bracket" }',
        '#MISE env={PLAIN="visible"}',
        '#USAGE flag "--x"',
        'echo hi',
        '',
      ]
        .join('\n'),
      'b/mise-tasks/.hidden': '#MISE env={HIDDEN={age="fixture-task-hidden"}}\n',
      'b/mise-tasks/plain': '#!/bin/sh\n#MISE env={PLAIN="visible"}\n',
    })
    const warnings: string[] = []
    const secrets = await load(home, env, 'plain', warnings)
    assert.deepEqual(secrets.map(({ name, value }) => [name, value]), [
      ['A_TOKEN', 'fixture-a-token-0001'],
      ['PROD_TOKEN', 'fixture-prod-token-0001'],
      ['B_TOKEN', 'fixture-b-token-0001'],
      ['BRACKET', 'plain-fixture-task-bracket'],
      ['T0', 'plain-fixture-task-0'],
      ['T1', 'plain-fixture-task-1'],
      ['T2', 'plain-fixture-task-2'],
      ['T3', 'plain-fixture-task-3'],
      ['T4', 'plain-fixture-task-4'],
    ])
    assert.deepEqual(warnings, [])
    await assertTempDirsGone(home)
  })

  test('names a failed file-task key, keeps the rest and warns outside the project', async () => {
    const { home, env } = await fixture({
      ...listed,
      'b/.mise/tasks/deploy': '#MISE env={D_TOKEN={age="fixture-missing"}}\n',
    })
    const warnings: string[] = []
    const secrets = await load(home, env, 'plain', warnings)
    assert.deepEqual(secrets.map(({ name }) => name), ['A_TOKEN', 'PROD_TOKEN', 'B_TOKEN'])
    assert.deepEqual(warnings, [
      `${home}/b/.mise/tasks/deploy failed: cannot decrypt task env keys D_TOKEN: mise env did not output them`,
    ])
  })

  test('fails with the loaded secrets when a file task inside the project fails', async () => {
    const { home, env } = await fixture({
      ...listed,
      'c/mise-tasks/deploy': '#MISE env={D_TOKEN={age="fixture-undecryptable"}}\n',
      'c/mise-tasks/bad': '#MISE env={X=\n',
    })
    const warnings: string[] = []
    await assert.rejects(load(home, env, 'c/sub', warnings), (error: unknown) => {
      assert.ok(error instanceof PartialLoadError)
      assert.equal(
        error.message,
        [
          `${home}/c/mise-tasks/bad failed: #MISE env header is not valid TOML`,
          `${home}/c/mise-tasks/deploy failed: cannot decrypt task env keys D_TOKEN: mise env exited with code 1`,
        ]
          .join('; '),
      )
      assert.deepEqual(error.secrets.map(({ name }) => name), ['A_TOKEN', 'PROD_TOKEN', 'B_TOKEN'])
      return true
    })
    assert.deepEqual(warnings, [])
    await assertTempDirsGone(home)
  })

  test('applies to a project with only file-task age keys, without drift', async () => {
    const { home, env } = await fixture({
      ...listed,
      'c/.config/mise/tasks/dev': '# [MISE] env={C_TOKEN={age="fixture-task-c"}}\n',
    })
    assert.equal(await miseSource('mise', '~/list', env).appliesTo({ cwd: join(home, 'c/sub') }), true)
    assert.equal(await miseSource('mise', '~/list', env).appliesTo({ cwd: join(home, 'plain') }), false)
    const warnings: string[] = []
    const secrets = await load(home, env, 'c/sub', warnings)
    assert.deepEqual(secrets.at(-1), { name: 'C_TOKEN', value: 'plain-fixture-task-c', source: 'mise' })
    assert.deepEqual(warnings, [])
  })
})

async function assertTempDirsGone(home: string): Promise<void> {
  const dirs = (await readFile(join(home, 'temp-dirs'), 'utf8')).trim().split('\n')
  assert.ok(dirs.length > 0)
  for (const dir of dirs) await assert.rejects(access(dir), { code: 'ENOENT' })
}
