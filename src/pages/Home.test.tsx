import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Home from './Home'

const viewerLocation = vi.hoisted(() => ({
  value: { zipCode: '48823', source: 'profile', loading: false } as {
    zipCode: string
    source: 'profile' | 'market'
    loading: boolean
  },
}))

const api = vi.hoisted(() => ({
  listPublicSightings: vi.fn(),
  listPublicBounties: vi.fn(),
  listPublicLeads: vi.fn(),
}))

vi.mock('../contexts/ViewerLocationContext', () => ({
  useViewerLocation: () => viewerLocation.value,
}))

vi.mock('../lib/launchApi', () => api)

vi.mock('../components/CatalogSearchSelect', () => ({
  default: ({ onChange, onSuggest }: {
    onChange: (value: { id: string; label: string; detail: string }) => void
    onSuggest: (query: string) => void
  }) => (
    <div>
      <button type="button" onClick={() => onChange({ id: 'product-1', label: 'Example snack', detail: 'Trending' })}>
        Select Example snack
      </button>
      <button type="button" onClick={() => onSuggest('Missing snack')}>Suggest Missing snack</button>
    </div>
  ),
}))

vi.mock('../components/SightingCard', () => ({
  default: ({ sighting }: { sighting: { product_name?: string } }) => <div>Sighting: {sighting.product_name}</div>,
}))
vi.mock('../components/BountyCard', () => ({
  default: ({ bounty }: { bounty: { product_name?: string } }) => <div>Bounty: {bounty.product_name}</div>,
}))
vi.mock('../components/LeadCard', () => ({
  default: ({ lead }: { lead: { product_name?: string } }) => <div>Lead: {lead.product_name}</div>,
}))

const success = (data: unknown[]) => ({ data, error: null })

function Location() {
  const location = useLocation()
  return <output data-testid="location">{location.pathname}{location.search}</output>
}

function renderHome() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<><Home /><Location /></>} />
        <Route path="/sightings/new" element={<Location />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('Home', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    viewerLocation.value = { zipCode: '48823', source: 'profile', loading: false }
    api.listPublicSightings.mockResolvedValue(success([{ id: 's1', product_name: 'Example snack' }]))
    api.listPublicBounties.mockResolvedValue(success([{ id: 'b1', product_name: 'Example snack' }]))
    api.listPublicLeads.mockResolvedValue(success([{ id: 'l1', product_name: 'Example snack' }]))
  })

  it('uses the saved ZIP for all three feeds and filters them in place after product selection', async () => {
    const user = userEvent.setup()
    renderHome()

    await waitFor(() => {
      expect(api.listPublicSightings).toHaveBeenCalledWith({ productId: null, limit: 5, zipCode: '48823' })
      expect(api.listPublicBounties).toHaveBeenCalledWith({ productId: null, limit: 5, zipCode: '48823' })
      expect(api.listPublicLeads).toHaveBeenCalledWith({ productId: null, limit: 5, zipCode: '48823' })
    })
    expect(screen.getByText('Showing activity near your saved ZIP code.')).toBeInTheDocument()
    expect(screen.getByText('Recent Sightings')).toBeInTheDocument()
    expect(screen.getByText('Open Bounties')).toBeInTheDocument()
    expect(screen.getByText('Recent Leads')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Select Example snack' }))

    await waitFor(() => {
      expect(api.listPublicSightings).toHaveBeenLastCalledWith({ productId: 'product-1', limit: 5, zipCode: '48823' })
      expect(api.listPublicBounties).toHaveBeenLastCalledWith({ productId: 'product-1', limit: 5, zipCode: '48823' })
      expect(api.listPublicLeads).toHaveBeenLastCalledWith({ productId: 'product-1', limit: 5, zipCode: '48823' })
    })
  })

  it('defers distance-bearing feed calls while saved location is unresolved', () => {
    viewerLocation.value = { zipCode: '48910', source: 'market', loading: true }
    renderHome()
    expect(api.listPublicSightings).not.toHaveBeenCalled()
    expect(api.listPublicBounties).not.toHaveBeenCalled()
    expect(api.listPublicLeads).not.toHaveBeenCalled()
  })

  it('routes a product suggestion to the existing private suggestion handoff', async () => {
    const user = userEvent.setup()
    renderHome()

    await user.click(screen.getByRole('button', { name: 'Suggest Missing snack' }))

    expect(screen.getByTestId('location')).toHaveTextContent('/sightings/new?suggestProduct=Missing%20snack')
  })
})
