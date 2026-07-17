import { describe, expect, it } from 'vitest'
import { slugify, timeAgo, formatReward, stockLevelLabel, stockLevelColor, statusLabel, statusColor } from './utils'

describe('slugify', () => {
  it('converts text to a slug', () => {
    expect(slugify('Hello World')).toBe('hello-world')
  })

  it('removes special characters', () => {
    expect(slugify('Hello! @World#')).toBe('hello-world')
  })

  it('collapses multiple separators', () => {
    expect(slugify('  multiple   spaces  ')).toBe('multiple-spaces')
  })
})

describe('timeAgo', () => {
  it('returns "just now" for recent dates', () => {
    const date = new Date().toISOString()
    expect(timeAgo(date)).toBe('just now')
  })

  it('returns minutes format', () => {
    const date = new Date(Date.now() - 5 * 60 * 1000).toISOString()
    expect(timeAgo(date)).toBe('5m ago')
  })

  it('returns hours format', () => {
    const date = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString()
    expect(timeAgo(date)).toBe('3h ago')
  })

  it('returns days format', () => {
    const date = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString()
    expect(timeAgo(date)).toBe('4d ago')
  })
})

describe('formatReward', () => {
  it('formats whole numbers with two decimals', () => {
    expect(formatReward(20)).toBe('$20.00')
  })

  it('formats decimal amounts correctly', () => {
    expect(formatReward(20.5)).toBe('$20.50')
  })

  it('formats amounts with cents', () => {
    expect(formatReward(15.99)).toBe('$15.99')
  })
})

describe('stockLevelLabel', () => {
  it('returns HIGH for in_stock', () => {
    expect(stockLevelLabel('in_stock')).toBe('HIGH')
  })

  it('returns MEDIUM for low', () => {
    expect(stockLevelLabel('low')).toBe('MEDIUM')
  })

  it('returns LOW for none', () => {
    expect(stockLevelLabel('none')).toBe('LOW')
  })

  it('returns the input for unknown values', () => {
    expect(stockLevelLabel('unknown')).toBe('unknown')
  })
})

describe('stockLevelColor', () => {
  it('returns green classes for in_stock', () => {
    expect(stockLevelColor('in_stock')).toBe('bg-green-100 text-green-800')
  })

  it('returns yellow classes for low', () => {
    expect(stockLevelColor('low')).toBe('bg-brand-100 text-brand-800')
  })

  it('returns red classes for none', () => {
    expect(stockLevelColor('none')).toBe('bg-red-100 text-red-800')
  })
})

describe('statusLabel', () => {
  it('maps known statuses', () => {
    expect(statusLabel('open')).toBe('Open')
    expect(statusLabel('claimed')).toBe('Claimed')
    expect(statusLabel('closed')).toBe('Closed')
    expect(statusLabel('pending')).toBe('Pending')
    expect(statusLabel('accepted')).toBe('Accepted')
    expect(statusLabel('rejected')).toBe('Rejected')
  })

  it('returns input for unknown statuses', () => {
    expect(statusLabel('unknown')).toBe('unknown')
  })
})

describe('statusColor', () => {
  it('returns green for open and accepted', () => {
    expect(statusColor('open')).toBe('bg-green-100 text-green-800')
    expect(statusColor('accepted')).toBe('bg-green-100 text-green-800')
  })

  it('returns yellow for claimed and pending', () => {
    expect(statusColor('claimed')).toBe('bg-brand-100 text-brand-800')
    expect(statusColor('pending')).toBe('bg-brand-100 text-brand-800')
  })

  it('returns gray for closed and rejected', () => {
    expect(statusColor('closed')).toBe('bg-stone-100 text-stone-600')
    expect(statusColor('rejected')).toBe('bg-stone-100 text-stone-600')
  })
})
