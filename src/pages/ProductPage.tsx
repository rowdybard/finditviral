import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import BountyCard from '../components/BountyCard'
import EmptyState from '../components/EmptyState'
import LeadCard from '../components/LeadCard'
import SightingCard from '../components/SightingCard'
import { getPublicProduct, listPublicBounties, listPublicSightings, listPublicLeads } from '../lib/launchApi'
import { applyPageMetadata, getPageMetadataForProduct } from '../lib/pageMetadata'
import { availabilityLabel, releaseLabel } from '../lib/productAvailability'
import type { Bounty, Lead, PublicProduct, Sighting } from '../types/database'

function freshnessBadge(status: Sighting['freshness_status']) {
  if (!status) return null
  if (status === 'fresh') return <span className="inline-flex rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-green-800">Fresh</span>
  if (status === 'possibly_outdated') return <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-amber-800">Possibly outdated</span>
  return null
}

export default function ProductPage() {
  const { slug } = useParams<{ slug: string }>()
  const [product, setProduct] = useState<PublicProduct | null>(null)
  const [bounties, setBounties] = useState<Bounty[]>([])
  const [sightings, setSightings] = useState<Sighting[]>([])
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!slug) return
    let active = true
    async function load() {
      setLoading(true)
      const productResult = await getPublicProduct(slug!)
      if (!active) return
      if (productResult.error || !productResult.data) {
        setProduct(null)
        setLoading(false)
        return
      }

      setProduct(productResult.data)
      const [bountyResult, sightingResult, leadsResult] = await Promise.all([
        listPublicBounties({ productId: productResult.data.id, limit: 50 }),
        listPublicSightings({ productId: productResult.data.id, limit: 50 }),
        listPublicLeads({ productId: productResult.data.id, limit: 50 }),
      ])
      if (!active) return
      setBounties(bountyResult.data ?? [])
      setSightings(sightingResult.data ?? [])
      setLeads(leadsResult.data ?? [])
      setError(bountyResult.error || sightingResult.error || leadsResult.error ? 'Some recent activity could not be loaded.' : null)
      setLoading(false)
    }
    void load()
    return () => { active = false }
  }, [slug])

  useEffect(() => {
    if (product) {
      applyPageMetadata(document, getPageMetadataForProduct(window.location.pathname, product))
    }
  }, [product])

  if (loading) {
    return <div className="flex items-center justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-200 border-t-brand-500" /></div>
  }

  if (!product) {
    return <EmptyState title="Product not found" message="This product may be unavailable or no longer public." action={<Link to="/stores" className="btn-primary">Browse stores</Link>} />
  }

  return (
    <div className="space-y-8">
      {error && <div className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">{error}</div>}

      <header className="overflow-hidden rounded-2xl border-2 border-stone-900 bg-[#fffdf7] shadow-[5px_5px_0_0_#0c251d]">
        {product.image_url && (
          <img src={product.image_url} alt={product.name + (product.trend_name ? ` - ${product.trend_name}` : '')} className="h-52 w-full border-b-2 border-stone-900 object-cover" />
        )}
        <div className="p-5">
          {product.trend_name && <p className="text-xs font-black uppercase tracking-[0.14em] text-brand-700">{product.trend_name}</p>}
          <h1 className="mt-1 text-3xl font-black tracking-tight text-stone-950">{product.name}</h1>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="rounded-full bg-brand-100 px-3 py-1 font-semibold text-brand-800">{availabilityLabel(product)}</span>
            {releaseLabel(product.release_date) && <span className="text-gray-600">Release: {releaseLabel(product.release_date)}</span>}
            {product.source_url && (
              <a href={product.source_url} target="_blank" rel="noreferrer" className="font-semibold text-brand-700 hover:text-brand-800">
                Verify at {product.retailer ?? 'official source'} ↗
              </a>
            )}
          </div>
          {product.image_attribution && <p className="mt-3 text-xs text-gray-500">Image: {product.image_attribution}</p>}
          <dl className="mt-5 grid grid-cols-2 gap-3 border-t border-stone-200 pt-4 text-center">
            <div><dt className="text-xs font-bold uppercase text-stone-500">Fresh sightings</dt><dd className="text-2xl font-black text-green-700">{product.approved_sighting_count}</dd></div>
            <div><dt className="text-xs font-bold uppercase text-stone-500">Open bounties</dt><dd className="text-2xl font-black text-red-600">{product.open_bounty_count}</dd></div>
          </dl>
        </div>
      </header>

      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-gray-900">Fresh Sightings</h2>
          <Link to="/sightings/new" className="text-sm font-semibold text-brand-700">Report one →</Link>
        </div>
        {sightings.length > 0
          ? <div className="space-y-3">{sightings.map((sighting) => (
              <div key={sighting.id}>
                {freshnessBadge(sighting.freshness_status) && <div className="mb-1">{freshnessBadge(sighting.freshness_status)}</div>}
                <SightingCard sighting={sighting} />
              </div>
            ))}</div>
          : <EmptyState title="No fresh sightings" message="Inventory reports expire quickly. Sign in to share what you find." action={<Link to="/sightings/new" className="btn-secondary">Report a Sighting</Link>} />
        }
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-gray-900">Restock Leads</h2>
          <Link to="/leads/new" className="text-sm font-semibold text-brand-700">Share one →</Link>
        </div>
        {leads.length > 0
          ? <div className="space-y-3">{leads.map((lead) => <LeadCard key={lead.id} lead={lead} />)}</div>
          : <EmptyState title="No restock leads" message="Share a lead if you hear about an upcoming restock for this product." action={<Link to="/leads/new" className="btn-secondary">Share a Lead</Link>} />
        }
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-gray-900">Open Bounties</h2>
          <Link to="/bounties/new" className="text-sm font-semibold text-brand-700">Post one →</Link>
        </div>
        {bounties.length > 0
          ? <div className="space-y-3">{bounties.map((bounty) => <BountyCard key={bounty.id} bounty={bounty} />)}</div>
          : <EmptyState title="No open bounties" message="Sign in to ask local shoppers for help finding this product." action={<Link to="/bounties/new" className="btn-primary">Post a Bounty</Link>} />}
      </section>
    </div>
  )
}
