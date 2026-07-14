import { describe, expect, it } from 'vitest'
import { createSupabaseServerHeaders } from '../src/supabase'

describe('Supabase server headers', () => {
  it('uses modern opaque secrets only as an apikey', () => {
    const headers = createSupabaseServerHeaders('sb_secret_example')
    expect(headers.get('apikey')).toBe('sb_secret_example')
    expect(headers.has('Authorization')).toBe(false)
  })

  it('keeps legacy service-role JWT compatibility', () => {
    const key = 'eyJlegacy.service.signature'
    const headers = createSupabaseServerHeaders(key)
    expect(headers.get('apikey')).toBe(key)
    expect(headers.get('Authorization')).toBe(`Bearer ${key}`)
  })
})

