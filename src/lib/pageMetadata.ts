import { activeMarket } from './market'

export type PageMetadata = {
  title: string
  description: string
  canonicalUrl: string
  robots: string
}

const ROOT_METADATA: PageMetadata = {
  title: activeMarket.seoTitle,
  description: activeMarket.seoDescription,
  canonicalUrl: 'https://finditviral.com/',
  robots: 'index, follow',
}

const PRIVACY_METADATA: PageMetadata = {
  title: 'Privacy Notice - FindItViral',
  description: 'How FindItViral collects, uses, retains, and deletes early-access waitlist information.',
  canonicalUrl: 'https://finditviral.com/privacy',
  robots: 'index, follow',
}

const PRIVATE_METADATA: PageMetadata = {
  title: 'Greater Lansing Beta - FindItViral',
  description: 'The signed-in FindItViral beta for Greater Lansing shoppers.',
  canonicalUrl: 'https://finditviral.com/',
  robots: 'noindex, nofollow',
}

const AUTH_METADATA: PageMetadata = {
  title: 'Sign In or Join - FindItViral',
  description: 'Create an account or sign in to the FindItViral Greater Lansing beta.',
  canonicalUrl: 'https://finditviral.com/auth',
  robots: 'noindex, nofollow',
}

const ONBOARDING_METADATA: PageMetadata = {
  title: 'Set Up Your Profile - FindItViral',
  description: 'Set up your Greater Lansing shopping profile for the FindItViral beta.',
  canonicalUrl: 'https://finditviral.com/onboarding',
  robots: 'noindex, nofollow',
}

function normalizePathname(pathname: string) {
  if (pathname === '/') return pathname
  return pathname.replace(/\/+$/, '') || '/'
}

export function getPageMetadata(pathname: string): PageMetadata {
  const normalizedPathname = normalizePathname(pathname)
  if (normalizedPathname === '/') return ROOT_METADATA
  if (normalizedPathname === '/privacy') return PRIVACY_METADATA
  if (normalizedPathname === '/auth') return AUTH_METADATA
  if (normalizedPathname === '/onboarding') return ONBOARDING_METADATA
  return {
    ...PRIVATE_METADATA,
    canonicalUrl: `https://finditviral.com${normalizedPathname}`,
  }
}

function setMetaContent(documentRef: Document, selector: string, content: string) {
  documentRef.querySelector(selector)?.setAttribute('content', content)
}

export function applyPageMetadata(documentRef: Document, metadata: PageMetadata) {
  documentRef.title = metadata.title
  documentRef.querySelector('link[rel="canonical"]')?.setAttribute('href', metadata.canonicalUrl)

  setMetaContent(documentRef, 'meta[name="description"]', metadata.description)
  setMetaContent(documentRef, 'meta[name="robots"]', metadata.robots)
  setMetaContent(documentRef, 'meta[property="og:title"]', metadata.title)
  setMetaContent(documentRef, 'meta[property="og:description"]', metadata.description)
  setMetaContent(documentRef, 'meta[property="og:url"]', metadata.canonicalUrl)
  setMetaContent(documentRef, 'meta[name="twitter:title"]', metadata.title)
  setMetaContent(documentRef, 'meta[name="twitter:description"]', metadata.description)
}
