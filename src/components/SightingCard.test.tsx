import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { Sighting } from '../types/database'
import SightingCard from './SightingCard'

vi.mock('./SightingPhoto', () => ({ default: () => <div /> }))
vi.mock('./ShareButton', () => ({ default: () => <button type="button">Share</button> }))
vi.mock('./SightingVerificationControls', () => ({ default: () => <div /> }))
vi.mock('../contexts/MascotToastContext', () => ({ useMascotToast: () => vi.fn() }))

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
  seen_at: '2026-07-16T12:00:00.000Z',
  created_at: '2026-07-16T12:00:00.000Z',
} as unknown as Sighting

describe('SightingCard metadata', () => {
  it('does not render distance or its origin context', () => {
    render(<MemoryRouter><SightingCard sighting={sighting} /></MemoryRouter>)
    const card = screen.getByTestId('sighting-card')
    expect(card).toHaveTextContent('Example Market, East Lansing, MI')
    expect(card).not.toHaveTextContent('Approx. from your ZIP')
    expect(card).not.toHaveTextContent('Approx. from Greater Lansing')
    expect(card).not.toHaveTextContent('18.3')
  })
})
