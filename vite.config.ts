import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
import { isDatabaseConnectionString, isSecretKeyShaped } from './src/lib/supabase-config.ts'

// Every VITE_* value is inlined into the public bundle. Blank any value that looks like a
// database connection string or secret credential so it can never ship to the browser.
// Process environment variables take precedence over .env files in Vite's loadEnv.
// Vite re-runs this config in the same process on restart, so earlier blanking is undone first
// to let a corrected .env file take effect.
const STATE_KEY = '__anilCrackersEnvSafety'
type EnvSafetyState = Map<string, string | undefined>

function stripUnsafePublicEnv(mode: string) {
  const globalState = globalThis as typeof globalThis & { [STATE_KEY]?: EnvSafetyState }
  const state: EnvSafetyState = globalState[STATE_KEY] ?? new Map()
  globalState[STATE_KEY] = state
  for (const [name, original] of state) {
    if (original === undefined) delete process.env[name]
    else process.env[name] = original
  }
  state.clear()

  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const stripped: string[] = []
  for (const [name, value] of Object.entries(env)) {
    if (name === 'VITE_ENV_SAFETY_STRIPPED') continue
    if (isDatabaseConnectionString(value) || isSecretKeyShaped(value)) {
      state.set(name, process.env[name])
      process.env[name] = ''
      stripped.push(name)
      console.warn(`[env-safety] ${name} looks like a database connection string or secret credential; it was excluded from the browser bundle. Value not shown.`)
    }
  }
  // Only variable names are exposed so the app can explain why it is not connected.
  process.env.VITE_ENV_SAFETY_STRIPPED = stripped.join(',')
}

export default defineConfig(({ mode }) => {
  stripUnsafePublicEnv(mode)
  return {
    plugins: [react(), tailwindcss()],
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test-setup.ts'],
    },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
  }
})
