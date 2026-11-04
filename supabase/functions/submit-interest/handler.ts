import { isIP } from 'node:net'

type Environment = (key: string) => string | undefined
type Fetch = typeof globalThis.fetch
type InterestInput = {
  customer_name: string
  customer_phone: string
  items: { product_id: string; quantity: number }[]
  captcha_token: string
}

class SubmissionError extends Error {
  constructor(readonly status: number, readonly code: string, readonly retryAfter?: number) {
    super(code)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function validateInput(value: unknown): InterestInput {
  if (!isRecord(value) || Object.keys(value).some((key) => !['customer_name', 'customer_phone', 'items', 'captcha_token'].includes(key))) {
    throw new SubmissionError(400, 'invalid_input')
  }
  const { customer_name: name, customer_phone: phone, items, captcha_token: token } = value
  if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 100) {
    throw new SubmissionError(400, 'invalid_input')
  }
  if (typeof phone !== 'string' || !/^\+?[0-9(][0-9() -]{8,22}$/.test(phone.trim())) {
    throw new SubmissionError(400, 'invalid_phone')
  }
  const digits = phone.replace(/\D/g, '')
  const mobile = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits
  if (!/^[6-9][0-9]{9}$/.test(mobile)) throw new SubmissionError(400, 'invalid_phone')
  if (typeof token !== 'string' || !token.trim() || token.length > 2048) {
    throw new SubmissionError(400, 'captcha_required')
  }
  if (!Array.isArray(items) || items.length < 1 || items.length > 30) throw new SubmissionError(400, 'invalid_items')
  const seen = new Set<string>()
  const cleanItems = items.map((item: unknown) => {
    if (!isRecord(item) || Object.keys(item).some((key) => !['product_id', 'quantity'].includes(key))
      || typeof item.product_id !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item.product_id)
      || typeof item.quantity !== 'number' || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 99) {
      throw new SubmissionError(400, 'invalid_items')
    }
    const id = item.product_id.toLowerCase()
    if (seen.has(id)) throw new SubmissionError(400, 'invalid_items')
    seen.add(id)
    return { product_id: id, quantity: item.quantity }
  })
  return { customer_name: name.trim(), customer_phone: `+91${mobile}`, items: cleanItems, captcha_token: token }
}

async function readJson(request: Request) {
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') {
    throw new SubmissionError(415, 'json_required')
  }
  if (!request.body) throw new SubmissionError(400, 'invalid_input')
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > 16_384) {
        await reader.cancel()
        throw new SubmissionError(413, 'request_too_large')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown
  } catch {
    throw new SubmissionError(400, 'invalid_input')
  }
}

function configuration(env: Environment) {
  const required = (key: string) => {
    const value = env(key)?.trim()
    if (!value || value.startsWith('YOUR_')) throw new SubmissionError(503, 'submission_unavailable')
    return value
  }
  if (env('INTEREST_SUBMISSION_ENABLED') !== 'true' || env('INTEREST_TRUSTED_IP_VERIFIED') !== 'true') {
    throw new SubmissionError(503, 'submission_unavailable')
  }
  const provider = required('INTEREST_CAPTCHA_PROVIDER')
  if (provider !== 'turnstile' && provider !== 'hcaptcha') throw new SubmissionError(503, 'submission_unavailable')
  const supabaseUrl = new URL(required('SUPABASE_URL'))
  if (supabaseUrl.protocol !== 'https:' && !['localhost', '127.0.0.1', 'kong'].includes(supabaseUrl.hostname)) {
    throw new SubmissionError(503, 'submission_unavailable')
  }
  const hashSecret = required('INTEREST_RATE_HASH_SECRET')
  const ipHeader = required('INTEREST_TRUSTED_IP_HEADER').toLowerCase()
  if (hashSecret.length < 32 || !/^[a-z0-9-]+$/.test(ipHeader)) throw new SubmissionError(503, 'submission_unavailable')
  const list = (key: string) => required(key).split(',').map((entry) => entry.trim()).filter(Boolean)
  return {
    provider,
    secret: required('INTEREST_CAPTCHA_SECRET'),
    sitekey: required('INTEREST_CAPTCHA_SITE_KEY'),
    hostnames: list('INTEREST_CAPTCHA_HOSTNAMES'),
    origins: list('INTEREST_ALLOWED_ORIGINS'),
    ipHeader,
    hashSecret,
    supabaseUrl: supabaseUrl.origin,
    serviceKey: required('SUPABASE_SERVICE_ROLE_KEY'),
  }
}

