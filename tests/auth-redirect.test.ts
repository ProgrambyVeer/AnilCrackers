import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  googleProviderDisabledMessage,
  isGoogleProviderEnabled,
  parsePublicSiteUrl,
  resolveOAuthRedirect,
} from '../src/lib/auth-redirect'

const production = 'https://anil-crackers.vercel.app'
const previewDeployment = 'https://anil-crackers-60lpbsmg7-iamveerangouda-2989.vercel.app'

describe('Google OAuth redirect destination', () => {
  it('returns production sign-ins to the production /vendor and /admin portals', () => {
    expect(resolveOAuthRedirect({ role: 'vendor', currentOrigin: production, isDev: false })).toBe(`${production}/vendor`)
    expect(resolveOAuthRedirect({ role: 'superadmin', currentOrigin: production, isDev: false })).toBe(`${production}/admin`)
  })

  it('sends sign-ins started on a preview deployment to the configured canonical origin', () => {
    expect(resolveOAuthRedirect({ role: 'vendor', currentOrigin: previewDeployment, isDev: false, configuredSiteUrl: production }))
      .toBe(`${production}/vendor`)
    expect(resolveOAuthRedirect({ role: 'vendor', currentOrigin: previewDeployment, isDev: false, configuredSiteUrl: `${production}/some/path?x=1#h` }))
      .toBe(`${production}/vendor`)
  })

  it('falls back to the current origin when no valid canonical origin is configured', () => {
    for (const configured of [undefined, '', '   ', 'https://YOUR_PRODUCTION_DOMAIN', 'not a url', 'http://anil-crackers.vercel.app', 'javascript:alert(1)', 'https://user:pass@evil.example']) {
      expect(resolveOAuthRedirect({ role: 'vendor', currentOrigin: production, isDev: false, configuredSiteUrl: configured })).toBe(`${production}/vendor`)
    }
  })

  it('keeps local development on the local Vite origin even if a production origin is configured', () => {
    expect(resolveOAuthRedirect({ role: 'vendor', currentOrigin: 'http://localhost:5173', isDev: true, configuredSiteUrl: production }))
      .toBe('http://localhost:5173/vendor')
    expect(resolveOAuthRedirect({ role: 'superadmin', currentOrigin: 'http://127.0.0.1:5173', isDev: true }))
      .toBe('http://127.0.0.1:5173/admin')
  })

  it('accepts only https origins, or http for local hosts', () => {
    expect(parsePublicSiteUrl(' https://anilcrackers.teranode1.com/ ')).toBe('https://anilcrackers.teranode1.com')
    expect(parsePublicSiteUrl('http://localhost:4173')).toBe('http://localhost:4173')
    expect(parsePublicSiteUrl('http://example.com')).toBeNull()
    expect(parsePublicSiteUrl('ftp://example.com')).toBeNull()
  })

  it('never derives the redirect from hardcoded deployment URLs or the current path', () => {
    const app = readFileSync('src/App.tsx', 'utf8')
    expect(app).not.toMatch(/vercel\.app/)
    expect(app).not.toMatch(/redirectTo:\s*`\$\{window\.location\.origin\}\$\{location\.pathname\}`/)
    expect(app).toMatch(/redirectTo: resolveOAuthRedirect\(\{\s*role,\s*currentOrigin: window\.location\.origin,\s*isDev: import\.meta\.env\.DEV,\s*configuredSiteUrl: import\.meta\.env\.VITE_PUBLIC_SITE_URL,/)
    expect(app).toContain("provider: 'google'")
    expect(readFileSync('.env.example', 'utf8')).toContain('VITE_PUBLIC_SITE_URL=https://YOUR_PRODUCTION_DOMAIN')
  })
})

describe('Google provider availability check', () => {
  const ok = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))

  it('reports a disabled Google provider from the public settings endpoint', async () => {
    const fetchImpl = vi.fn(() => ok({ external: { google: false, email: true } }))
    await expect(isGoogleProviderEnabled('https://abcdefghijk.supabase.co/', 'public-key', fetchImpl as unknown as typeof fetch)).resolves.toBe(false)
    expect(fetchImpl).toHaveBeenCalledWith('https://abcdefghijk.supabase.co/auth/v1/settings', { headers: { apikey: 'public-key' } })
  })

  it('reports an enabled provider and never blocks sign-in when the status is unknown', async () => {
    await expect(isGoogleProviderEnabled('https://x.supabase.co', 'k', (() => ok({ external: { google: true } })) as unknown as typeof fetch)).resolves.toBe(true)
    await expect(isGoogleProviderEnabled('https://x.supabase.co', 'k', (() => ok({})) as unknown as typeof fetch)).resolves.toBeNull()
    await expect(isGoogleProviderEnabled('https://x.supabase.co', 'k', (() => Promise.resolve(new Response('', { status: 500 }))) as unknown as typeof fetch)).resolves.toBeNull()
    await expect(isGoogleProviderEnabled('https://x.supabase.co', 'k', (() => Promise.reject(new Error('offline'))) as unknown as typeof fetch)).resolves.toBeNull()
  })

  it('stops before redirecting only when Google is definitely disabled and keeps real Google OAuth', () => {
    const app = readFileSync('src/App.tsx', 'utf8')
    expect(app).toMatch(/if \(googleEnabled === false\) throw new Error\(googleProviderDisabledMessage\)/)
    expect(googleProviderDisabledMessage).toMatch(/Supabase Authentication settings/)
    expect(app).not.toMatch(/service_role|SERVICE_ROLE|GOOGLE_CLIENT_SECRET/)
  })
})
