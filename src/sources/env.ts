import type { Secret, SecretSource } from '../sources.ts'

const SECRET_NAME = /KEY|TOKEN|SECRET|PASS|PRIVATE|MNEMONIC|DATABASE_URL|AUTH|CREDENTIAL|DSN/i
const DENIED_NAMES = new Set(['SSH_AUTH_SOCK', 'KITTY_PUBLIC_KEY', 'XAUTHORITY', 'PASSWORD_STORE_DIR'])
const DATABASE_URL_NAME = /DATABASE_URL/i
const MISE_STATE_NAMES = new Set(['__MISE_DIFF', '__MISE_SESSION'])

function isCredentialFreeUrl(value: string): boolean {
  const url = URL.parse(value)
  return url !== null && url.host !== '' && url.username === '' && url.password === '' && url.search === ''
}

function isSecret(name: string, value: string): boolean {
  if (MISE_STATE_NAMES.has(name)) return true
  if (!SECRET_NAME.test(name) || DENIED_NAMES.has(name) || name.startsWith('GUM_')) return false
  return !(DATABASE_URL_NAME.test(name) && isCredentialFreeUrl(value))
}

export function envSource(env: NodeJS.ProcessEnv, id = 'env'): SecretSource {
  return {
    id,
    appliesTo: async () => true,
    load: async () => {
      const secrets: Secret[] = []
      for (const [name, value] of Object.entries(env))
        if (value && isSecret(name, value)) secrets.push({ name, value, source: id })
      return secrets
    },
  }
}
