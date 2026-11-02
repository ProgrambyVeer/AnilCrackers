import type { StockStatus } from '../types'

export type { StockStatus }

export function isValidStockValue(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

export function getStockStatus(quantity: number, threshold: number): StockStatus {
  if (!isValidStockValue(quantity) || !isValidStockValue(threshold)) {
    throw new RangeError('Stock quantity and low-stock threshold must be non-negative integers.')
  }
  if (quantity === 0) return 'out-of-stock'
  return quantity <= threshold ? 'low-stock' : 'in-stock'
}
