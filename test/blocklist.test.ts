import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, test } from 'node:test'

import {
  checkBashPaths,
  checkCommand,
  checkFileUrl,
  checkPath,
  checkPlaceholders,
  checkSearchRoot,
  normalizePiPath,
  resolveBlockPaths,
} from '../src/blocklist.ts'

const COMMANDS = ['pa', 'gh auth token', 'mise env', 'cat .env*']

describe('checkCommand slash-bearing words', () => {
  const matches: [string, string, string][] = [
    ['cat secrets/prod.env', 'cat secrets/prod.env', 'literal slash entry'],
    ['kubectl get secret/app', 'kubectl get secret*', 'slash-free glob'],
    ['/usr/bin/pa show x', 'pa', 'basename head'],
    ['cat ./.env', 'cat .env*', 'basename arg'],
  ]
  for (const [command, entry, name] of matches)
    test(`blocks ${name}`, () => assert.ok(checkCommand(command, [entry])))

  test('allows unrelated slash path', () =>
    assert.equal(checkCommand('cat docs/readme.md', ['cat secrets/prod.env']), undefined))
})

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

describe('checkCommand line continuation', () => {
  const list = ['env', 'pa', 'gh auth token']
  const blocked = [
    'true && \\\nenv',
    'true | \\\nenv',
    'FOO=1 \\\nenv',
    'gh \\\nauth \\\ntoken',
    'echo $(\\\nenv)',
    'sh -c "true && \\\nenv"',
    'eval "true && \\\nenv"',
    'sh -c true\\\n&& env',
    'e\\\nnv',
    'ls; \\\n\\\n  pa show x',
  ]
  for (const command of blocked) {
    test(`blocks ${JSON.stringify(command)}`, () => {
      assert.ok(checkCommand(command, list))
    })
  }

  for (const command of ['ls \\\n-la', 'echo "a \\\nb"', "echo 'env \\\n'", 'true && \\\nls']) {
    test(`allows ${JSON.stringify(command)}`, () => {
      assert.equal(checkCommand(command, list), undefined)
    })
  }
})

describe('checkCommand comments', () => {
  const blocked = [
    "# Let's look\npa show x",
    '# say "hi\npa show x',
    'true # trailing\npa show x',
    '# ((\npa show x',
    "echo $(# it's\npa show x)",
    'echo $(\n# "x\npa show x\n)',
  ]
  for (const command of blocked) {
    test(`blocks ${JSON.stringify(command)}`, () => {
      assert.ok(checkCommand(command, COMMANDS))
    })
  }

  for (
    const command of ['echo a#b', 'echo $#', 'echo ${#x}', '# pa show x', 'ls # pa show x', 'cat <<EOF\n# pa\nEOF']
  ) {
    test(`allows ${JSON.stringify(command)}`, () => {
      assert.equal(checkCommand(command, COMMANDS), undefined)
    })
  }

  test('blocks pa after a ## word', () => {
    assert.ok(checkCommand('echo a#b; pa show x', COMMANDS))
  })

  test('a comment holding << is not an unterminated heredoc', () => {
    assert.equal(checkCommand('# cat <<EOF\nls', COMMANDS), undefined)
  })
})

