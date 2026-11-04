export type SupabaseConfigIssue =
  | 'missing-url'
  | 'missing-key'
  | 'placeholder'
  | 'database-connection-string'
  | 'invalid-url'
  | 'insecure-url'
  | 'secret-key'

export type SupabaseConfigResult =
  | { ok: true; url: string; key: string }
  | { ok: false; issue: SupabaseConfigIssue }

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

export function isDatabaseConnectionString(value: string | undefined) {
  if (!value) return false
  const trimmed = value.trim()
  return /^postgres(ql)?:\/\//i.test(trimmed) || /pooler\.supabase\.com/i.test(trimmed)
}

function decodeJwtRole(token: string) {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const payload = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))) as { role?: unknown }
    return typeof payload.role === 'string' ? payload.role : null
  } catch {
    return null
  }
}

/** Personal access tokens, secret API keys and service-role JWTs must never reach browser code. */
export function isSecretKeyShaped(value: string | undefined) {
  if (!value) return false
  const trimmed = value.trim()
  return /^sbp_/i.test(trimmed) || /^sb_secret_/i.test(trimmed) || decodeJwtRole(trimmed) === 'service_role'
}

export function validateSupabaseConfig(rawUrl: string | undefined, rawKey: string | undefined, strippedNames: readonly string[] = []): SupabaseConfigResult {
  const url = rawUrl?.trim() ?? ''
  const key = rawKey?.trim() ?? ''

  if (strippedNames.includes('VITE_SUPABASE_URL')) return { ok: false, issue: 'database-connection-string' }
  if (!url) return { ok: false, issue: 'missing-url' }
  if (isDatabaseConnectionString(url)) return { ok: false, issue: 'database-connection-string' }
  if (/YOUR_/i.test(url)) return { ok: false, issue: 'placeholder' }

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { ok: false, issue: 'invalid-url' }
  }
  if (parsed.protocol === 'http:') {
    if (!LOCAL_HOSTS.has(parsed.hostname)) return { ok: false, issue: 'insecure-url' }
  } else if (parsed.protocol !== 'https:') {
    return { ok: false, issue: 'invalid-url' }
  }

  if (strippedNames.includes('VITE_SUPABASE_ANON_KEY')) return { ok: false, issue: 'secret-key' }
  if (!key) return { ok: false, issue: 'missing-key' }
  if (/YOUR_/i.test(key)) return { ok: false, issue: 'placeholder' }
  if (isSecretKeyShaped(key)) return { ok: false, issue: 'secret-key' }

  return { ok: true, url, key }
}

export function describeSupabaseConfigIssue(issue: SupabaseConfigIssue) {
  switch (issue) {
    case 'missing-url':
      return 'VITE_SUPABASE_URL is not set.'
    case 'missing-key':
      return 'VITE_SUPABASE_ANON_KEY is not set.'
    case 'placeholder':
      return 'The Supabase settings still contain YOUR_… placeholder values.'
    case 'database-connection-string':
      return 'VITE_SUPABASE_URL is a PostgreSQL connection string. Use the HTTPS project API URL (https://<project-ref>.supabase.co) from Project Settings → API.'
    case 'invalid-url':
      return 'VITE_SUPABASE_URL is not a valid HTTPS URL.'
    case 'insecure-url':
      return 'VITE_SUPABASE_URL must use HTTPS (plain HTTP is allowed only for localhost).'
    case 'secret-key':
      return 'VITE_SUPABASE_ANON_KEY is a secret credential (personal access token, secret key or service-role key). Use the public anon/publishable key and revoke the exposed credential.'
  }
}
