import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, test } from 'node:test'

import { parse } from 'smol-toml'

import { parseConfig } from '../src/config.ts'

const ROOT = join(import.meta.dirname, '..')
const DOCS = join(ROOT, 'docs/src/content/docs')
const TOML_BLOCK = /^```toml\n([\s\S]*?)^```$/gm
const env = { HOME: '/home/user' }

const pages = [
  join(ROOT, 'README.md'),
  ...readdirSync(DOCS).filter((name) => name.endsWith('.md')).map((name) => join(DOCS, name)),
]

describe('toml examples in README and docs', () => {
  for (const page of pages) {
    const blocks = [...readFileSync(page, 'utf8').matchAll(TOML_BLOCK)].map(([, body]) => body as string)
    for (const [index, block] of blocks.entries()) {
      test(`${page.slice(ROOT.length + 1)} block ${index + 1} passes the config validator`, () => {
        parseConfig(parse(block), env)
      })
    }
  }

  test('finds examples to check', () => {
    const count = pages.flatMap((page) => [...readFileSync(page, 'utf8').matchAll(TOML_BLOCK)]).length
    assert.ok(count >= 5)
  })
})