describe('checkCommand redirections', () => {
  const blocked = [
    'env 2>&1 | grep KEY',
    'printenv 2>&1',
    'env 2>/dev/null | grep KEY',
    'env >&2',
    'nohup env 2>&1',
    'command env 2>&1',
    'env > file',
    'env &> out',
    'env &>> out',
    'env >> out',
    'env >| out',
    'env 2> err',
    'env <&0',
    '2>&1 env',
    '>out env',
    '</dev/null env',
    'env>out',
    'cat <.env',
    'cat< .env',
    '<.env cat',
    'cat 2>/dev/null .env',
    'cat .env 2>/dev/null',
    'cat >&.env',
    'cat < "$(pa s x)"',
  ]
  for (const command of blocked) {
    test(`blocks ${command}`, () => {
      assert.ok(checkCommand(command, [...COMMANDS, 'env', 'printenv']))
    })
  }

  for (
    const command of [
      'env FOO=1 ls 2>&1',
      'env FOO=1 ls >/dev/null',
      'ls 2>&1 | grep x',
      'echo a2>out',
      'ls &>out',
      'cat <(echo hi)',
      'diff <(echo a) >(cat)',
      'ls >',
    ]
  ) {
    test(`allows ${command}`, () => {
      assert.equal(checkCommand(command, [...COMMANDS, 'env', 'printenv']), undefined)
    })
  }

  test('a digit glued to a word is not an fd prefix', () => {
    assert.ok(checkCommand('pa2>out show x', ['pa2']))
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
    "cat <<'EOF'",
    'echo $((1 << 2))',
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
    "cat <<'EOF' |\npam s x\nEOF\nsh",
    `echo "$(cat <<'EOF'\npam s x\nEOF\n)" | sh`,
    "source /dev/stdin <<'EOF'\npam s x\nEOF",
    ". /dev/stdin <<'EOF'\npam s x\nEOF",
    `eval "$(cat <<'EOF'\npam s x\nEOF\n)"`,
    `bash -c "$(cat <<'EOF'\npam s x\nEOF\n)"`,
    '((y = 1 << 2))\nenv\n2',
    '(( $(pam s x) ))',
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
      join(home, 'link'),
      join(home, 'store'),
      join(home, 'missing/dir'),
    ])
  })

  test('throws on an unset variable', () => {
    assert.throws(() => resolveBlockPaths(['$NOPE/x'], env), /\$NOPE/)
  })

  for (const entry of ['$EMPTY/x', '${EMPTY}/x', '$EMPTY/', '${NOPE:-}/x', '${EMPTY:-}/x']) {
    test(`throws on ${entry}`, () => {
      assert.throws(() => resolveBlockPaths([entry], { ...env, EMPTY: '' }), /not set or empty/)
    })
  }

  test('throws on an empty HOME', () => {
    assert.throws(() => resolveBlockPaths(['/x'], { ...env, HOME: '' }), /HOME/)
  })

  test('uses the fallback of an unset or empty variable, expanding ~', () => {
    assert.deepEqual(resolveBlockPaths(['${NOPE:-~/store}/x', '${EMPTY:-/fallback}'], { ...env, EMPTY: '' }), [
      join(home, 'store/x'),
      '/fallback',
    ])
  })

  test('ignores the fallback of a set variable', () => {
    assert.deepEqual(resolveBlockPaths(['${PA_DIR:-/fallback}/x'], env), [
      join(home, 'link/x'),
      join(home, 'store/x'),
    ])
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

  describe('checkSearchRoot', () => {
    const cases: Array<[string | undefined, string, boolean]> = [
      [home, '/', true],
      ['~', '/', true],
      ['..', join(home, '.config/mise'), true],
      ['@' + join(home, '.config'), '/', true],
      ['.config', home, true],
      [undefined, home, true],
      [undefined, '/', true],
      ['link', home, false],
      ['store/sub', home, false],
      ['.config/mise/age.txt', home, false],
      ['storefront', home, false],
      [undefined, join(home, 'store'), false],
    ]
    for (const [arg, cwd, isBlocked] of cases) {
      test(`${isBlocked ? 'blocks' : 'allows'} ${arg ?? 'no path'} from ${cwd}`, () => {
        assert.equal(Boolean(checkSearchRoot(arg, cwd, blockPaths, home)), isBlocked)
      })
    }
  })

  describe('normalizePiPath', () => {
    const cases: Array<[string, string]> = [
      ['a\u00A0b\u3000c', 'a b c'],
      ['@x/y', 'x/y'],
      ['@@x', '@x'],
      ['@~/x', `${home}/x`],
      ['file:///a/b%20c', '/a/b c'],
      ['@file:///a', '/a'],
      ['file://%zz', 'file://%zz'],
      ['FILE:///a/b', '/a/b'],
      ['file://localhost/a', '/a'],
    ]
    for (const [arg, expected] of cases)
      test(`maps ${JSON.stringify(arg)}`, () => assert.equal(normalizePiPath(arg, home), expected))
  })

  describe('checkFileUrl', () => {
    for (const arg of ['file://%zz', 'file://remote/a', 'file:///a%2Fb', '@FILE://%zz'])
      test(`blocks ${arg}`, () => assert.match(checkFileUrl(arg, home) ?? '', /unparseable file URL/))
    for (const arg of ['file:///a', 'FILE://localhost/a', 'notes.md', 'xfile:%zz'])
      test(`allows ${arg}`, () => assert.equal(checkFileUrl(arg, home), undefined))
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

    describe('configured spelling of a symlinked entry', () => {
      const outside = realpathSync(mkdtempSync(join(tmpdir(), 'motus-out-')))
      after(() => rmSync(outside, { recursive: true }))
      mkdirSync(join(outside, 'dots/inner'), { recursive: true })
      writeFileSync(join(outside, 'dots/inner/secret'), 'fixture')
      writeFileSync(join(outside, 'file'), 'fixture')
      symlinkSync(join(outside, 'dots'), join(home, 'dots'))
      symlinkSync(join(outside, 'file'), join(home, 'filelink'))
      mkdirSync(join(home, 'mid'))
      symlinkSync(join(outside, 'dots/inner'), join(home, 'mid/inner'))
      const linked = resolveBlockPaths(['~/dots/inner/secret', '~/filelink', '~/mid/inner/secret', '~/dots'], env)
      const cases = [
        'cat ~/dots/inner/secret',
        'cat ~/filelink',
        'cat ~/mid/inner/secret',
        'cat ~/dots/inner',
        'cat $HOME/dots/inner/secret',
        'cat "${HOME}/filelink"',
        `cat ${home}/mid/inner/secret`,
        `cat ${outside}/file`,
        `cat ${outside}/dots/inner/secret`,
      ]
      for (const command of cases) {
        test(`blocks ${command}`, () => {
          assert.ok(checkBashPaths(command, linked, home))
        })
      }

      test('blocks the lexical home spelling when home is a symlink', () => {
        const alias = join(outside, 'home-alias')
        symlinkSync(home, alias)
        const aliased = resolveBlockPaths(['~/dots/inner/secret'], { HOME: alias })
        assert.ok(checkBashPaths(`cat ${alias}/dots/inner/secret`, aliased, alias))
        assert.ok(checkBashPaths('cat ~/dots/inner/secret', aliased, alias))
      })
    })

    test('allows unrelated paths', () => {
      assert.equal(checkBashPaths('cat ~/.config/mise/config.toml', blockPaths, home), undefined)
      assert.equal(checkBashPaths('ls ~/storefront ~/store-old', blockPaths, home), undefined)
    })
  })
})

