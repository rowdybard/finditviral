import { describe, expect, it } from 'vitest'
import { haversineMiles, formatDistance } from './distance'

describe('haversineMiles', () => {
  it('returns 0 for identical coordinates', () => {
    expect(haversineMiles(42.7, -84.5, 42.7, -84.5)).toBe(0)
  })

  it('calculates distance between two nearby points', () => {
    const dist = haversineMiles(42.7325, -84.5555, 42.7368, -84.4836)
    expect(dist).toBeGreaterThan(3)
    expect(dist).toBeLessThan(5)
  })

  it('calculates distance between distant points', () => {
    const dist = haversineMiles(40.7128, -74.006, 34.0522, -118.2437)
    expect(dist).toBeGreaterThan(2400)
    expect(dist).toBeLessThan(2500)
  })
})

describe('formatDistance', () => {
  it('returns <1 mi for sub-mile distances', () => {
    expect(formatDistance(0.5)).toBe('<1 mi')
  })

  it('returns one decimal for distances under 10', () => {
    expect(formatDistance(5.4)).toBe('5.4 mi')
  })

  it('returns rounded miles for distances 10+', () => {
    expect(formatDistance(42.7)).toBe('43 mi')
  })
})
