import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { createMatcher } from '../src/matcher.ts'

const PREFIXES = ['sk-ant-', 'ghp_', 'github_pat_', 'AKIA', 'xox[bp]-']
const OPTIONS = { prefixes: PREFIXES, minValueLength: 8 }

const HEX_KEY = 'ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12'

describe('createMatcher', () => {
  test('redacts exact values with the secret name', () => {
    const { redact } = createMatcher([{ name: 'API_TOKEN', value: 'fixture-token-0001' }], OPTIONS)
    assert.equal(redact('token=fixture-token-0001;'), 'token=[REDACTED:API_TOKEN];')
  })

  test('prefers the longest value when one contains another', () => {
    const { redact } = createMatcher([
      { name: 'SHORT', value: 'fixture-abcd' },
      { name: 'LONG', value: 'fixture-abcd-efgh' },
    ], OPTIONS)
    assert.equal(redact('fixture-abcd-efgh fixture-abcd'), '[REDACTED:LONG] [REDACTED:SHORT]')
  })

  test('ignores values under minValueLength with a warning naming the key', () => {
    const { redact, warnings } = createMatcher([{ name: 'PIN', value: 'short' }], OPTIONS)
    assert.equal(redact('pin is short'), 'pin is short')
    assert.equal(warnings.length, 1)
    assert.match(warnings[0] ?? '', /PIN/)
  })

  test('redacts hex with and without 0x, lower and upper case', () => {
    const { redact } = createMatcher([{ name: 'PRIVATE_KEY', value: `0x${HEX_KEY}` }], OPTIONS)
    for (const form of [`0x${HEX_KEY}`, HEX_KEY, HEX_KEY.toUpperCase(), `0x${HEX_KEY.toUpperCase()}`])
      assert.equal(redact(`k=${form}`), 'k=[REDACTED:PRIVATE_KEY]', form)
  })

  test('redacts a bare hex value that appears with 0x', () => {
    const { redact } = createMatcher([{ name: 'PRIVATE_KEY', value: HEX_KEY }], OPTIONS)
    assert.equal(redact(`0x${HEX_KEY}`), '[REDACTED:PRIVATE_KEY]')
  })

  test('redacts URL path and userinfo parts', () => {
    const { redact } = createMatcher([
      { name: 'RPC_URL', value: 'https://eth.example.test/v2/fixtureRpcKey0001' },
      { name: 'DATABASE_URL', value: 'postgres://fixtureuser0001:fixture%40pass@db.example.test/app' },
    ], OPTIONS)
    assert.equal(redact('key fixtureRpcKey0001'), 'key [REDACTED:RPC_URL]')
    assert.equal(redact('user fixtureuser0001'), 'user [REDACTED:DATABASE_URL]')
    assert.equal(redact('pass fixture@pass'), 'pass [REDACTED:DATABASE_URL]')
    assert.equal(redact('pass fixture%40pass'), 'pass [REDACTED:DATABASE_URL]')
    assert.equal(redact('/v2/ path'), '/v2/ path')
  })

  test('redacts percent-encoded values', () => {
    const { redact } = createMatcher([{ name: 'DB_PASSWORD', value: 'fix@ture/pa+ss' }], OPTIONS)
    assert.equal(redact('url=fix%40ture%2Fpa%2Bss'), 'url=[REDACTED:DB_PASSWORD]')
    assert.equal(redact('url=fix%40ture%2fpa%2bss'), 'url=[REDACTED:DB_PASSWORD]')
  })

  test('redacts whole vendor-prefixed tokens', () => {
    const { redact } = createMatcher([], OPTIONS)
    const tokens = {
      'sk-ant-': 'sk-ant-api03-FIXTUREfixture0001',
      ghp_: 'ghp_FIXTUREfixture0000000000000000001',
      github_pat_: 'github_pat_11FIXTURE_fixture0001',
      AKIA: 'AKIAFIXTURE0000001',
      'xoxb-': 'xoxb-1111-2222-fixture',
      'xoxp-': 'xoxp-3333-4444-fixture',
    }
    for (const [prefix, token] of Object.entries(tokens))
      assert.equal(redact(`a ${token} b`), `a [REDACTED:${prefix}] b`, token)
  })

  test('leaves bare prefixes and prefixes inside words alone', () => {
    const { redact } = createMatcher([], OPTIONS)
    assert.equal(redact('tokens start with ghp_ or AKIA'), 'tokens start with ghp_ or AKIA')
    assert.equal(redact('XAKIAFIXTURE0000001'), 'XAKIAFIXTURE0000001')
  })

  test('walks every string in nested objects and arrays without mutating input', () => {
    const { redact } = createMatcher([{ name: 'API_TOKEN', value: 'fixture-token-0001' }], OPTIONS)
    const input = {
      content: [{ type: 'text', text: 'fixture-token-0001' }],
      details: { diff: ['- old', '+ fixture-token-0001'], count: 2, ok: true, none: null },
    }
    assert.deepEqual(redact(input), {
      content: [{ type: 'text', text: '[REDACTED:API_TOKEN]' }],
      details: { diff: ['- old', '+ [REDACTED:API_TOKEN]'], count: 2, ok: true, none: null },
    })
    assert.equal(input.content[0]?.text, 'fixture-token-0001')
  })

  test('redacts multi-line and quote-containing values inside a nested payload', () => {
    const multiLine = 'fixture line one\nfixture line two'
    const quoted = 'fix"ture\'quoted\\value'
    const { redact } = createMatcher([
      { name: 'MNEMONIC', value: multiLine },
      { name: 'QUOTED_SECRET', value: quoted },
    ], OPTIONS)
    const payload = { messages: [{ role: 'user', content: [{ text: `a ${multiLine} b ${quoted} c` }] }] }
    const out = JSON.stringify(redact(payload))
    assert.ok(out.includes('a [REDACTED:MNEMONIC] b [REDACTED:QUOTED_SECRET] c'))
    assert.ok(!out.includes('fixture line'))
    assert.ok(!out.includes('quoted'))
  })

  test('leaves web3 values untouched', () => {
    const { redact } = createMatcher([{ name: 'PRIVATE_KEY', value: `0x${HEX_KEY}` }], OPTIONS)
    const web3 = [
      '0x88df016429689c079f3b2f6ad39fa052532c56795b733da78a91ebe6a713944b',
      '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      '0x0000000000000000000000000000000000000000000000000000000000000000',
      '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc',
    ]
    for (const value of web3) assert.equal(redact(value), value)
  })

  describe('fragments', () => {
    const SECRET = 'Fx7qLm2Rt9Vw4Kp8Zs3Nb6Hd1Jc5Yg0Ue'
    const VENDOR_SECRET = 'sk-ant-' + 'api03Fx7qLm2Rt9Vw4Kp8Zs3Nb6Hd1Jc5Yg0UeQa'

    test('redacts prefix, suffix and middle chunks of at least 12 chars', () => {
      const { redact } = createMatcher([{ name: 'API_TOKEN', value: SECRET }], OPTIONS)
      for (const chunk of [SECRET.slice(0, 20), SECRET.slice(-20), SECRET.slice(8, 20), SECRET.slice(5, 29)])
        assert.equal(redact(`out ${chunk} end`), 'out [REDACTED:API_TOKEN] end', chunk)
    })

    test('redacts the suffix of a vendor-prefixed secret with its name', () => {
      const { redact } = createMatcher([{ name: 'ANTHROPIC_API_KEY', value: VENDOR_SECRET }], OPTIONS)
      assert.equal(redact(`k=${VENDOR_SECRET.slice(-20)}`), 'k=[REDACTED:ANTHROPIC_API_KEY]')
    })

    test('redacts every wrapped line of at least 12 chars', () => {
      const { redact } = createMatcher([{ name: 'ANTHROPIC_API_KEY', value: VENDOR_SECRET }], OPTIONS)
      const lines = VENDOR_SECRET.match(/.{1,16}/g) ?? []
      const expected = lines.map((line) => (line.length >= 12 ? '[REDACTED:ANTHROPIC_API_KEY]' : line))
      assert.equal(redact(lines.join('\n')), expected.join('\n'))
      assert.ok(lines.filter((line) => line.length >= 12).length >= 2)
    })

    test('leaves base64 and reversed values alone (deliberate leaks, out of scope)', () => {
      const { redact } = createMatcher([{ name: 'API_TOKEN', value: SECRET }], OPTIONS)
      const base64 = Buffer.from(SECRET).toString('base64')
      const reversed = [...SECRET].reverse().join('')
      assert.equal(redact(base64), base64)
      assert.equal(redact(reversed), reversed)
    })

    test('leaves text sharing fewer than 12 chars with a secret alone', () => {
      const { redact } = createMatcher([{ name: 'API_TOKEN', value: SECRET }], OPTIONS)
      const text = `${SECRET.slice(0, 11)}!${SECRET.slice(11, 22)}`
      assert.equal(redact(text), text)
    })

    test('ignores runs that span whitespace inside a secret', () => {
      const pem = '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n-----END PRIVATE KEY-----'
      const { redact } = createMatcher([{ name: 'TLS_KEY', value: pem }], OPTIONS)
      assert.equal(redact('-----BEGIN PRIVATE KEY-----'), '-----BEGIN PRIVATE KEY-----')
      assert.equal(redact('MIIEvQIBADANBgkq'), '[REDACTED:TLS_KEY]')
    })

    describe('URL-shaped secrets', () => {
      const RPC_URL = `https://eth.example.test:8545/v2/${SECRET}`
      const DATABASE_URL = 'postgres://fixtureuser0001:Qm7%40Zx4Vb9Lk2Wt6Rp8@localhost:5432/app'

      test('redacts a truncated secret-bearing path segment', () => {
        const { redact } = createMatcher([{ name: 'RPC_URL', value: RPC_URL }], OPTIONS)
        assert.equal(redact(`out ${SECRET.slice(0, 20)} end`), 'out [REDACTED:RPC_URL] end')
        assert.equal(redact(RPC_URL.slice(0, -4)), 'https://eth.example.test:8545/v2/[REDACTED:RPC_URL]')
      })

      test('redacts every wrapped line of a secret-bearing path segment', () => {
        const { redact } = createMatcher([{ name: 'RPC_URL', value: RPC_URL }], OPTIONS)
        const lines = SECRET.match(/.{1,16}/g) ?? []
        const expected = lines.map((line) => (line.length >= 12 ? '[REDACTED:RPC_URL]' : line))
        assert.equal(redact(lines.join('\n')), expected.join('\n'))
        assert.ok(lines.filter((line) => line.length >= 12).length >= 2)
      })

      test('redacts a truncated password in raw, decoded and either percent-encoded case', () => {
        const { redact } = createMatcher([{ name: 'DATABASE_URL', value: DATABASE_URL }], OPTIONS)
        for (const chunk of ['Qm7%40Zx4Vb9Lk', 'Qm7@Zx4Vb9Lk'])
          assert.equal(redact(`pass ${chunk} end`), 'pass [REDACTED:DATABASE_URL] end', chunk)
        const slashed = createMatcher(
          [{ name: 'DATABASE_URL', value: 'postgres://fixtureuser0001:Qm7%2FZx4Vb9Lk2Wt6Rp8@localhost:5432/app' }],
          OPTIONS,
        )
        assert.equal(slashed.redact('pass Qm7%2fZx4Vb9Lk2 end'), 'pass [REDACTED:DATABASE_URL] end')
      })

      test('redacts a truncated username', () => {
        const { redact } = createMatcher([{ name: 'DATABASE_URL', value: DATABASE_URL }], OPTIONS)
        assert.equal(redact('user fixtureuser00 end'), 'user [REDACTED:DATABASE_URL] end')
      })

      test('leaves lowercase word path segments and usernames alone', () => {
        const { redact } = createMatcher([
          { name: 'RPC_URL', value: `https://rpc.example.test/ethereum-mainnet/production_database/${SECRET}` },
          { name: 'GIT_URL', value: `https://x-access-token:${SECRET}@git.example.test/org/repo` },
        ], OPTIONS)
        for (const text of ['ethereum-mainnet', 'ethereum-mainly', 'production_database', 'x-access-token'])
          assert.equal(redact(text), text)
      })

      test('still redacts a full URL built from ordinary text', () => {
        const value = 'https://rpc.example.test/ethereum-mainnet'
        const { redact } = createMatcher([{ name: 'RPC_URL', value }], OPTIONS)
        assert.equal(redact(`url ${value} end`), 'url [REDACTED:RPC_URL] end')
      })

      test('redacts a token held in the username', () => {
        const value = `https://${SECRET}@git.example.test/org/repo`
        const { redact } = createMatcher([{ name: 'GIT_URL', value }], OPTIONS)
        assert.equal(redact(SECRET), '[REDACTED:GIT_URL]')
      })

      test('redacts a lowercase word password', () => {
        const value = 'postgres://app:correcthorsebattery@localhost:5432/app'
        const { redact } = createMatcher([{ name: 'DATABASE_URL', value }], OPTIONS)
        assert.equal(redact('correcthorsebattery'), '[REDACTED:DATABASE_URL]')
      })

      test('leaves a password equal to the username or scheme alone', () => {
        const { redact } = createMatcher([
          { name: 'SAME_USER', value: 'postgres://fixtureadmin:fixtureadmin@localhost:5432/app' },
          { name: 'SAME_SCHEME', value: 'postgres://postgres:postgres@localhost:5432/app' },
        ], OPTIONS)
        for (const text of ['fixtureadmin', 'the postgres docs']) assert.equal(redact(text), text)
      })

      test('leaves scheme, host, port and short path text alone', () => {
        const { redact } = createMatcher([
          { name: 'RPC_URL', value: RPC_URL },
          { name: 'DATABASE_URL', value: DATABASE_URL },
        ], OPTIONS)
        for (
          const text of [
            'https://eth.example.test:8545/v3/other',
            'https://eth.example.test:8545/v2/',
            'postgres://other@localhost:5432/app',
            'listening on localhost:5432',
          ]
        ) {
          assert.equal(redact(text), text)
        }
      })
    })

    test('keeps redaction time flat with 80 secrets of 50 chars', () => {
      const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
      let seed = 1
      const nextChar = () => {
        seed = (seed * 48271) % 2147483647
        return alphabet[seed % alphabet.length]
      }
      const secrets = Array.from({ length: 80 }, (_, index) => ({
        name: `SECRET_${index}`,
        value: Array.from({ length: 50 }, nextChar).join(''),
      }))
      const { redact } = createMatcher(secrets, OPTIONS)
      const text = `${'lorem ipsum dolor sit amet '.repeat(40_000)}${secrets[42]?.value.slice(10, 30)}`
      const start = performance.now()
      const out = redact(text)
      assert.ok(out.endsWith('[REDACTED:SECRET_42]'))
      assert.ok(performance.now() - start < 1000)
    })
  })

  test('returns input unchanged with an empty value set and no prefixes', () => {
    const { redact } = createMatcher([], { prefixes: [], minValueLength: 8 })
    assert.equal(redact('anything'), 'anything')
  })
})
