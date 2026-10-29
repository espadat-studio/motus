import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, test } from 'node:test'

import { checkBashPaths, checkCommand, checkPath, checkPlaceholders, resolveBlockPaths } from '../src/blocklist.ts'

const COMMANDS = ['pa', 'gh auth token', 'mise env', 'cat .env*']

describe('checkCommand', () => {
  const blocked = [
    'pa show x',
    'echo $(pa s x)',
    'echo "$(pa s x)"',
    'echo `pa show x`',
    'sudo pa show x',
    'sudo -u root pa show x',
    'xargs -I {} pa show {}',
    'sh -c -- "pa show x"',
    'echo "$(pa show x',
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
    'cat ./.env',
  ]
  for (const command of blocked) {
    test(`blocks ${command}`, () => {
      assert.ok(checkCommand(command, COMMANDS))
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
      assert.equal(checkCommand(command, COMMANDS), undefined)
    })
  }

  test('reason names the entry', () => {
    assert.match(checkCommand('gh auth token', COMMANDS) ?? '', /"gh auth token"/)
  })

  for (const command of ['env', 'env FOO=1', 'env -u X', 'sudo env', 'true && env | sort']) {
    test(`blocks wrapper run as the command: ${command}`, () => {
      assert.ok(checkCommand(command, ['env']))
    })
  }

  test('allows env as a wrapper of an unblocked command', () => {
    assert.equal(checkCommand('env FOO=1 ls', ['env']), undefined)
  })
})

describe('checkCommand heredocs', () => {
  const HEREDOC_COMMANDS = ['env', 'pam']
  const body = '`env` and $(pam s x)\n'
  const tricky = "it's `env`, $(pam s x) (sic\n"

  const allowed = [
    `cat <<'EOF'\n${body}EOF`,
    `cat <<"EOF"\n${body}EOF\necho done`,
    `cat <<\\EOF\n${body}EOF`,
    `cat <<-'EOF'\n${body}\tEOF`,
    `gh issue comment 1 --body "$(cat <<'EOF'\n${body}EOF\n)"`,
    `gh issue comment 1 --body "$(cat <<'EOF'\n${tricky}EOF\n)" && echo ok`,
    `cat <<'A' <<'B'\n${body}A\n${body}B`,
    'cat <<EOF\nplain text\nEOF',
    'cat <<<"$HOME"',
  ]
  for (const command of allowed) {
    test(`allows ${JSON.stringify(command)}`, () => {
      assert.equal(checkCommand(command, HEREDOC_COMMANDS), undefined)
    })
  }

  const blocked = [
    'cat <<EOF\n`env`\nEOF',
    'cat <<-EOF\n$(pam s x)\n\tEOF',
    'echo "$(cat <<EOF\n$(pam s x)\nEOF\n)"',
    "cat <<'EOF' | sh\npam s x\nEOF",
    "bash <<'EOF'\npam s x\nEOF",
    "sudo sh -s <<'EOF'\npam s x\nEOF",
    "cat <<'A' <<B\nsafe\nA\n`env`\nB",
    "cat <<'EOF'\nsafe\nEOF\nenv",
    `echo "$(cat <<'EOF'\n${tricky}EOF\n)"; env`,
    "cat <<'EOF'\npam s x",
    'echo "$(cat <<EOF\nsafe\n)"',
  ]
  for (const command of blocked) {
    test(`blocks ${JSON.stringify(command)}`, () => {
      assert.ok(checkCommand(command, HEREDOC_COMMANDS))
    })
  }

  test('reason names the unterminated delimiter', () => {
    assert.match(checkCommand("cat <<'EOF'\nx", HEREDOC_COMMANDS) ?? '', /unterminated heredoc "EOF"/)
  })
})

describe('paths', () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'motus-')))
  mkdirSync(join(home, '.config/mise'), { recursive: true })
  writeFileSync(join(home, '.config/mise/age.txt'), 'fixture')
  mkdirSync(join(home, 'store'))
  symlinkSync(join(home, 'store'), join(home, 'link'))
  const env = { HOME: home, PA_DIR: join(home, 'link') }
  after(() => rmSync(home, { recursive: true }))
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

  test('uses the fallback of an unset or empty variable, expanding ~', () => {
    assert.deepEqual(resolveBlockPaths(['${NOPE:-~/store}/x', '${EMPTY:-/fallback}'], { ...env, EMPTY: '' }), [
      join(home, 'store/x'),
      '/fallback',
    ])
  })

  test('ignores the fallback of a set variable', () => {
    assert.deepEqual(resolveBlockPaths(['${PA_DIR:-/fallback}/x'], env), [join(home, 'store/x')])
  })

  test('throws on a relative entry', () => {
    assert.throws(() => resolveBlockPaths(['rel/x'], env), /absolute/)
  })

  describe('checkPath', () => {
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
        assert.equal(Boolean(checkPath(arg, cwd, blockPaths, home)), isBlocked)
      })
    }
  })

  describe('checkBashPaths', () => {
    const blocked = [
      'cat ~/.config/mise/age.txt',
      'cat $HOME/.config/mise/age.txt',
      'cat "${HOME}/.config/mise/age.txt"',
      `cat ${home}/.config/mise/age.txt`,
      'ls ~/store/identities',
      'cat "$HOME"/.config/mise/age.txt',
      "bash -c 'cat ~/.config/mise/age.txt'",
    ]
    for (const command of blocked) {
      test(`blocks ${command}`, () => {
        assert.ok(checkBashPaths(command, blockPaths, home))
      })
    }

    test('allows unrelated paths', () => {
      assert.equal(checkBashPaths('cat ~/.config/mise/config.toml', blockPaths, home), undefined)
      assert.equal(checkBashPaths('ls ~/storefront ~/store-old', blockPaths, home), undefined)
    })
  })
})

describe('checkPlaceholders', () => {
  const loaded = new Set(['ALCHEMY_KEY'])

  test('blocks a loaded name', () => {
    assert.match(checkPlaceholders('RPC=https://x/[REDACTED:ALCHEMY_KEY]', loaded) ?? '', /ALCHEMY_KEY/)
  })

  test('allows an unloaded name', () => {
    assert.equal(checkPlaceholders('see [REDACTED:OTHER]', loaded), undefined)
  })

  test('allows plain input', () => {
    assert.equal(checkPlaceholders('ALCHEMY_KEY=$ALCHEMY_KEY', loaded), undefined)
  })
})
