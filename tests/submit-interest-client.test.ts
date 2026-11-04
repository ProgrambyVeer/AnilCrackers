import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FunctionsHttpError } from '@supabase/supabase-js'

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('../src/lib/supabase', () => ({
  requireSupabase: () => ({ functions: { invoke } }),
}))

const input = {
  customer_name: 'Asha Rao', customer_phone: '9876543210', captcha_token: 'test-token',
  items: [{ product_id: '60cc3b95-0847-4e52-aad8-dc32244b3f1c', quantity: 2 }],
}

beforeEach(() => {
  vi.resetModules()
  vi.resetAllMocks()
  vi.stubEnv('VITE_INTEREST_SUBMISSION_ENABLED', 'true')
  vi.stubEnv('VITE_CAPTCHA_PROVIDER', 'turnstile')
  vi.stubEnv('VITE_CAPTCHA_SITE_KEY', 'test-public-site-key')
})

describe('customer Edge Function client', () => {
  it('does not contact any endpoint when submissions are disabled or unconfigured', async () => {
    vi.stubEnv('VITE_INTEREST_SUBMISSION_ENABLED', 'false')
    const { submitProtectedInterest } = await import('../src/lib/submit-interest')
    await expect(submitProtectedInterest(input)).rejects.toThrow('submission_unavailable')
    expect(invoke).not.toHaveBeenCalled()
  })

  it('submits only to the Edge Function and uses its destination, without opening WhatsApp', async () => {
    invoke.mockResolvedValue({ data: { reference_code: 'AC-1234ABCD', whatsapp_number: '919876543211' }, error: null })
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    const { submitProtectedInterest } = await import('../src/lib/submit-interest')
    expect(await submitProtectedInterest(input)).toEqual({ reference_code: 'AC-1234ABCD', whatsapp_number: '919876543211' })
    expect(invoke).toHaveBeenCalledWith('submit-interest', { body: input })
    expect(open).not.toHaveBeenCalled()
    open.mockRestore()
  })

  it('rejects malformed or missing server destinations instead of falling back to shop settings', async () => {
    invoke.mockResolvedValue({ data: { reference_code: 'AC-1234ABCD', whatsapp_number: '+12025550100' }, error: null })
    const { submitProtectedInterest } = await import('../src/lib/submit-interest')
    await expect(submitProtectedInterest(input)).rejects.toThrow('submitError')
  })

  it('surfaces CAPTCHA/rate-limit failures without treating them as successful submissions', async () => {
    invoke.mockResolvedValue({
      data: null, error: new FunctionsHttpError(new Response(JSON.stringify({ error: 'rate_limited' }), { status: 429 })),
    })
    const { submitProtectedInterest } = await import('../src/lib/submit-interest')
    await expect(submitProtectedInterest(input)).rejects.toThrow('rate_limited')
  })
})
