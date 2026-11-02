export const CUSTOMER_INTEREST_STORAGE_KEY = 'anil-crackers-interest'

export type StoredInterestQuantities = Record<string, number>

export function parseInterestQuantities(value: string | null): StoredInterestQuantities {
  if (!value) return {}
  try {
    const parsed: unknown = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const validEntries = Object.entries(parsed).filter((entry): entry is [string, number] => {
      const [id, quantity] = entry
      return id.length > 0 && typeof quantity === 'number'
        && Number.isInteger(quantity) && quantity >= 1 && quantity <= 99
    })
    return Object.fromEntries(validEntries)
  } catch {
    return {}
  }
}

export function serializeInterestQuantities(quantities: StoredInterestQuantities) {
  return JSON.stringify(quantities)
}

export function updateInterestQuantity(quantities: StoredInterestQuantities, productId: string, delta: number): StoredInterestQuantities {
  if (!Number.isInteger(delta) || productId.length === 0) {
    throw new RangeError('A product id and whole-number quantity change are required.')
  }
  const nextQuantity = Math.max(0, Math.min(99, (quantities[productId] ?? 0) + delta))
  const next = { ...quantities }
  if (nextQuantity === 0) delete next[productId]
  else next[productId] = nextQuantity
  return next
}

export function clearInterestQuantities(): StoredInterestQuantities {
  return {}
}
