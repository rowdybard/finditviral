import { describe, expect, it } from 'vitest'
import { availabilityLabel, releaseLabel } from './productAvailability'
import type { Product } from '../types/database'

function makeProduct(status: Product['availability_status']): Product {
  return {
    id: '1',
    trend_id: '1',
    name: 'Test Product',
    slug: 'test-product',
    availability_status: status,
    source_url: null,
    retailer: null,
    release_date: null,
    verified_at: null,
    is_active: true,
    created_at: new Date().toISOString(),
  }
}

describe('availabilityLabel', () => {
  it('returns Available now for available', () => {
    expect(availabilityLabel(makeProduct('available'))).toBe('Available now')
  })

  it('returns Backorder for backorder', () => {
    expect(availabilityLabel(makeProduct('backorder'))).toBe('Backorder')
  })

  it('returns Preorder for preorder', () => {
    expect(availabilityLabel(makeProduct('preorder'))).toBe('Preorder')
  })

  it('returns Coming soon for announced', () => {
    expect(availabilityLabel(makeProduct('announced'))).toBe('Coming soon')
  })

  it('returns Limited store release for limited', () => {
    expect(availabilityLabel(makeProduct('limited'))).toBe('Limited store release')
  })

  it('returns Unavailable for retired', () => {
    expect(availabilityLabel(makeProduct('retired'))).toBe('Unavailable')
  })
})

describe('releaseLabel', () => {
  it('returns null for null release date', () => {
    expect(releaseLabel(null)).toBeNull()
  })

  it('formats a valid date', () => {
    const result = releaseLabel('2026-07-15')
    expect(result).toBe('Jul 15, 2026')
  })

  it('formats a date with single-digit day', () => {
    const result = releaseLabel('2026-01-05')
    expect(result).toBe('Jan 5, 2026')
  })
})
