// @vitest-environment node
import { webcrypto } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createInterestHandler, validateInput } from '../supabase/functions/submit-interest/handler'

const now = Date.parse('2026-11-04T12:00:00Z')
const envValues: Record<string, string> = {
  INTEREST_SUBMISSION_ENABLED: 'true',
  INTEREST_TRUSTED_IP_VERIFIED: 'true',
  INTEREST_TRUSTED_IP_HEADER: 'x-test-trusted-ip',
  INTEREST_CAPTCHA_PROVIDER: 'turnstile',
  INTEREST_CAPTCHA_SECRET: 'test-only-captcha-secret',
  INTEREST_CAPTCHA_SITE_KEY: 'test-only-public-site-key',
  INTEREST_CAPTCHA_HOSTNAMES: 'catalogue.example.test',
  INTEREST_ALLOWED_ORIGINS: 'https://catalogue.example.test',
  INTEREST_RATE_HASH_SECRET: 'test-only-hashing-secret-at-least-32-characters',
  SUPABASE_URL: 'https://database.example.test',
  SUPABASE_SERVICE_ROLE_KEY: 'test-only-server-identity',
}
const body = {
  customer_name: 'Asha Rao', customer_phone: '+91 98765 43210', captcha_token: 'test-token',
  items: [{ product_id: '60cc3b95-0847-4e52-aad8-dc32244b3f1c', quantity: 2 }],
}
const captchaSuccess = { success: true, hostname: 'catalogue.example.test', challenge_ts: new Date(now - 1000).toISOString() }
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })

function request(value: unknown = body, extraHeaders: Record<string, string> = {}) {
  return new Request('https://edge.example.test/submit-interest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://catalogue.example.test', 'x-test-trusted-ip': '203.0.113.1', ...extraHeaders },
    body: JSON.stringify(value),
  })
}

function setup(overrides: Record<string, string> = {}) {
  const rpcBodies: Record<string, unknown>[] = []
  let captchaResult = captchaSuccess
  let allowed = true
  let claimed = true
  let databaseFailure = false
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    if (String(url).endsWith('/siteverify')) return json(captchaResult)
    if (databaseFailure) return json({ message: 'do not expose this upstream body' }, 500)
    if (String(url).endsWith('/consume_interest_rate_limit')) return json({ allowed, retry_after: allowed ? 0 : 60 })
    if (String(url).endsWith('/claim_interest_captcha')) return json(claimed)
    if (String(url).endsWith('/submit_interest')) {
      rpcBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      return json({ enquiry_id: 'private-id', reference_code: 'AC-1234ABCD', whatsapp_number: '919876543211' })
    }
    throw new Error('Unexpected mocked endpoint')
  })
  const log = vi.fn()
  const environment = { ...envValues, ...overrides }
  const handler = createInterestHandler((key) => environment[key], { fetch: fetcher, now: () => now, log })
  return {
    handler, fetcher, rpcBodies, log,
    setCaptcha: (value: typeof captchaSuccess) => { captchaResult = value },
    denyLimit: () => { allowed = false },
    denyReplay: () => { claimed = false },
    failDatabase: () => { databaseFailure = true },
  }
}

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto)
})

describe('Edge input validation', () => {
  it('normalizes names, phones and product IDs; accepts stock-independent quantities', () => {
    expect(validateInput({ ...body, customer_name: ' Asha Rao ', items: [{ ...body.items[0], quantity: 99 }] })).toEqual({
      ...body, customer_phone: '+919876543210', items: [{ ...body.items[0], quantity: 99 }],
    })
  })

  it.each(['abc9876543210', '1234567890', '+1 202 555 0100', '', '9876543210<script>'])('rejects invalid phone %s', (phone) => {
    expect(() => validateInput({ ...body, customer_phone: phone })).toThrow('invalid_phone')
  })

  it.each([0, -1, 100, 1.5, '2', null])('rejects invalid quantity %s', (quantity) => {
    expect(() => validateInput({ ...body, items: [{ ...body.items[0], quantity }] })).toThrow('invalid_items')
  })

  it('rejects duplicate items, overlong lists and missing CAPTCHA', () => {
    expect(() => validateInput({ ...body, items: [body.items[0], body.items[0]] })).toThrow()
    expect(() => validateInput({ ...body, items: Array.from({ length: 31 }, () => body.items[0]) })).toThrow()
    expect(() => validateInput({ ...body, captcha_token: '' })).toThrow('captcha_required')
  })

  it('rejects client-supplied vendor IDs, destinations and unexpected item fields', () => {
    expect(() => validateInput({ ...body, vendor_id: 'attacker' })).toThrow()
    expect(() => validateInput({ ...body, whatsapp_number: '919999999999' })).toThrow()
    expect(() => validateInput({ ...body, items: [{ ...body.items[0], vendor_id: 'attacker' }] })).toThrow()
  })
})

