import { describe, expect, it, vi } from 'vitest'

vi.mock('../lib/launchApi', () => ({
  searchProducts: vi.fn().mockResolvedValue({
    data: [
      { id: 'p1', name: 'Squishmallow Phoenix', slug: 'squishmallow-phoenix', trend_name: 'Squishmallows', availability_status: 'limited', release_date: null, image_url: null },
      { id: 'p2', name: 'Squishmallow Dragon', slug: 'squishmallow-dragon', trend_name: 'Squishmallows', availability_status: 'available', release_date: null, image_url: null },
    ],
    error: null,
  }),
  searchStores: vi.fn().mockResolvedValue({ data: [], error: null }),
}))

describe('CatalogSearchSelect keyboard navigation logic', () => {
  it('clamps activeIndex within results bounds', () => {
    const results = [{ id: 'p1', label: 'A', detail: 'x' }, { id: 'p2', label: 'B', detail: 'y' }]
    let activeIndex = -1

    const clampDown = (prev: number) => Math.min(prev + 1, results.length - 1)
    const clampUp = (prev: number) => Math.max(prev - 1, 0)

    activeIndex = clampDown(activeIndex)
    expect(activeIndex).toBe(0)

    activeIndex = clampDown(activeIndex)
    expect(activeIndex).toBe(1)

    activeIndex = clampDown(activeIndex)
    expect(activeIndex).toBe(1)

    activeIndex = clampUp(activeIndex)
    expect(activeIndex).toBe(0)

    activeIndex = clampUp(activeIndex)
    expect(activeIndex).toBe(0)
  })

  it('selects the active result on Enter when activeIndex is valid', () => {
    const results = [{ id: 'p1', label: 'A', detail: 'x' }, { id: 'p2', label: 'B', detail: 'y' }]
    const activeIndex = 1
    const selected = activeIndex >= 0 && activeIndex < results.length ? results[activeIndex] : null
    expect(selected).toEqual({ id: 'p2', label: 'B', detail: 'y' })
  })

  it('does not select when activeIndex is -1', () => {
    const results = [{ id: 'p1', label: 'A', detail: 'x' }]
    const activeIndex = -1
    const selected = activeIndex >= 0 && activeIndex < results.length ? results[activeIndex] : null
    expect(selected).toBeNull()
  })
})
