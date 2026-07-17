import { beforeEach, describe, expect, it } from 'vitest'
import { getRecentStores, getSavedRadius, rememberStore, saveRadius } from './localPreferences'

describe('local preferences', () => {
  beforeEach(() => {
    const values = new Map<string, string>()
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
    })
  })

  it('keeps only valid radius choices', () => {
    saveRadius('25')
    expect(getSavedRadius()).toBe('25')
    saveRadius('999')
    expect(getSavedRadius()).toBe('25')
  })

  it('deduplicates and caps recent stores', () => {
    for (const id of ['one', 'two', 'three', 'four', 'two']) rememberStore({ id, label: id, detail: 'Lansing, MI' })
    expect(getRecentStores().map((store) => store.id)).toEqual(['two', 'four', 'three'])
  })
})
