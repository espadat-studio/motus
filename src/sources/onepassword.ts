import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { promisify } from 'node:util'

import type { Secret, SecretSource } from '../sources.ts'

const run = promisify(execFile)
const REF = /^op:\/\/[^\n{}]+$/
const NAME = /^[A-Za-z_]\w*$/
const BAD_OUTPUT = 'op inject output does not match the template'

export function isOnePasswordRef(value: string): boolean {
  return REF.test(value)
}

export function isSecretName(name: string): boolean {
  return NAME.test(name)
}

export function onePasswordSource(
  id: string,
  refs: Readonly<Record<string, string>>,
  fromEnv: boolean,
  env: NodeJS.ProcessEnv,
): SecretSource {
  return {
    id,
    appliesTo: async () => true,
    load: async ({ signal }) => {
      const entries = Object.entries(refs)
      if (fromEnv) {
        for (const [name, value] of Object.entries(env)) {
          if (!value?.startsWith('op://') || !isSecretName(name)) continue
          if (Object.hasOwn(refs, name)) throw new Error(`${name} is set in both refs and env`)
          if (!isOnePasswordRef(value)) throw new Error(`env ${name} is not a valid op:// reference`)
          entries.push([name, value])
        }
      }
      if (entries.length === 0) return []
      const marker = `<<motus-${randomBytes(16).toString('hex')}>>`
      const template = entries.map(([name, ref]) => `${marker}${name}\n{{ ${ref} }}\n`).join('')
      const listed = entries.map(([name, ref]) => `${name}=${ref}`).join(', ')
      const running = run('op', ['inject'], { env, signal, maxBuffer: 16 * 1024 * 1024 })
      running.child.stdin?.on('error', () => {})
      running.child.stdin?.end(template)
      const { stdout } = await running.catch((error: { code?: unknown }) => {
        throw new Error(
          typeof error.code === 'number'
            ? `op inject exited with code ${error.code} for ${listed}`
            : `op inject failed to run for ${listed}`,
        )
      })
      const chunks = (stdout.endsWith('\n') ? stdout : `${stdout}\n`).split(marker)
      if (chunks.shift() !== '' || chunks.length !== entries.length) throw new Error(BAD_OUTPUT)
      const secrets: Secret[] = []
      for (const [index, chunk] of chunks.entries()) {
        const name = (entries[index] as [string, string])[0]
        if (!chunk.startsWith(`${name}\n`) || !chunk.endsWith('\n')) throw new Error(BAD_OUTPUT)
        const value = chunk.slice(name.length + 1, -1)
        if (value) secrets.push({ name, value, source: id })
      }
      return secrets
    },
  }
}
