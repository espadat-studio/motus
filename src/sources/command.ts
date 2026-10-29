import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import type { SecretSource } from '../sources.ts'

const run = promisify(execFile)
const BAD_OUTPUT = 'stdout is not a JSON object of string values'

export function commandSource(id: string, command: string): SecretSource {
  return {
    id,
    appliesTo: async () => true,
    load: async ({ cwd, signal }) => {
      const { stdout } = await run('sh', ['-c', command], { cwd, signal, maxBuffer: 16 * 1024 * 1024 }).catch(
        (error: { code?: unknown }) => {
          throw new Error(typeof error.code === 'number' ? `exited with code ${error.code}` : 'failed to run')
        },
      )
      let parsed: unknown
      try {
        parsed = JSON.parse(stdout)
      } catch {
        throw new Error(BAD_OUTPUT)
      }
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error(BAD_OUTPUT)
      return Object.entries(parsed).map(([name, value]) => {
        if (typeof value !== 'string') throw new Error(BAD_OUTPUT)
        return { name, value, source: id }
      })
    },
  }
}