describe('checkPlaceholders', () => {
  const loaded = new Set(['ALCHEMY_KEY'])
  const prefixes = ['sk-ant-', 'ghp_', 'github_pat_', 'AKIA', 'xox[bp]-']

  test('blocks a loaded name', () => {
    assert.match(checkPlaceholders('RPC=https://x/[REDACTED:ALCHEMY_KEY]', loaded, prefixes) ?? '', /ALCHEMY_KEY/)
  })

  test('blocks loaded names with a space, bracket or quote in JSON-escaped input', () => {
    for (const name of ['MY KEY', 'A]B', 'Q"UOTE', 'back\\slash']) {
      const input = JSON.stringify({ content: `x [REDACTED:${name}]` })
      assert.ok(checkPlaceholders(input, new Set([name]), prefixes), name)
    }
  })

  test('blocks a placeholder that is a bare prefix', () => {
    for (const name of ['ghp_', 'xoxb-', 'AKIA', 'xoxp-', 'sk-ant-'])
      assert.match(checkPlaceholders(`[REDACTED:${name}]`, loaded, prefixes) ?? '', /prefix/, name)
  })

  test('allows an unrelated name', () => {
    assert.equal(checkPlaceholders('see [REDACTED:OTHER]', loaded, prefixes), undefined)
    assert.equal(checkPlaceholders('see [REDACTED:ghp_x]', loaded, prefixes), undefined)
  })

  test('allows plain input', () => {
    assert.equal(checkPlaceholders('ALCHEMY_KEY=$ALCHEMY_KEY', loaded, prefixes), undefined)
  })

  test('allows everything with no names or prefixes', () => {
    assert.equal(checkPlaceholders('[REDACTED:ghp_]', new Set(), []), undefined)
  })
})
