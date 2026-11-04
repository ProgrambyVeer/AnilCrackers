import type { SyntheticEvent } from 'react'

export type CatalogueIssue = 'not-configured' | 'schema-missing' | 'permission-denied' | 'network' | 'unknown'

export const fallbackProductImage = 'https://images.unsplash.com/photo-1498931299472-f7a63a5a1cfa?auto=format&fit=crop&w=800&q=80'

function errorField(error: unknown, field: 'code' | 'message') {
  if (typeof error !== 'object' || error === null) return ''
  const value = (error as Record<string, unknown>)[field]
  return typeof value === 'string' ? value : ''
}

/** Maps Supabase/PostgREST failures to a stable category without exposing raw server output. */
export function classifyCatalogueError(error: unknown): CatalogueIssue {
  const code = errorField(error, 'code')
  const message = errorField(error, 'message')
  if (message.startsWith('Supabase is not configured')) return 'not-configured'
  // PGRST205: relation missing from the PostgREST schema cache; 42P01: undefined table; PGRST202: missing function.
  if (code === 'PGRST205' || code === '42P01' || code === 'PGRST202' || /schema cache/i.test(message)) return 'schema-missing'
  if (code === '42501' || code === 'PGRST301' || /permission denied/i.test(message)) return 'permission-denied'
  if (/failed to fetch|networkerror|network request failed|load failed/i.test(message)) return 'network'
  return 'unknown'
}

/** Diagnostic text for developers and authenticated staff; never shown to public customers in production. */
export function describeCatalogueIssue(issue: CatalogueIssue) {
  switch (issue) {
    case 'not-configured':
      return 'Supabase is not configured, so no live catalogue can be loaded.'
    case 'schema-missing':
      return 'Supabase is connected, but the platform database objects are missing. Apply migrations 001–004 in supabase/migrations to this project, then reload.'
    case 'permission-denied':
      return 'Supabase rejected the request. Check that the catalogue view grants and Row Level Security policies from the migrations are installed.'
    case 'network':
      return 'Supabase could not be reached. Check the network connection and VITE_SUPABASE_URL.'
    case 'unknown':
      return 'The catalogue could not be loaded from Supabase.'
  }
}

export function staffErrorMessage(cause: unknown, fallback: string) {
  const issue = classifyCatalogueError(cause)
  if (issue === 'schema-missing' || issue === 'not-configured') return describeCatalogueIssue(issue)
  return cause instanceof Error ? cause.message : errorField(cause, 'message') || fallback
}

export function productImageSrc(url: string | null | undefined) {
  const trimmed = url?.trim()
  return trimmed ? trimmed : fallbackProductImage
}

/** Swaps a broken product image for the fallback once, avoiding an error loop if the fallback also fails. */
export function applyImageFallback(event: SyntheticEvent<HTMLImageElement>) {
  const image = event.currentTarget
  if (image.dataset.fallbackApplied) return
  image.dataset.fallbackApplied = 'true'
  image.src = fallbackProductImage
}
