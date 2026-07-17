import { MagnifyingGlass, MapPin, Storefront } from '@phosphor-icons/react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import EmptyState from '../components/EmptyState'
import { listPublicStores } from '../lib/launchApi'
import type { Store } from '../types/database'

export default function Stores() {
  const request = useRef(0)
  const [query, setQuery] = useState('')
  const [stores, setStores] = useState<Store[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const current = ++request.current
    const timeout = window.setTimeout(async () => {
      setLoading(true)
      const result = await listPublicStores(query, 50, 0)
      if (current !== request.current) return
      setStores(result.data ?? [])
      setError(result.error ? 'Stores could not be loaded. Please try again.' : null)
      setLoading(false)
    }, query ? 250 : 0)
    return () => window.clearTimeout(timeout)
  }, [query])

  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs font-black uppercase tracking-[0.14em] text-brand-700">Greater Lansing directory</p>
        <h1 className="mt-1 text-3xl font-black tracking-tight text-stone-950">Verified Stores & Boutiques</h1>
        <p className="mt-2 text-sm text-stone-600">Browse exact locations used in community sightings. Only approved locations appear here.</p>
      </header>

      <div className="relative">
        <MagnifyingGlass className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" size={19} aria-hidden="true" />
        <input className="input pl-10" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search store, city, or ZIP…" aria-label="Search stores" />
      </div>

      {error && <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {loading ? (
        <div className="flex items-center justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-200 border-t-brand-500" /></div>
      ) : stores.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {stores.map((store) => (
            <Link key={store.id} to={`/stores/${store.slug}`} className="card group block border-2 border-stone-900 shadow-[3px_3px_0_0_#1c1917] transition-transform hover:translate-x-0.5 hover:translate-y-0.5">
              <div className="flex items-start gap-3">
                <span className="rounded-lg bg-brand-100 p-2 text-brand-700"><Storefront size={22} weight="bold" aria-hidden="true" /></span>
                <div className="min-w-0">
                  <h2 className="font-black text-stone-950 group-hover:text-brand-700">{store.store_name || store.retailer_name}</h2>
                  {store.store_name && store.store_name !== store.retailer_name && <p className="text-xs font-semibold text-stone-500">{store.retailer_name}</p>}
                  <p className="mt-2 flex gap-1.5 text-sm text-stone-600"><MapPin className="mt-0.5 shrink-0" size={16} weight="fill" aria-hidden="true" /><span>{store.address_line1}<br />{store.city}, {store.state} {store.zip_code}</span></p>
                  <p className="mt-3 text-xs font-bold uppercase text-green-700">{store.approved_sighting_count ?? 0} fresh sightings</p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <EmptyState title="No approved stores found" message={query ? 'Try another store, city, or ZIP.' : 'The verified Greater Lansing directory is still being prepared.'} action={<Link to="/auth" className="btn-primary">Join to suggest a location</Link>} />
      )}
    </div>
  )
}
