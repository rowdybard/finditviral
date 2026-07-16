import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Sighting } from '../types/database'
import SightingCard from './SightingCard'

const viewerLocation = vi.hoisted(() => ({
  value: { zipCode: '48823', source: 'profile', loading: false } as {
    zipCode: string
    source: 'profile' | 'market'
    loading: boolean
  },
}))

vi.mock('../contexts/ViewerLocationContext', () => ({
  useViewerLocation: () => viewerLocation.value,
}))
vi.mock('./SightingPhoto', () => ({ default: () => <div /> }))
vi.mock('./ShareButton', () => ({ default: () => <button type="button">Share</button> }))
vi.mock('./SightingVerificationControls', () => ({ default: () => <div /> }))

const sighting = {
  id: 'sighting-1',
  store_name: 'Example Market',
  city: 'East Lansing',
  state: 'MI',
  zip_code: '48823',
  stock_level: 'in_stock',
  availability: 'in_stock',
  product_name: 'Example snack',
  product_slug: 'example-snack',
  distance_miles: 18.3,
  seen_at: '2026-07-16T12:00:00.000Z',
  created_at: '2026-07-16T12:00:00.000Z',
} as unknown as Sighting

describe('SightingCard distance context', () => {
  beforeEach(() => {
    viewerLocation.value = { zipCode: '48823', source: 'profile', loading: false }
  })

  it('labels a member distance as an approximate ZIP-centroid distance', () => {
    render(<MemoryRouter><SightingCard sighting={sighting} /></MemoryRouter>)
    expect(screen.getByText('Approx. from your ZIP')).toBeInTheDocument()
  })

  it('labels fallback distances with the active market origin', () => {
    viewerLocation.value = { zipCode: '48910', source: 'market', loading: false }
    render(<MemoryRouter><SightingCard sighting={sighting} /></MemoryRouter>)
    expect(screen.getByText('Approx. from Greater Lansing')).toBeInTheDocument()
  })
})