export function createInterestHandler(
  env: Environment,
  dependencies: { fetch?: Fetch; now?: () => number; log?: (code: string) => void } = {},
) {
  const fetcher = dependencies.fetch ?? globalThis.fetch
  const now = dependencies.now ?? Date.now
  const log = dependencies.log ?? ((code: string) => console.error(`submit-interest: ${code}`))
  return async (request: Request): Promise<Response> => {
    const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Origin' })
    const respond = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers })
    try {
      const config = configuration(env)
      const origin = request.headers.get('origin')
      if (!origin || !config.origins.includes(origin)) throw new SubmissionError(403, 'origin_denied')
      headers.set('Access-Control-Allow-Origin', origin)
      headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS')
      headers.set('Access-Control-Allow-Headers', 'authorization, apikey, content-type, x-client-info')
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
      if (request.method !== 'POST') throw new SubmissionError(405, 'method_not_allowed')

      const address = request.headers.get(config.ipHeader)?.trim() ?? ''
      const version = isIP(address)
      if (!version) throw new SubmissionError(503, 'client_address_unavailable')
      const ip = version === 6 ? new URL(`http://[${address}]/`).hostname : address
      const input = validateInput(await readJson(request))
      const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(config.hashSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
      const hash = async (value: string) => {
        const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))
        return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
      }
      const rpc = async (name: string, body: unknown): Promise<unknown> => {
        const response = await fetcher(`${config.supabaseUrl}/rest/v1/rpc/${name}`, {
          method: 'POST',
          headers: { apikey: config.serviceKey, Authorization: `Bearer ${config.serviceKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(10_000),
          redirect: 'error',
        })
        if (!response.ok) {
          // Do not log upstream bodies: they may contain customer data or secrets.
          if (name === 'submit_interest' && response.status === 400) throw new SubmissionError(400, 'invalid_submission')
          throw new SubmissionError(503, 'database_unavailable')
        }
        return response.json()
      }
      const limit = await rpc('consume_interest_rate_limit', {
        p_ip_hash: await hash(`ip:${ip}`),
        p_phone_hash: await hash(`phone:${input.customer_phone}`),
      })
      if (!isRecord(limit) || typeof limit.allowed !== 'boolean'
        || !Number.isInteger(limit.retry_after) || typeof limit.retry_after !== 'number' || limit.retry_after < 0 || limit.retry_after > 3600) {
        throw new SubmissionError(503, 'database_unavailable')
      }
      if (!limit.allowed) throw new SubmissionError(429, 'rate_limited', Math.max(1, limit.retry_after))

      const endpoint = config.provider === 'turnstile'
        ? 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
        : 'https://api.hcaptcha.com/siteverify'
      const form = new URLSearchParams({ secret: config.secret, response: input.captcha_token, remoteip: address })
      if (config.provider === 'hcaptcha') form.set('sitekey', config.sitekey)
      const verification = await fetcher(endpoint, {
        method: 'POST', body: form, signal: AbortSignal.timeout(10_000), redirect: 'error',
      })
      if (!verification.ok) throw new SubmissionError(503, 'captcha_unavailable')
      const result: unknown = await verification.json()
      if (!isRecord(result) || result.success !== true || typeof result.hostname !== 'string'
        || !config.hostnames.includes(result.hostname) || typeof result.challenge_ts !== 'string') {
        throw new SubmissionError(403, 'captcha_failed')
      }
      const age = now() - Date.parse(result.challenge_ts)
      if (!Number.isFinite(age) || age < -30_000 || age > 300_000) throw new SubmissionError(403, 'captcha_failed')
      const claimed = await rpc('claim_interest_captcha', { p_token_hash: await hash(`captcha:${config.provider}:${input.captcha_token}`) })
      if (claimed === false) throw new SubmissionError(403, 'captcha_failed')
      if (claimed !== true) throw new SubmissionError(503, 'database_unavailable')
      const saved = await rpc('submit_interest', {
        p_customer_name: input.customer_name,
        p_customer_phone: input.customer_phone,
        p_items: input.items,
      })
      if (!isRecord(saved) || typeof saved.reference_code !== 'string' || !/^AC-[A-F0-9]{8}$/.test(saved.reference_code)
        || typeof saved.whatsapp_number !== 'string' || !/^91[6-9][0-9]{9}$/.test(saved.whatsapp_number)) {
        throw new SubmissionError(503, 'database_unavailable')
      }
      return respond(200, { reference_code: saved.reference_code, whatsapp_number: saved.whatsapp_number })
    } catch (error) {
      const failure = error instanceof SubmissionError ? error : new SubmissionError(503, 'submission_unavailable')
      if (failure.status >= 500) log(failure.code)
      if (failure.retryAfter) headers.set('Retry-After', String(failure.retryAfter))
      return respond(failure.status, { error: failure.code })
    }
  }
}
