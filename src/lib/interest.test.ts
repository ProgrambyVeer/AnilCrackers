import { describe, expect, it } from 'vitest'
import { makeWhatsAppMessage, makeWhatsAppUrl, validateInterest, type InterestLine } from './interest'
import { translate } from './i18n'
import { clearInterestQuantities, CUSTOMER_INTEREST_STORAGE_KEY, parseInterestQuantities, serializeInterestQuantities, updateInterestQuantity } from './customer-interest'
import { getStockStatus, isValidStockValue } from './stock'
import type { Product } from '../types'

const product: Product = {
  id: '60cc3b95-0847-4e52-aad8-dc32244b3f1c',
  vendor_id: '00000000-0000-4000-8000-000000000001',
  name_en: 'Flower Pots',
  name_kn: 'ಹೂವಿನ ಕುಂಡಗಳು',
  description_en: 'Bright fountains',
  description_kn: 'ಬಣ್ಣದ ಚಿಮ್ಮುವ ಪಟಾಕಿ',
  category: 'Ground',
  image_url: null,
  mrp: 180,
  selling_price: 140,
  stock_quantity: 8,
  low_stock_threshold: 5,
  is_active: true,
  sort_order: 0,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

const lines: InterestLine[] = [{ product, quantity: 2 }]

describe('interest enquiry helpers', () => {
  it('accepts a valid customer and a +91 mobile number', () => {
    expect(validateInterest('Asha Rao', '+91 98765 43210', lines)).toBeNull()
  })

  it('rejects invalid names, phone numbers, and empty lists', () => {
    expect(validateInterest('A', '9876543210', lines)).toBe('name')
    expect(validateInterest('Asha Rao', '1234567890', lines)).toBe('phone')
    expect(validateInterest('Asha Rao', '9876543210', [])).toBe('items')
  })

  it('rejects invalid quantities', () => {
    expect(validateInterest('Asha Rao', '9876543210', [{ product, quantity: 100 }])).toBe('quantity')
  })

  it('encodes an interest-only WhatsApp message in the selected language', () => {
    const message = makeWhatsAppMessage('Asha Rao', '9876543210', lines, 'en', 'AC-12345678')
    const url = makeWhatsAppUrl('919876543210', 'Asha Rao', '9876543210', lines, 'en', 'AC-12345678')
    const parsed = new URL(url)
    expect(parsed.pathname).toBe('/919876543210')
    expect(parsed.searchParams.get('text')).toBe(message)
    expect(message).toContain("I'm interested in the following crackers:")
    expect(message).toContain('Flower Pots — Quantity: 2')
    expect(message).toContain('AC-12345678')
    expect(message).not.toContain('order')
  })

  it('uses Kannada product names and text for Kannada customers', () => {
    const url = makeWhatsAppUrl('919876543210', 'ಅಶಾ', '9876543210', lines, 'kn')
    const message = new URL(url).searchParams.get('text') ?? ''
    expect(message).toContain('ನನಗೆ ಈ ಪಟಾಕಿಗಳ ಬಗ್ಗೆ ಆಸಕ್ತಿ ಇದೆ:')
    expect(message).toContain('ಹೂವಿನ ಕುಂಡಗಳು — ಪ್ರಮಾಣ: 2')
  })

  it('provides complete localized customer-facing disclaimers', () => {
    expect(translate('en', 'enquiryNotice')).toContain('No online sale')
    expect(translate('kn', 'enquiryNotice')).toContain('ಆನ್‌ಲೈನ್ ಮಾರಾಟ')
    expect(translate('kn', 'submitInterest')).toBe('ವಾಟ್ಸಾಪ್ ಮೂಲಕ ಆಸಕ್ತಿ ಕಳುಹಿಸಿ')
  })
})

describe('stock rules', () => {
  it('validates stock values as non-negative whole numbers', () => {
    expect(isValidStockValue(0)).toBe(true)
    expect(isValidStockValue(4)).toBe(true)
    expect(isValidStockValue(-1)).toBe(false)
    expect(isValidStockValue(1.5)).toBe(false)
    expect(isValidStockValue(Number.NaN)).toBe(false)
  })

  it('classifies available, low and empty stock at the configured threshold', () => {
    expect(getStockStatus(8, 5)).toBe('in-stock')
    expect(getStockStatus(5, 5)).toBe('low-stock')
    expect(getStockStatus(1, 5)).toBe('low-stock')
    expect(getStockStatus(0, 5)).toBe('out-of-stock')
    expect(getStockStatus(1, 0)).toBe('in-stock')
  })

  it('rejects invalid status inputs', () => {
    expect(() => getStockStatus(-1, 5)).toThrow(RangeError)
    expect(() => getStockStatus(1, 1.5)).toThrow(RangeError)
  })
})

describe('customer interest persistence', () => {
  it('serializes, restores, and validates saved product quantities', () => {
    const stored = serializeInterestQuantities({ [product.id]: 2 })
    expect(parseInterestQuantities(stored)).toEqual({ [product.id]: 2 })
    expect(parseInterestQuantities('not-json')).toEqual({})
    expect(parseInterestQuantities(JSON.stringify({ [product.id]: 2, bad: 0, invalid: 100, fractional: 1.2 }))).toEqual({ [product.id]: 2 })
    expect(CUSTOMER_INTEREST_STORAGE_KEY).toBe('anil-crackers-interest')
  })

  it('increments, caps, decreases, removes and clears quantities', () => {
    const selected = updateInterestQuantity({}, product.id, 1)
    expect(selected).toEqual({ [product.id]: 1 })
    expect(updateInterestQuantity(selected, product.id, 2)).toEqual({ [product.id]: 3 })
    expect(updateInterestQuantity({ [product.id]: 99 }, product.id, 1)).toEqual({ [product.id]: 99 })
    expect(updateInterestQuantity(selected, product.id, -1)).toEqual({})
    expect(clearInterestQuantities()).toEqual({})
  })
})
