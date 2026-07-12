import { describe, expect, it } from 'vitest'
import { getPageMetadata } from './pageMetadata'

describe('getPageMetadata', () => {
  it('returns indexable landing-page metadata for the root route', () => {
    expect(getPageMetadata('/')).toMatchObject({
      canonicalUrl: 'https://finditviral.com/',
      robots: 'index, follow',
    })
  })

  it('gives the privacy page its own canonical metadata', () => {
    expect(getPageMetadata('/privacy/')).toMatchObject({
      title: 'Privacy Notice - FindItViral',
      canonicalUrl: 'https://finditviral.com/privacy',
      robots: 'index, follow',
    })
  })

  it('keeps auth and onboarding routes out of search results', () => {
    expect(getPageMetadata('/auth').robots).toBe('noindex, nofollow')
    expect(getPageMetadata('/auth').canonicalUrl).toBe('https://finditviral.com/auth')
    expect(getPageMetadata('/onboarding').robots).toBe('noindex, nofollow')
    expect(getPageMetadata('/onboarding').canonicalUrl).toBe('https://finditviral.com/onboarding')
  })

  it('keeps private and unknown routes out of search results', () => {
    expect(getPageMetadata('/home').robots).toBe('noindex, nofollow')
    expect(getPageMetadata('/home').canonicalUrl).toBe('https://finditviral.com/home')
    expect(getPageMetadata('/unrecognized').robots).toBe('noindex, nofollow')
  })
})
