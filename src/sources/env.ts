import type { Secret, SecretSource } from '../sources.ts'

const SECRET_NAME = /KEY|TOKEN|SECRET|PASS|PRIVATE|MNEMONIC|DATABASE_URL|AUTH|CREDENTIAL|DSN/i
const DENIED_NAMES = new Set(['SSH_AUTH_SOCK', 'KITTY_PUBLIC_KEY', 'XAUTHORITY', 'PASSWORD_STORE_DIR'])

export function envSource(env: NodeJS.ProcessEnv): SecretSource {
  return {
    id: 'env',
    appliesTo: async () => true,
    load: async () => {
      const secrets: Secret[] = []
      for (const [name, value] of Object.entries(env))
        if (value && SECRET_NAME.test(name) && !DENIED_NAMES.has(name)) secrets.push({ name, value, source: 'env' })
      return secrets
    },
  }
}
