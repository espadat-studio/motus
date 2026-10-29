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
      { name: 'DATABASE_URL', value: 'postgres://fixtureuser:fixture%40pass@db.example.test/app' },
    ], OPTIONS)
    assert.equal(redact('key fixtureRpcKey0001'), 'key [REDACTED:RPC_URL]')
    assert.equal(redact('user fixtureuser'), 'user [REDACTED:DATABASE_URL]')
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

  test('returns input unchanged with an empty value set and no prefixes', () => {
    const { redact } = createMatcher([], { prefixes: [], minValueLength: 8 })
    assert.equal(redact('anything'), 'anything')
  })
})
