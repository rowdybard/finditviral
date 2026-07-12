export type PageMetadata = {
  title: string
  description: string
  canonicalUrl: string
  robots: string
}

const ROOT_METADATA: PageMetadata = {
  title: 'FindItViral - Early Access',
  description: 'FindItViral is building a better way to find the hard-to-find. Join the early-access list.',
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
  title: 'Private Access - FindItViral',
  description: 'Owner-only FindItViral workspace.',
  canonicalUrl: 'https://finditviral.com/',
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
