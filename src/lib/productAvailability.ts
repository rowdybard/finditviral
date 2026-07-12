import type { Product } from '../types/database'

export function availabilityLabel(product: Product) {
  switch (product.availability_status) {
    case 'available': return 'Available now'
    case 'backorder': return 'Backorder'
    case 'preorder': return 'Preorder'
    case 'announced': return 'Coming soon'
    case 'limited': return 'Limited store release'
    default: return 'Unavailable'
  }
}

export function releaseLabel(releaseDate: string | null) {
  if (!releaseDate) return null
  return new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(`${releaseDate}T00:00:00Z`))
}
