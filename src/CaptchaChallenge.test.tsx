import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CaptchaChallenge } from './CaptchaChallenge'

afterEach(() => {
  cleanup()
  delete window.turnstile
  delete window.hcaptcha
})

describe('provider-neutral CAPTCHA widget', () => {
  it.each(['turnstile', 'hcaptcha'] as const)('renders %s and clears expired tokens', async (provider) => {
    const token = vi.fn()
    const remove = vi.fn()
    const renderWidget = vi.fn<(element: HTMLElement, options: Record<string, unknown>) => string>(() => 'widget-id')
    window[provider] = { render: renderWidget, remove }
    const component = render(<CaptchaChallenge provider={provider} sitekey="public-test-key" language="en" onToken={token} />)
    await waitFor(() => expect(renderWidget).toHaveBeenCalledOnce())
    const options = renderWidget.mock.calls[0][1]
    const callback = options.callback
    const expire = options['expired-callback']
    if (typeof callback !== 'function' || typeof expire !== 'function') {
      throw new Error('CAPTCHA callbacks were not supplied')
    }
    act(() => callback('test-token'))
    expect(token).toHaveBeenLastCalledWith('test-token')
    act(() => expire())
    expect(token).toHaveBeenLastCalledWith('')
    component.unmount()
    expect(remove).toHaveBeenCalledWith('widget-id')
  })

  it('shows a localized error and invalidates the token when rendering fails', async () => {
    const token = vi.fn()
    window.turnstile = { render: () => { throw new Error('test widget failure') }, remove: vi.fn() }
    render(<CaptchaChallenge provider="turnstile" sitekey="public-test-key" language="kn" onToken={token} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('ಭದ್ರತಾ ಪರಿಶೀಲನೆ ಲಭ್ಯವಿಲ್ಲ')
    expect(token).toHaveBeenLastCalledWith('')
  })
})
