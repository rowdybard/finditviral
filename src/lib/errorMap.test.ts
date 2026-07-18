import { describe, expect, it } from 'vitest'
import type { PostgrestError } from '@supabase/supabase-js'
import { mapContributionError } from './errorMap'

function postgrestError(message: string): PostgrestError {
  return { code: '22023', message, details: '', hint: '' } as unknown as PostgrestError
}

describe('mapContributionError', () => {
  it('keeps a useful confirmation validation message instead of the generic 22023 fallback', () => {
    expect(mapContributionError(postgrestError('Only in-stock sightings can confirm a lead')))
      .toBe('Choose In Stock or Low Stock to confirm this lead.')
  })

  it('keeps the generic fallback when an invalid request has no known explanation', () => {
    expect(mapContributionError(postgrestError('Malformed request')))
      .toBe('Some details are invalid. Please check your submission and try again.')
  })
})
