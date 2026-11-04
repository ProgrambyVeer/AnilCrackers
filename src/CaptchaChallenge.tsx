import { useEffect, useRef, useState } from 'react'
import { translate } from './lib/i18n'
import type { Language } from './types'

export type CaptchaProvider = 'turnstile' | 'hcaptcha'
type CaptchaApi = {
  render: (element: HTMLElement, options: Record<string, unknown>) => string | number
  remove: (id: string | number) => void
}

declare global {
  interface Window {
    turnstile?: CaptchaApi
    hcaptcha?: CaptchaApi
    anilTurnstileReady?: () => void
    anilHcaptchaReady?: () => void
  }
}

const loaders: Partial<Record<CaptchaProvider, Promise<CaptchaApi>>> = {}

function loadCaptcha(provider: CaptchaProvider): Promise<CaptchaApi> {
  const api = window[provider]
  if (api) return Promise.resolve(api)
  const existing = loaders[provider]
  if (existing) return existing
  const callback = provider === 'turnstile' ? 'anilTurnstileReady' : 'anilHcaptchaReady'
  const source = provider === 'turnstile' ? 'https://challenges.cloudflare.com/turnstile/v0/api.js' : 'https://js.hcaptcha.com/1/api.js'
  const promise = new Promise<CaptchaApi>((resolve, reject) => {
    const script = document.createElement('script')
    const timer = window.setTimeout(() => fail(), 15_000)
    function fail() {
      window.clearTimeout(timer)
      delete window[callback]
      script.remove()
      delete loaders[provider]
      reject(new Error('CAPTCHA script unavailable'))
    }
    window[callback] = () => {
      window.clearTimeout(timer)
      delete window[callback]
      const loaded = window[provider]
      if (loaded) resolve(loaded)
      else fail()
    }
    script.src = `${source}?render=explicit&onload=${callback}`
    script.async = true
    script.onerror = fail
    document.head.appendChild(script)
  })
  loaders[provider] = promise
  return promise
}

export function CaptchaChallenge({ provider, sitekey, language, onToken }: {
  provider: CaptchaProvider
  sitekey: string
  language: Language
  onToken: (token: string) => void
}) {
  const container = useRef<HTMLDivElement>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let active = true
    let widget: { api: CaptchaApi; id: string | number } | undefined
    onToken('')
    void loadCaptcha(provider).then((api) => {
      if (!active || !container.current) return
      const invalidate = () => { if (active) onToken('') }
      widget = {
        api,
        id: api.render(container.current, {
          sitekey, size: 'compact', ...(provider === 'turnstile' ? { language } : { hl: language }),
          callback: (token: string) => { if (active) { setFailed(false); onToken(token) } },
          'expired-callback': invalidate,
          'error-callback': () => { if (active) { invalidate(); setFailed(true) } },
        }),
      }
    }).catch(() => {
      if (active) { setFailed(true); onToken('') }
    })
    return () => {
      active = false
      if (widget) widget.api.remove(widget.id)
    }
  }, [provider, sitekey, language, onToken])
  return <div>
    <div ref={container} aria-label={translate(language, 'captchaRequired')} />
    {failed ? <p className="form-error" role="alert">{translate(language, 'captchaUnavailable')}</p> : null}
  </div>
}
