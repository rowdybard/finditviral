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

const STORE_DIRECTORY_METADATA: PageMetadata = {
  title: 'Verified Greater Lansing Stores - FindItViral',
  description: 'Browse verified Greater Lansing stores and boutiques with fresh community product sightings.',
  canonicalUrl: 'https://finditviral.com/stores',
  robots: 'index, follow',
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
  if (normalizedPathname === '/stores') return STORE_DIRECTORY_METADATA
  if (normalizedPathname.startsWith('/stores/')) {
    return {
      title: 'Greater Lansing Store Sightings - FindItViral',
      description: 'See fresh, community-reported product sightings at a verified Greater Lansing store.',
      canonicalUrl: `https://finditviral.com${normalizedPathname}`,
      robots: 'index, follow',
    }
  }
  if (normalizedPathname.startsWith('/products/')) {
    return {
      title: 'Product Sightings and Bounties - FindItViral',
      description: 'See fresh Greater Lansing sightings and open bounties for this viral or hard-to-find product.',
      canonicalUrl: `https://finditviral.com${normalizedPathname}`,
      robots: 'index, follow',
    }
  }
  if (normalizedPathname.startsWith('/leads/')) {
    return {
      title: 'Restock Lead - FindItViral',
      description: 'Community-shared restock lead for a viral or hard-to-find product in Greater Lansing.',
      canonicalUrl: `https://finditviral.com${normalizedPathname}`,
      robots: 'index, follow',
    }
  }
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

export function getPageMetadataForProduct(
  pathname: string,
  product: { name: string; trend_name?: string | null },
): PageMetadata {
  return {
    title: `${product.name} - FindItViral`,
    description: `See fresh Greater Lansing sightings and open bounties for ${product.name}.`,
    canonicalUrl: `https://finditviral.com${pathname}`,
    robots: 'index, follow',
  }
}

export function getPageMetadataForStore(
  pathname: string,
  store: { store_name: string; retailer_name: string; city: string; state: string },
): PageMetadata {
  const storeName = store.store_name || store.retailer_name
  const location = store.city && store.state ? ` in ${store.city}, ${store.state}` : ''
  return {
    title: `${storeName} - FindItViral`,
    description: `See fresh, community-reported product sightings at ${storeName}${location}.`,
    canonicalUrl: `https://finditviral.com${pathname}`,
    robots: 'index, follow',
  }
}

export function getPageMetadataForLead(
  pathname: string,
  lead: { headline: string; product_name: string },
): PageMetadata {
  return {
    title: `${lead.headline} - FindItViral`,
    description: `Restock lead for ${lead.product_name} in Greater Lansing. Vote on credibility or confirm with a sighting.`,
    canonicalUrl: `https://finditviral.com${pathname}`,
    robots: 'index, follow',
  }
}
