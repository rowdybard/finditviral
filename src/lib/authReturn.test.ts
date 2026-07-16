import { describe, expect, it } from 'vitest'
import {
  buildAuthPath,
  buildOnboardingPath,
  buildReauthenticationPath,
  locationReturnPath,
  sanitizeReturnPath,
} from './authReturn'

describe('authentication return paths', () => {
  it('preserves the Lead creation route through authentication and onboarding', () => {
    expect(buildAuthPath('/leads/new')).toBe('/auth?returnTo=%2Fleads%2Fnew')
    expect(buildAuthPath('/leads/new', 'signup')).toBe('/auth?mode=signup&returnTo=%2Fleads%2Fnew')
    expect(buildOnboardingPath('/leads/new')).toBe('/onboarding?returnTo=%2Fleads%2Fnew')
  })

  it('preserves query strings and fragments from the requested app route', () => {
    expect(locationReturnPath({
      pathname: '/sightings/new',
      search: '?draft=123',
      hash: '#photos',
    })).toBe('/sightings/new?draft=123#photos')
    expect(buildReauthenticationPath('/sightings/new?draft=123#photos')).toBe(
      '/auth?reason=session_expired&returnTo=%2Fsightings%2Fnew%3Fdraft%3D123%23photos',
    )
  })

  it('rejects external, malformed, and auth-loop destinations', () => {
    for (const value of [
      'https://example.com',
      '//example.com/path',
      '/\\example.com/path',
      '/auth',
      '/onboarding',
      '/leads/new\nhttps://example.com',
    ]) {
      expect(sanitizeReturnPath(value)).toBe('/home')
    }
  })

  it('omits the default home destination from generated URLs', () => {
    expect(buildAuthPath('/home')).toBe('/auth')
    expect(buildReauthenticationPath('/home')).toBe('/auth?reason=session_expired')
    expect(buildOnboardingPath('/home')).toBe('/onboarding')
  })
})
