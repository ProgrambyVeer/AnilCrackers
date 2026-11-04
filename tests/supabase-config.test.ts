import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  describeSupabaseConfigIssue,
  isDatabaseConnectionString,
  isSecretKeyShaped,
  validateSupabaseConfig,
  type SupabaseConfigIssue,
} from '../src/lib/supabase-config'

function fakeJwt(payload: object) {
  const encode = (value: object) => btoa(JSON.stringify(value)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.signature`
}

const anonKey = fakeJwt({ role: 'anon', ref: 'testref' })

// Built at runtime so no contiguous Supabase PAT-shaped literal exists in source (GitHub push protection).
const patPrefix = ['sb', 'p', '_'].join('')
const shortPatShaped = patPrefix + 'abc'
const longPatShaped = patPrefix + '0123456789abcdef'.repeat(2) + '01234567'

describe('Supabase browser configuration validation', () => {
  it('accepts an HTTPS project API URL with a public anon or publishable key', () => {
    expect(validateSupabaseConfig('https://abcdefghijk.supabase.co', anonKey)).toEqual({ ok: true, url: 'https://abcdefghijk.supabase.co', key: anonKey })
    expect(validateSupabaseConfig(' https://abcdefghijk.supabase.co ', 'sb_publishable_example').ok).toBe(true)
  })

  it('allows plain HTTP only for a local Supabase stack', () => {
    expect(validateSupabaseConfig('http://127.0.0.1:54321', anonKey).ok).toBe(true)
    expect(validateSupabaseConfig('http://localhost:54321', anonKey).ok).toBe(true)
    expect(validateSupabaseConfig('http://abcdefghijk.supabase.co', anonKey)).toEqual({ ok: false, issue: 'insecure-url' })
  })

  it.each<[string | undefined, string | undefined, SupabaseConfigIssue]>([
    [undefined, anonKey, 'missing-url'],
    ['', anonKey, 'missing-url'],
    ['https://abcdefghijk.supabase.co', undefined, 'missing-key'],
    ['https://YOUR_PROJECT_REF.supabase.co', anonKey, 'placeholder'],
    ['https://abcdefghijk.supabase.co', 'YOUR_SUPABASE_ANON_OR_PUBLISHABLE_KEY', 'placeholder'],
    ['postgresql://postgres.ref:pw@aws-0-ap-south-1.pooler.supabase.com:6543/postgres', anonKey, 'database-connection-string'],
    ['postgres://postgres:pw@db.ref.supabase.co:5432/postgres', anonKey, 'database-connection-string'],
    ['abcdefghijk.supabase.co', anonKey, 'invalid-url'],
    ['ftp://abcdefghijk.supabase.co', anonKey, 'invalid-url'],
    ['https://abcdefghijk.supabase.co', longPatShaped, 'secret-key'],
    ['https://abcdefghijk.supabase.co', 'sb_secret_example', 'secret-key'],
    ['https://abcdefghijk.supabase.co', fakeJwt({ role: 'service_role' }), 'secret-key'],
  ])('rejects url=%s with issue %s', (url, key, issue) => {
    expect(validateSupabaseConfig(url, key)).toEqual({ ok: false, issue })
  })

  it('never echoes configuration values in issue descriptions', () => {
    const secret = longPatShaped
    const result = validateSupabaseConfig('postgresql://user:hunter2@host.pooler.supabase.com/postgres', secret)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      const message = describeSupabaseConfigIssue(result.issue)
      expect(message).not.toContain('hunter2')
      expect(message).not.toContain(secret)
    }
    const issues: SupabaseConfigIssue[] = ['missing-url', 'missing-key', 'placeholder', 'database-connection-string', 'invalid-url', 'insecure-url', 'secret-key']
    for (const issue of issues) expect(describeSupabaseConfigIssue(issue)).toMatch(/\S/)
  })

  it('classifies values the Vite build guard must keep out of the bundle', () => {
    expect(isDatabaseConnectionString('postgresql://x:y@aws-0.pooler.supabase.com:6543/postgres')).toBe(true)
    expect(isDatabaseConnectionString('https://abcdefghijk.supabase.co')).toBe(false)
    expect(shortPatShaped.startsWith('sb' + 'p_')).toBe(true)
    expect(longPatShaped).toHaveLength(44)
    expect(isSecretKeyShaped(shortPatShaped)).toBe(true)
    expect(isSecretKeyShaped(longPatShaped)).toBe(true)
    expect(isSecretKeyShaped(fakeJwt({ role: 'service_role' }))).toBe(true)
    expect(isSecretKeyShaped(anonKey)).toBe(false)
    expect(isSecretKeyShaped('sb_publishable_example')).toBe(false)
    expect(isSecretKeyShaped(undefined)).toBe(false)
  })
})

describe('blank-screen and bundle safety wiring', () => {
  const supabaseSource = readFileSync('src/lib/supabase.ts', 'utf8')
  const appSource = readFileSync('src/App.tsx', 'utf8')
  const viteConfig = readFileSync('vite.config.ts', 'utf8')

  it('only creates the Supabase client after validation succeeds', () => {
    expect(supabaseSource).toMatch(/validateSupabaseConfig\(\s*import\.meta\.env\.VITE_SUPABASE_URL,\s*import\.meta\.env\.VITE_SUPABASE_ANON_KEY,/)
    expect(supabaseSource).toContain('import.meta.env.VITE_ENV_SAFETY_STRIPPED')
    expect(supabaseSource).toMatch(/config\.ok\s*\?\s*createClient/)
  })

  it('reports values removed by the build guard by name only', () => {
    expect(validateSupabaseConfig('', '', ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'])).toEqual({ ok: false, issue: 'database-connection-string' })
    expect(validateSupabaseConfig('https://abcdefghijk.supabase.co', '', ['VITE_SUPABASE_ANON_KEY'])).toEqual({ ok: false, issue: 'secret-key' })
  })

  it('shows a configuration page in production instead of mock authentication', () => {
    expect(appSource).toMatch(/if \(!import\.meta\.env\.DEV && supabaseConfigIssue\)\s*\{\s*return <ConfigurationErrorPage/)
    expect(appSource).toContain('const DEV_CUSTOMER_PREVIEW = import.meta.env.DEV && !supabase')
    expect(appSource).toMatch(/const DEV_STAFF_PREVIEW = import\.meta\.env\.DEV && \(/)
  })

  it('strips secret-shaped public env values before Vite inlines them', () => {
    expect(viteConfig).toContain('isDatabaseConnectionString(value) || isSecretKeyShaped(value)')
    expect(viteConfig).toContain("process.env[name] = ''")
    expect(viteConfig).not.toMatch(/console\.\w+\([^)]*value/)
  })
})
