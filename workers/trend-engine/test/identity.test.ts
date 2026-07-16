import { describe, expect, it } from 'vitest'
import { candidateIdentityKey } from '../src/identity'
import { makeSignal } from './fixtures'

describe('candidate identity', () => {
  it('preserves non-Latin identity and content beyond the display-slug limit', () => {
    const first = makeSignal({ source: 'social-source' })
    first.candidate.brand = '東京玩具'
    first.candidate.name = `${'限定版'.repeat(40)}赤`
    const second = structuredClone(first)
    second.candidate.name = `${'限定版'.repeat(40)}青`

    expect(candidateIdentityKey(first)).not.toBe(candidateIdentityKey(second))
    expect(candidateIdentityKey(first)).toContain('東京玩具')
  })
})
