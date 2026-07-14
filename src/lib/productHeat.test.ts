import { describe, expect, it, vi } from 'vitest'
import { mapProductHeat, trackProductOpen } from './productHeat'

describe('mapProductHeat', () => {
  it('normalizes Supabase RPC values and clamps the visible score', () => {
    expect(mapProductHeat([
      {
        product_id: 'product-1',
        heat_percent: '36',
        total_clicks: '12',
        product_count: 3,
        has_signal: true,
      },
      {
        product_id: 'product-2',
        heat_percent: 140,
        total_clicks: -1,
        product_count: 'nope',
        has_signal: false,
      },
      null,
    ])).toEqual({
      'product-1': {
        heatPercent: 36,
        totalClicks: 12,
        productCount: 3,
        hasSignal: true,
      },
      'product-2': {
        heatPercent: 100,
        totalClicks: 0,
        productCount: 0,
        hasSignal: false,
      },
    })
  })

  it('returns an empty map for unavailable heat data', () => {
    expect(mapProductHeat(null)).toEqual({})
    expect(mapProductHeat({ error: true })).toEqual({})
  })
})

describe('trackProductOpen', () => {
  it('posts a non-blocking same-origin request', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))

    await trackProductOpen('product-1', fetchImpl)

    expect(fetchImpl).toHaveBeenCalledWith('/api/product-click', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      keepalive: true,
      body: JSON.stringify({ productId: 'product-1' }),
    })
  })

  it('swallows network failures so navigation can continue', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('offline'))

    await expect(trackProductOpen('product-1', fetchImpl)).resolves.toBeUndefined()
  })
})
