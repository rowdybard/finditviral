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
    expect(getPageMetadata('/auth').title).toBe('Sign In or Join - FindItViral')
    expect(getPageMetadata('/auth').robots).toBe('noindex, nofollow')
    expect(getPageMetadata('/auth').canonicalUrl).toBe('https://finditviral.com/auth')
    expect(getPageMetadata('/onboarding').robots).toBe('noindex, nofollow')
    expect(getPageMetadata('/onboarding').canonicalUrl).toBe('https://finditviral.com/onboarding')
  })

  it('keeps member and unknown routes out of search results', () => {
    expect(getPageMetadata('/home').robots).toBe('noindex, nofollow')
    expect(getPageMetadata('/home').canonicalUrl).toBe('https://finditviral.com/home')
    expect(getPageMetadata('/unrecognized').robots).toBe('noindex, nofollow')
  })

  it('makes sanitized product and store discovery routes indexable', () => {
    expect(getPageMetadata('/stores')).toMatchObject({
      canonicalUrl: 'https://finditviral.com/stores',
      robots: 'index, follow',
    })
    expect(getPageMetadata('/stores/lansing-target')).toMatchObject({
      canonicalUrl: 'https://finditviral.com/stores/lansing-target',
      robots: 'index, follow',
    })
    expect(getPageMetadata('/products/nice-cube')).toMatchObject({
      canonicalUrl: 'https://finditviral.com/products/nice-cube',
      robots: 'index, follow',
    })
  })

  it('keeps admin and private draft routes out of search results', () => {
    expect(getPageMetadata('/admin').robots).toBe('noindex, nofollow')
    expect(getPageMetadata('/drafts').robots).toBe('noindex, nofollow')
  })
})
