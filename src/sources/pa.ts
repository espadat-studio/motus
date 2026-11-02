import { spawn } from 'node:child_process'

import { PartialLoadError, type Secret, type SecretSource } from '../sources.ts'

export interface PaOptions {
  dir: string
  entries?: string[]
  minValueLength: number
  env: NodeJS.ProcessEnv
}

export function paSource(id: string, { dir, entries, minValueLength, env }: PaOptions): SecretSource {
  return {
    id,
    appliesTo: async () => true,
    load: async ({ cwd, signal }) => {
      const options = { cwd, signal, env: { ...env, PA_DIR: dir } }
      const names = entries ?? (await listEntries(dir, options))
      const secrets: Secret[] = []
      const failures: string[] = []
      for (const name of names) {
        let output: string
        try {
          output = await runPa(['show', name], options, `pa show "${name}"`)
        } catch (error) {
          if (signal.aborted) throw error
          failures.push((error as Error).message)
          continue
        }
        const lines = output
          .split(/\r?\n/)
          .filter((line) => line.trim() !== '' && line.length >= minValueLength)
        if (lines.length === 1) secrets.push({ name, value: lines[0] as string, source: id })
        else secrets.push(...lines.map((value, index) => ({ name: `${name}:${index + 1}`, value, source: id })))
      }
      if (failures.length > 0) throw new PartialLoadError(failures.join('; '), secrets)
      return secrets
    },
  }
}

async function listEntries(dir: string, options: RunOptions): Promise<string[]> {
  const names = (await runPa(['list'], options, 'pa list'))
    .split(/\r?\n/)
    .filter((name) => name !== '' && name.split('/').at(-1) !== 'meta')
  if (names.length === 0) throw new Error(`no entries in ${dir}`)
  return names
}

interface RunOptions {
  cwd: string
  signal: AbortSignal
  env: NodeJS.ProcessEnv
}

function runPa(args: string[], options: RunOptions, label: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('pa', args, { ...options, stdio: ['ignore', 'pipe', 'ignore'] })
    const chunks: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
    child.on('error', () => reject(new Error(`${label} failed to run`)))
    child.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(chunks).toString('utf8'))
      else reject(new Error(typeof code === 'number' ? `${label} exited with code ${code}` : `${label} was killed`))
    })
  })
}
