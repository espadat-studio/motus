import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, test } from 'node:test'

import { DEFAULT_PREFIXES, parseConfig, readConfig } from '../src/config.ts'

describe('parseConfig', () => {
  test('fills defaults for an empty object', () => {
    const config = parseConfig({})
    assert.deepEqual(config.prefixes, DEFAULT_PREFIXES)
    assert.deepEqual(config.blockPaths, [])
    assert.deepEqual(config.blockCommands, [])
    assert.deepEqual(config.degradedAllowTools, [])
    assert.equal(config.minValueLength, 8)
    assert.deepEqual(config.claudeCode, { blockCommands: [] })
    assert.deepEqual(config.sources.map(({ source, required, timeoutMs }) => [source.id, required, timeoutMs]), [
      ['env', true, 10_000],
    ])
  })

  test('applies per-source required and timeoutMs', () => {
    const { sources } = parseConfig({
      sources: [{ type: 'env' }, { type: 'command', id: 'vault', command: 'true', required: false, timeoutMs: 500 }],
    })
    assert.deepEqual(sources.map(({ source, required, timeoutMs }) => [source.id, required, timeoutMs]), [
      ['env', true, 10_000],
      ['vault', false, 500],
    ])
  })

  test('always includes the env source', () => {
    const { sources } = parseConfig({ sources: [{ type: 'command', command: 'true' }] })
    assert.deepEqual(sources.map(({ source }) => source.id), ['env', 'command'])
  })

  test('accepts a 1password source with refs or fromEnv', () => {
    const { sources } = parseConfig({
      sources: [
        { type: '1password', refs: { API_TOKEN: 'op://dev/api/token' } },
        { type: '1password', id: 'op-env', fromEnv: true },
      ],
    })
    assert.deepEqual(sources.map(({ source }) => source.id), ['env', '1password', 'op-env'])
  })

  test('reads the claudeCode block', () => {
    assert.deepEqual(parseConfig({ claudeCode: { blockCommands: ['env'] } }).claudeCode, { blockCommands: ['env'] })
  })

  const invalid: [string, unknown, RegExp][] = [
    ['non-object', [], /config must be an object/],
    ['unknown top-level key', { blockPath: [] }, /unknown key "blockPath"/],
    ['non-string array', { blockCommands: ['pa', 1] }, /blockCommands must be an array of strings/],
    ['non-integer minValueLength', { minValueLength: 1.5 }, /minValueLength must be a positive integer/],
    ['sources not an array', { sources: {} }, /sources must be an array/],
    ['unknown source type', { sources: [{ type: 'vault' }] }, /sources\[0\].type "vault" is unknown/],
    ['unknown source key', { sources: [{ type: 'env', foo: 1 }] }, /sources\[0\] has unknown key "foo"/],
    ['non-boolean required', { sources: [{ type: 'env', required: 'no' }] }, /sources\[0\].required must be a boolean/],
    [
      'bad timeoutMs',
      { sources: [{ type: 'env', timeoutMs: 0 }] },
      /sources\[0\].timeoutMs must be a positive integer/,
    ],
    ['command without command', { sources: [{ type: 'command' }] }, /sources\[0\].command must be a non-empty string/],
    ['mise without listFile', { sources: [{ type: 'mise' }] }, /sources\[0\].listFile must be a non-empty string/],
    [
      '1password without refs or fromEnv',
      { sources: [{ type: '1password', refs: {} }] },
      /sources\[0\] needs refs or fromEnv: true/,
    ],
    ['1password with a non-op ref', {
      sources: [{ type: '1password', refs: { API_TOKEN: 'https://example.com' } }],
    }, /sources\[0\].refs.API_TOKEN must be an op:\/\/ reference/],
    ['1password with a bad ref name', {
      sources: [{ type: '1password', refs: { 'A\nB': 'op://dev/api/token' } }],
    }, /sources\[0\].refs key "A\\nB" is not a valid name/],
    ['1password with non-boolean fromEnv', {
      sources: [{ type: '1password', fromEnv: 'yes' }],
    }, /sources\[0\].fromEnv must be a boolean/],
    ['unknown claudeCode key', { claudeCode: { block: [] } }, /claudeCode has unknown key "block"/],
    ['duplicate source ids', {
      sources: [{ type: 'command', command: 'true' }, { type: 'command', command: 'true' }],
    }, /source id "command" is used more than once/],
    ['a non-env source taking the env id', {
      sources: [{ type: 'command', id: 'env', command: 'true' }],
    }, /source id "env" is used more than once/],
  ]
  for (const [label, raw, message] of invalid)
    test(`rejects ${label}`, () => assert.throws(() => parseConfig(raw), message))
})

describe('readConfig', () => {
  test('parses a config file', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'motus-')), 'config.json')
    await writeFile(path, JSON.stringify({ blockCommands: ['pa'] }))
    assert.deepEqual((await readConfig(path)).blockCommands, ['pa'])
  })

  test('rejects invalid JSON without echoing the file contents', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'motus-')), 'config.json')
    await writeFile(path, '{"fixture-not-json-0001')
    await assert.rejects(readConfig(path), (error: Error) => {
      assert.match(error.message, /config\.json is not valid JSON/)
      assert.doesNotMatch(error.message, /fixture-not-json-0001/)
      return true
    })
  })

  test('rejects a missing file', async () => {
    await assert.rejects(readConfig(join(tmpdir(), 'motus-missing', 'config.json')), /cannot read/)
  })
})
