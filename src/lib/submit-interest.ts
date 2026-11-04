import { FunctionsHttpError } from '@supabase/supabase-js'
import { requireSupabase } from './supabase'
import { normalizeIndianMobile } from './indian-mobile'

export const captchaProvider = import.meta.env.VITE_CAPTCHA_PROVIDER
export const captchaSitekey = import.meta.env.VITE_CAPTCHA_SITE_KEY ?? ''
export const protectedSubmissionEnabled = import.meta.env.VITE_INTEREST_SUBMISSION_ENABLED === 'true'
  && (captchaProvider === 'turnstile' || captchaProvider === 'hcaptcha') && Boolean(captchaSitekey)

type SubmissionResult = { reference_code: string; whatsapp_number: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export async function submitProtectedInterest(body: {
  customer_name: string
  customer_phone: string
  items: { product_id: string; quantity: number }[]
  captcha_token: string
}): Promise<SubmissionResult> {
  if (!protectedSubmissionEnabled) throw new Error('submission_unavailable')
  const { data, error } = await requireSupabase().functions.invoke<unknown>('submit-interest', { body })
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const failure: unknown = await error.context.json()
      if (isRecord(failure) && typeof failure.error === 'string') throw new Error(failure.error)
    }
    throw new Error('submitError')
  }
  if (!isRecord(data) || typeof data.reference_code !== 'string' || !/^AC-[A-F0-9]{8}$/.test(data.reference_code)
    || typeof data.whatsapp_number !== 'string' || normalizeIndianMobile(data.whatsapp_number) !== `+${data.whatsapp_number}`) {
    throw new Error('submitError')
  }
  return { reference_code: data.reference_code, whatsapp_number: data.whatsapp_number }
}
