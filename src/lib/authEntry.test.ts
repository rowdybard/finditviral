import { describe, expect, it } from 'vitest'
import {
  buildPasswordRecoveryRedirectUrl,
  getCompletedOnboardingDestination,
  getPasswordRecoveryRoute,
  getSignedInAuthDestination,
  isPasswordRecoveryCallback,
  shouldShowAuthCaptcha,
} from './authEntry'

const signedInInput = {
  authLoading: false,
  hasUser: true,
  onboardingCompleted: true,
  passwordRecovery: false,
  returnTo: '/home',
  search: '',
  hash: '',
}

describe('auth entry guards', () => {
  it('recognizes recovery callbacks before the auth event is emitted', () => {
    expect(isPasswordRecoveryCallback('', '#access_token=token&type=recovery')).toBe(true)
    expect(isPasswordRecoveryCallback('?type=recovery', '')).toBe(true)
    expect(isPasswordRecoveryCallback('?mode=signup', '')).toBe(false)
  })

  it('uses a dedicated, allow-listable password recovery destination', () => {
    expect(buildPasswordRecoveryRedirectUrl('https://finditviral.com')).toBe(
      'https://finditviral.com/auth?type=recovery',
    )
  })

  it('routes recovery sessions to the password form even after a site URL fallback', () => {
    expect(getPasswordRecoveryRoute(true, '/')).toBe('/auth?type=recovery')
    expect(getPasswordRecoveryRoute(true, '/', '#access_token=token&type=recovery')).toBe(
      '/auth?type=recovery#access_token=token&type=recovery',
    )
    expect(getPasswordRecoveryRoute(true, '/auth')).toBeNull()
    expect(getPasswordRecoveryRoute(false, '/')).toBeNull()
  })

  it('keeps password recovery on the auth page', () => {
    expect(getSignedInAuthDestination({
      ...signedInInput,
      passwordRecovery: true,
    })).toBeNull()
    expect(getSignedInAuthDestination({
      ...signedInInput,
      hash: '#type=recovery',
    })).toBeNull()
  })

  it('does not block auth while the session is unresolved or absent', () => {
    expect(getSignedInAuthDestination({
      ...signedInInput,
      authLoading: true,
    })).toBeNull()
    expect(getSignedInAuthDestination({
      ...signedInInput,
      hasUser: false,
    })).toBeNull()
  })

  it('sends authenticated members to their account instead of signup', () => {
    expect(getSignedInAuthDestination({
      ...signedInInput,
      returnTo: '/admin',
    })).toBe('/admin')
  })

  it('sends authenticated unfinished members to onboarding', () => {
    expect(getSignedInAuthDestination({
      ...signedInInput,
      onboardingCompleted: false,
      returnTo: '/leads/new',
    })).toBe('/onboarding?returnTo=%2Fleads%2Fnew')
  })

  it('redirects completed members away from onboarding', () => {
    expect(getCompletedOnboardingDestination({
      authLoading: false,
      hasUser: true,
      onboardingCompleted: true,
      returnTo: '/home',
    })).toBe('/home')
    expect(getCompletedOnboardingDestination({
      authLoading: false,
      hasUser: true,
      onboardingCompleted: false,
      returnTo: '/home',
    })).toBeNull()
  })

  it('keeps the CAPTCHA lifecycle alive until an auth action finishes', () => {
    const input = {
      authLoading: false,
      actionLoading: false,
      hasActiveAuthSession: false,
      passwordRecovery: false,
      confirmationPending: false,
      resetSent: false,
    }

    expect(shouldShowAuthCaptcha(input)).toBe(true)
    expect(shouldShowAuthCaptcha({
      ...input,
      authLoading: true,
    })).toBe(false)
    expect(shouldShowAuthCaptcha({
      ...input,
      authLoading: true,
      actionLoading: true,
      hasActiveAuthSession: true,
    })).toBe(true)
    expect(shouldShowAuthCaptcha({
      ...input,
      hasActiveAuthSession: true,
    })).toBe(false)
  })
})