describe('protected interest handler', () => {
  it('fails closed until enabled and fully configured', async () => {
    for (const overrides of [
      { INTEREST_SUBMISSION_ENABLED: 'false' }, { INTEREST_TRUSTED_IP_VERIFIED: 'false' },
      { INTEREST_CAPTCHA_SECRET: '' }, { INTEREST_RATE_HASH_SECRET: '' }, { INTEREST_CAPTCHA_PROVIDER: 'unknown' },
      { INTEREST_CAPTCHA_SECRET: 'YOUR_SERVER_CAPTCHA_SECRET' },
    ]) {
      const { handler, fetcher } = setup(overrides)
      expect((await handler(request())).status).toBe(503)
      expect(fetcher).not.toHaveBeenCalled()
    }
  })

  it('rejects unapproved origins and missing or spoofed forwarding chains', async () => {
    const { handler, fetcher } = setup()
    expect((await handler(request(body, { Origin: 'https://attacker.example.test' }))).status).toBe(403)
    expect((await handler(request(body, { 'x-test-trusted-ip': '' }))).status).toBe(503)
    expect((await handler(request(body, { 'x-test-trusted-ip': '203.0.113.1, 203.0.113.2' }))).status).toBe(503)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('supports CORS preflight without submitting anything', async () => {
    const { handler, fetcher } = setup()
    const response = await handler(new Request('https://edge.example.test', { method: 'OPTIONS', headers: { Origin: 'https://catalogue.example.test' } }))
    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://catalogue.example.test')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('bounds actual request bytes rather than trusting Content-Length', async () => {
    const { handler, fetcher } = setup()
    expect((await handler(request({ ...body, customer_name: 'A'.repeat(17000) }))).status).toBe(413)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('rejects invalid input without calling the database or CAPTCHA provider', async () => {
    const { handler, fetcher } = setup()
    expect((await handler(request({ ...body, customer_phone: 'invalid' }))).status).toBe(400)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it.each([
    { ...captchaSuccess, success: false },
    { ...captchaSuccess, hostname: 'attacker.example.test' },
    { ...captchaSuccess, challenge_ts: new Date(now - 301000).toISOString() },
    { ...captchaSuccess, challenge_ts: 'invalid' },
  ])('does not create enquiries when CAPTCHA verification fails (%j)', async (result) => {
    const test = setup()
    test.setCaptcha(result)
    expect((await test.handler(request())).status).toBe(403)
    expect(test.rpcBodies).toHaveLength(0)
    expect(test.fetcher).toHaveBeenCalledTimes(2)
  })

  it('fails closed on CAPTCHA network outages', async () => {
    const test = setup()
    test.fetcher.mockImplementationOnce(async () => json({ allowed: true, retry_after: 0 }))
      .mockImplementationOnce(async () => { throw new Error('secret upstream message') })
    const response = await test.handler(request())
    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain('secret upstream')
    expect(test.rpcBodies).toHaveLength(0)
    expect(test.log).toHaveBeenCalledWith('submission_unavailable')
  })

  it('stops repeated submissions when the shared limiter denies them', async () => {
    const test = setup()
    expect((await test.handler(request())).status).toBe(200)
    test.denyLimit()
    const response = await test.handler(request())
    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('60')
    expect(test.rpcBodies).toHaveLength(1)
  })

  it('rejects reused CAPTCHA tokens before enquiry creation', async () => {
    const test = setup()
    test.denyReplay()
    expect((await test.handler(request())).status).toBe(403)
    expect(test.rpcBodies).toHaveLength(0)
  })

  it('fails closed if the shared database limiter is unavailable', async () => {
    const test = setup()
    test.failDatabase()
    const response = await test.handler(request())
    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain('upstream body')
    expect(test.rpcBodies).toHaveLength(0)
  })

  it('uses only the server identity and returns only the server-derived reference and destination', async () => {
    const test = setup()
    const response = await test.handler(request(body, { Authorization: 'Bearer attacker-token' }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ reference_code: 'AC-1234ABCD', whatsapp_number: '919876543211' })
    expect(test.rpcBodies).toEqual([{
      p_customer_name: 'Asha Rao', p_customer_phone: '+919876543210', p_items: body.items,
    }])
    for (const [url, options] of test.fetcher.mock.calls) {
      if (String(url).includes('/rest/v1/')) {
        expect(new Headers(options?.headers).get('Authorization')).toBe(`Bearer ${envValues.SUPABASE_SERVICE_ROLE_KEY}`)
      }
    }
    const limitBody = JSON.parse(String(test.fetcher.mock.calls[0][1]?.body)) as Record<string, string>
    expect(limitBody.p_phone_hash).toMatch(/^[a-f0-9]{64}$/)
    expect(limitBody.p_ip_hash).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.stringify(limitBody)).not.toContain('9876543210')
  })

  it('uses the hCaptcha adapter and binds verification to the configured site key', async () => {
    const test = setup({ INTEREST_CAPTCHA_PROVIDER: 'hcaptcha' })
    expect((await test.handler(request())).status).toBe(200)
    const [url, options] = test.fetcher.mock.calls[1]
    expect(url).toBe('https://api.hcaptcha.com/siteverify')
    expect(new URLSearchParams(String(options?.body)).get('sitekey')).toBe(envValues.INTEREST_CAPTCHA_SITE_KEY)
  })
})
