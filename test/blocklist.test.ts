import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, test } from 'node:test'

import {
  bashPathBlockReason,
  commandBlockReason,
  pathBlockReason,
  placeholderBlockReason,
  resolveBlockPaths,
} from '../src/blocklist.ts'

const COMMANDS = ['pa', 'gh auth token', 'mise env', 'cat .env*']

describe('commandBlockReason', () => {
  const blocked = [
    'pa show x',
    'echo $(pa s x)',
    'echo "$(pa s x)"',
    'echo `pa show x`',
    'sudo pa show x',
    "bash -c 'pa show x'",
    'sh -lc "pa show x"',
    'zsh -c "echo ok; pa show x"',
    "eval 'pa show x'",
    'PA_DIR=/x pa show y',
    'env FOO=1 pa show y',
    'nohup time command exec pa show x',
    'ls | xargs pa show',
    'true && pa show x',
    'false || pa show x',
    'true; pa show x',
    '(pa show x)',
    'if pa show x; then :; fi',
    '/usr/bin/pa show x',
    'gh auth token',
    'gh --hostname github.com auth token',
    'mise exec -- env',
    'cat .env.local',
    'cat -n .env',
  ]
  for (const command of blocked) {
    test(`blocks ${command}`, () => {
      assert.ok(commandBlockReason(command, COMMANDS))
    })
  }

  const allowed = [
    'npm run paint',
    'echo pa show x',
    'git commit -m "pa show x"',
    "echo 'pa show x'",
    'gh auth status',
    'mise run env-check',
    'cat README.md',
    'papa show',
  ]
  for (const command of allowed) {
    test(`allows ${command}`, () => {
      assert.equal(commandBlockReason(command, COMMANDS), undefined)
    })
  }

  test('reason names the entry', () => {
    assert.match(commandBlockReason('gh auth token', COMMANDS) ?? '', /"gh auth token"/)
  })
})

describe('paths', () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'motus-')))
  mkdirSync(join(home, '.config/mise'), { recursive: true })
  writeFileSync(join(home, '.config/mise/age.txt'), 'fixture')
  mkdirSync(join(home, 'store'))
  symlinkSync(join(home, 'store'), join(home, 'link'))
  const env = { HOME: home, PA_DIR: join(home, 'link') }
  const blockPaths = resolveBlockPaths(['~/.config/mise/age.txt', '$PA_DIR/', '${HOME}/missing/dir'], env)

  test('expands and resolves entries', () => {
    assert.deepEqual(blockPaths, [
      join(home, '.config/mise/age.txt'),
      join(home, 'store'),
      join(home, 'missing/dir'),
    ])
  })

  test('throws on an unset variable', () => {
    assert.throws(() => resolveBlockPaths(['$NOPE/x'], env), /\$NOPE/)
  })

  test('throws on a relative entry', () => {
    assert.throws(() => resolveBlockPaths(['rel/x'], env), /absolute/)
  })

  describe('pathBlockReason', () => {
    const cases: Array<[string, string, boolean]> = [
      ['~/.config/mise/age.txt', '/', true],
      ['age.txt', join(home, '.config/mise'), true],
      ['../mise/age.txt', join(home, '.config/x'), true],
      ['link/identities', home, true],
      ['store/sub/new-file', home, true],
      ['missing/dir/a/b', home, true],
      ['.config/mise/config.toml', home, false],
      ['storefront', home, false],
    ]
    for (const [arg, cwd, isBlocked] of cases) {
      test(`${isBlocked ? 'blocks' : 'allows'} ${arg} from ${cwd}`, () => {
        assert.equal(Boolean(pathBlockReason(arg, cwd, blockPaths, home)), isBlocked)
      })
    }
  })

  describe('bashPathBlockReason', () => {
    const blocked = [
      'cat ~/.config/mise/age.txt',
      'cat $HOME/.config/mise/age.txt',
      'cat "${HOME}/.config/mise/age.txt"',
      `cat ${home}/.config/mise/age.txt`,
      'ls ~/store/identities',
      "bash -c 'cat ~/.config/mise/age.txt'",
    ]
    for (const command of blocked) {
      test(`blocks ${command}`, () => {
        assert.ok(bashPathBlockReason(command, blockPaths, home))
      })
    }

    test('allows unrelated paths', () => {
      assert.equal(bashPathBlockReason('cat ~/.config/mise/config.toml', blockPaths, home), undefined)
    })
  })
})

describe('placeholderBlockReason', () => {
  const loaded = new Set(['ALCHEMY_KEY'])

  test('blocks a loaded name', () => {
    assert.match(placeholderBlockReason('RPC=https://x/[REDACTED:ALCHEMY_KEY]', loaded) ?? '', /ALCHEMY_KEY/)
  })

  test('allows an unloaded name', () => {
    assert.equal(placeholderBlockReason('see [REDACTED:OTHER]', loaded), undefined)
  })

  test('allows plain input', () => {
    assert.equal(placeholderBlockReason('ALCHEMY_KEY=$ALCHEMY_KEY', loaded), undefined)
  })
})
