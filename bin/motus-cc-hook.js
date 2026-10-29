#!/usr/bin/env node
try {
  const { createJiti } = await import('jiti')
  const { main } = await createJiti(import.meta.url).import('../src/cc-hook.ts')
  await main()
} catch (error) {
  process.stderr.write(`motus-cc-hook: failing closed: ${error instanceof Error ? error.message : error}\n`)
  process.exit(2)
}
