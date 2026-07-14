import { MapPin, Storefront } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import EmptyState from '../components/EmptyState'
import SightingCard from '../components/SightingCard'
import { getPublicStore, listPublicSightings } from '../lib/launchApi'
import type { Sighting, Store } from '../types/database'

export default function StorePage() {
  const { slug } = useParams<{ slug: string }>()
  const [store, setStore] = useState<Store | null>(null)
  const [sightings, setSightings] = useState<Sighting[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!slug) return
    let active = true
    async function load() {
      const storeResult = await getPublicStore(slug!)
      if (!active) return
      if (storeResult.error || !storeResult.data) {
        setLoading(false)
        return
      }
      setStore(storeResult.data)
      const sightingResult = await listPublicSightings({ storeId: storeResult.data.id, limit: 50 })
      if (!active) return
      setSightings(sightingResult.data ?? [])
      setError(sightingResult.error ? 'Recent sightings could not be loaded.' : null)
      setLoading(false)
    }
    void load()
    return () => { active = false }
  }, [slug])

  if (loading) return <div className="flex items-center justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-200 border-t-brand-500" /></div>
  if (!store) return <EmptyState title="Store not found" message="This location may be awaiting review or no longer active." action={<Link to="/stores" className="btn-primary">Browse stores</Link>} />

  return (
    <div className="space-y-7">
      {error && <div className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">{error}</div>}
      <header className="rounded-2xl border-2 border-stone-900 bg-[#fffdf7] p-5 shadow-[5px_5px_0_0_#0c251d]">
        <Link to="/stores" className="text-sm font-semibold text-gray-500 hover:text-gray-800">← Store directory</Link>
        <div className="mt-4 flex items-start gap-3">
          <span className="rounded-xl bg-brand-100 p-3 text-brand-700"><Storefront size={28} weight="bold" aria-hidden="true" /></span>
          <div>
            <p className="text-xs font-black uppercase tracking-[0.14em] text-brand-700">{store.retailer_name}</p>
            <h1 className="text-2xl font-black tracking-tight text-stone-950">{store.store_name || store.retailer_name}</h1>
            <p className="mt-2 flex gap-1.5 text-sm text-gray-600"><MapPin className="mt-0.5 shrink-0" size={17} weight="fill" aria-hidden="true" /><span>{store.address_line1}<br />{store.city}, {store.state} {store.zip_code}</span></p>
          </div>
        </div>
        <p className="mt-5 border-t border-stone-200 pt-4 text-sm text-gray-600">Community reports are time-sensitive. Confirm inventory with the store before making a long trip.</p>
      </header>

      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-gray-900">Fresh Sightings</h2>
          <Link to="/sightings/new" className="text-sm font-semibold text-brand-700">Report one →</Link>
        </div>
        {sightings.length > 0
          ? <div className="space-y-3">{sightings.map((sighting) => <SightingCard key={sighting.id} sighting={sighting} />)}</div>
          : <EmptyState title="No fresh sightings here" message="Sign in to report what you find at this location." action={<Link to="/sightings/new" className="btn-secondary">Report a Sighting</Link>} />}
      </section>
    </div>
  )
}
