import type { UserRole } from '../types'

export const staffPortalPath: Record<UserRole, '/vendor' | '/admin'> = {
  vendor: '/vendor',
  superadmin: '/admin',
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * Parses the optional canonical production origin (VITE_PUBLIC_SITE_URL).
 * Only an https origin (or a local http origin) is accepted; any path, query or hash is discarded.
 */
export function parsePublicSiteUrl(value: string | undefined | null): string | null {
  const trimmed = value?.trim()
  if (!trimmed || /YOUR_/i.test(trimmed)) return null
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return null
  }
  if (parsed.username || parsed.password) return null
  const local = LOCAL_HOSTS.has(parsed.hostname)
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && local)) return null
  return parsed.origin
}

/**
 * Production uses the configured canonical site origin when present, so sign-ins started from a
 * per-deployment preview URL still return to the production domain. Development always returns to
 * the local Vite origin. The path is fixed per role and never taken from the current URL.
 */
export function resolveOAuthRedirect(options: {
  role: UserRole
  currentOrigin: string
  isDev: boolean
  configuredSiteUrl?: string | null
}): string {
  const path = staffPortalPath[options.role]
  const canonical = options.isDev ? null : parsePublicSiteUrl(options.configuredSiteUrl)
  return `${canonical ?? options.currentOrigin}${path}`
}

/**
 * Reads the public GoTrue settings endpoint to learn whether the Google provider is enabled.
 * Returns null when the status cannot be determined, so sign-in is never blocked by a failed probe.
 */
export async function isGoogleProviderEnabled(
  supabaseUrl: string,
  publicKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean | null> {
  try {
    const response = await fetchImpl(`${supabaseUrl.replace(/\/+$/, '')}/auth/v1/settings`, {
      headers: { apikey: publicKey },
    })
    if (!response.ok) return null
    const settings = (await response.json()) as { external?: Record<string, unknown> }
    const google = settings.external?.google
    return typeof google === 'boolean' ? google : null
  } catch {
    return null
  }
}

export const googleProviderDisabledMessage =
  'Google sign-in is not enabled for this site yet. The administrator must enable the Google provider in Supabase Authentication settings.'
