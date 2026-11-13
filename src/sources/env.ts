import { existsSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'

import type { Secret, SecretSource } from '../sources.ts'

const SECRET_NAME = /KEY|TOKEN|SECRET|PASS|PRIVATE|MNEMONIC|DATABASE_URL|AUTH|CREDENTIAL|DSN/i
const DENIED_NAMES = new Set(['SSH_AUTH_SOCK', 'KITTY_PUBLIC_KEY', 'XAUTHORITY', 'PASSWORD_STORE_DIR'])
const DATABASE_URL_NAME = /DATABASE_URL/i
const MISE_STATE_NAMES = new Set(['__MISE_DIFF', '__MISE_SESSION'])

function isCredentialFreeUrl(value: string): boolean {
  const url = URL.parse(value)
  return url !== null && url.host !== '' && url.username === '' && url.password === '' && url.search === ''
    && !/[;#]/.test(value)
}

function isSkippedPath(entry: string, home: string | undefined): boolean {
  const hasHome = home !== undefined && isAbsolute(home)
  if (hasHome && entry.startsWith('~/')) return true
  if (hasHome && home !== '/' && entry.startsWith(join(home, '/'))) return true
  return entry.startsWith('/') && existsSync(entry)
}

function isPathList(value: string, home: string | undefined): boolean {
  return value.split(':').every((entry) => isSkippedPath(entry, home))
}

function isSecret(name: string, value: string, home: string | undefined): boolean {
  if (MISE_STATE_NAMES.has(name)) return true
  if (!SECRET_NAME.test(name) || DENIED_NAMES.has(name) || name.startsWith('GUM_')) return false
  if (isPathList(value, home)) return false
  return !(DATABASE_URL_NAME.test(name) && isCredentialFreeUrl(value))
}

export function envSource(env: NodeJS.ProcessEnv, id = 'env'): SecretSource {
  return {
    id,
    appliesTo: async () => true,
    load: async () => {
      const secrets: Secret[] = []
      for (const [name, value] of Object.entries(env))
        if (value && isSecret(name, value, env['HOME'])) secrets.push({ name, value, source: id })
      return secrets
    },
  }
}
