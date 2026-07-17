import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import BountyCard from '../components/BountyCard'
import CatalogSearchSelect, { type CatalogSelection } from '../components/CatalogSearchSelect'
import EmptyState from '../components/EmptyState'
import LeadCard from '../components/LeadCard'
import SightingCard from '../components/SightingCard'
import { useViewerLocation } from '../contexts/ViewerLocationContext'
import { activeMarket } from '../lib/market'
import { listPublicBounties, listPublicLeads, listPublicSightings } from '../lib/launchApi'
import type { Bounty, Lead, Sighting } from '../types/database'

export default function Home() {
  const navigate = useNavigate()
  const viewerLocation = useViewerLocation()
  const [selectedProduct, setSelectedProduct] = useState<CatalogSelection | null>(null)
  const [bounties, setBounties] = useState<Bounty[]>([])
  const [sightings, setSightings] = useState<Sighting[]>([])
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    if (viewerLocation.loading) {
      setLoading(true)
      return () => { active = false }
    }

    async function load() {
      setLoading(true)
      const filters = {
        productId: selectedProduct?.id ?? null,
        limit: 5,
        zipCode: viewerLocation.zipCode,
      }
      const [sightingsRes, bountiesRes, leadsRes] = await Promise.all([
        listPublicSightings(filters),
        listPublicBounties(filters),
        listPublicLeads(filters),
      ])
      if (!active) return

      if (sightingsRes.error || bountiesRes.error || leadsRes.error) {
        setError('Failed to load local activity. Please try again.')
      } else {
        setError(null)
      }
      setSightings(sightingsRes.data ?? [])
      setBounties(bountiesRes.data ?? [])
      setLeads(leadsRes.data ?? [])
      setLoading(false)
    }

    void load()
    return () => { active = false }
  }, [selectedProduct?.id, viewerLocation.loading, viewerLocation.zipCode])

  return (
    <div className="space-y-8">
      {error && <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{error}</div>}

      <section className="rounded-2xl border-2 border-stone-950 bg-[#fffdf7] p-5 shadow-[6px_6px_0_0_#0c251d] sm:p-7">
        <span className="inline-block rounded-full border border-brand-200 bg-brand-50 px-3 py-0.5 text-xs font-bold text-brand-700">
          {activeMarket.betaLabel}
        </span>
        <h1 className="mt-3 text-3xl font-black tracking-tight text-stone-950 sm:text-4xl">
          Find what&apos;s viral <span className="text-brand-600">near you</span>
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-stone-600 sm:text-base">
          Search the catalog, then see the newest local sightings, bounties, and restock leads.
        </p>
        <div className="mt-5 max-w-2xl rounded-xl border border-stone-200 bg-white p-3 shadow-[3px_3px_0_0_#d6d3d1] sm:p-4">
          <CatalogSearchSelect
            kind="product"
            label="What are you looking for?"
            value={selectedProduct}
            onChange={setSelectedProduct}
            onSuggest={(query) => navigate(`/sightings/new?suggestProduct=${encodeURIComponent(query)}`)}
          />
        </div>
        <p className="mt-3 text-xs font-semibold text-stone-500">
          {selectedProduct
            ? `Showing local activity for ${selectedProduct.label}.`
            : viewerLocation.source === 'profile'
              ? 'Showing activity near your saved ZIP code.'
              : `Showing activity near ${activeMarket.name}.`}
        </p>
      </section>

      {loading ? (
        <div className="flex items-center justify-center py-20" aria-label="Loading local activity">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-200 border-t-brand-500" />
        </div>
      ) : (
        <>
          {([
            {
              key: 'sightings' as const,
              hasItems: sightings.length > 0,
              render: () => (
                <section>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h2 className="text-lg font-black text-stone-950">Recent Sightings</h2>
                    <Link to="/sightings" className="text-sm font-bold text-brand-700 hover:text-brand-800">View all →</Link>
                  </div>
                  {sightings.length > 0 ? (
                    <div className="space-y-3">{sightings.map((sighting) => <SightingCard key={sighting.id} sighting={sighting} />)}</div>
                  ) : (
                    <EmptyState
                      title="No sightings reported yet"
                      message={selectedProduct ? 'No recent sightings match this product near you.' : 'Report what you find to help local shoppers avoid wasted trips.'}
                      action={<Link to="/sightings/new" className="btn-secondary">Report a Sighting</Link>}
                    />
                  )}
                </section>
              ),
            },
            {
              key: 'bounties' as const,
              hasItems: bounties.length > 0,
              render: () => (
                <section>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h2 className="text-lg font-black text-stone-950">Open Bounties</h2>
                    <Link to="/bounties" className="text-sm font-bold text-brand-700 hover:text-brand-800">View all →</Link>
                  </div>
                  {bounties.length > 0 ? (
                    <div className="space-y-3">{bounties.map((bounty) => <BountyCard key={bounty.id} bounty={bounty} />)}</div>
                  ) : (
                    <EmptyState
                      title="No open bounties yet"
                      message={selectedProduct ? 'No open bounties match this product near you.' : 'Post a bounty when you need help finding something.'}
                      action={<Link to="/bounties/new" className="btn-primary">Post a Bounty</Link>}
                    />
                  )}
                </section>
              ),
            },
            {
              key: 'leads' as const,
              hasItems: leads.length > 0,
              render: () => (
                <section>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h2 className="text-lg font-black text-stone-950">Recent Leads</h2>
                    <Link to="/sightings" className="text-sm font-bold text-brand-700 hover:text-brand-800">View all →</Link>
                  </div>
                  {leads.length > 0 ? (
                    <div className="space-y-3">{leads.map((lead) => <LeadCard key={lead.id} lead={lead} />)}</div>
                  ) : (
                    <EmptyState
                      title="No leads shared yet"
                      message={selectedProduct ? 'No recent leads match this product near you.' : 'Share a restock lead to help fellow shoppers find products.'}
                      action={<Link to="/leads/new" className="btn-primary">Share a Lead</Link>}
                    />
                  )}
                </section>
              ),
            },
          ])
            .sort((a, b) => Number(b.hasItems) - Number(a.hasItems))
            .map((s) => <div key={s.key} className="space-y-8">{s.render()}</div>)}
        </>
      )}
    </div>
  )
}
