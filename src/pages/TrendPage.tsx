import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { Trend, Product, Bounty, Sighting } from '../types/database'
import BountyCard from '../components/BountyCard'
import SightingCard from '../components/SightingCard'
import EmptyState from '../components/EmptyState'
import { availabilityLabel, releaseLabel } from '../lib/productAvailability'
import { mapProductHeat, trackProductOpen, type ProductHeat } from '../lib/productHeat'
import { listPublicBounties, listPublicSightings } from '../lib/launchApi'
import { useViewerLocation } from '../contexts/ViewerLocationContext'

export default function TrendPage() {
  const { slug } = useParams<{ slug: string }>()
  const viewerLocation = useViewerLocation()
  const [trend, setTrend] = useState<Trend | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [bounties, setBounties] = useState<Bounty[]>([])
  const [sightings, setSightings] = useState<Sighting[]>([])
  const [heatByProduct, setHeatByProduct] = useState<Record<string, ProductHeat>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!slug || viewerLocation.loading) return
    async function load() {
      setLoading(true)
      setError(null)
      setHeatByProduct({})

      const { data: trendData, error: trendError } = await supabase
        .from('trends')
        .select('*')
        .eq('slug', slug)
        .single()
      if (trendError || !trendData) {
        setLoading(false)
        return
      }
      setTrend(trendData as Trend)

      const { data: productsData, error: productsError } = await supabase
        .from('products')
        .select('*, trend:trends(*)')
        .eq('trend_id', trendData.id)
        .eq('is_active', true)
        .order('name')
      if (productsError) {
        setError('Failed to load products. Please try again.')
        setLoading(false)
        return
      }
      const productList = productsData as Product[] ?? []
      const productIds = productList.map((p) => p.id)

      const [bountiesRes, sightingsRes, heatRes] = await Promise.all([
        listPublicBounties({ limit: 50, zipCode: viewerLocation.zipCode }),
        listPublicSightings({ limit: 50, zipCode: viewerLocation.zipCode }),
        supabase.rpc('get_trend_click_heat', { p_trend_id: trendData.id }),
      ])

      const productsWithSightings = new Set(
        (sightingsRes.data ?? []).filter((sighting) => productIds.includes(sighting.product_id)).map((sighting) => sighting.product_id),
      )
      setProducts(productList.map((p) => ({ ...p, has_sightings: productsWithSightings.has(p.id) })))
      setBounties((bountiesRes.data as Bounty[] ?? []).filter((bounty) => productIds.includes(bounty.product_id)).slice(0, 10))
      setSightings((sightingsRes.data as Sighting[] ?? []).filter((sighting) => productIds.includes(sighting.product_id)).slice(0, 10))
      setHeatByProduct(heatRes.error ? {} : mapProductHeat(heatRes.data))
      if (bountiesRes.error || sightingsRes.error) {
        setError('Some content failed to load.')
      }
      setLoading(false)
    }
    load()
  }, [slug, viewerLocation.loading, viewerLocation.zipCode])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-200 border-t-brand-500" />
      </div>
    )
  }

  if (!trend) {
    return (
      <EmptyState
        title="Trend not found"
        message="This trend may have been removed."
        action={<Link to="/home" className="btn-primary">Go home</Link>}
      />
    )
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}
      <div>
        <Link to="/home" className="text-sm text-stone-500 hover:text-stone-700">← Home</Link>
        <h1 className="mt-2 text-2xl font-bold text-stone-900">{trend.name}</h1>
        {trend.description && <p className="mt-1 text-stone-600">{trend.description}</p>}
      </div>

      {products.length > 0 && (
        <section>
          <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
            <h2 className="text-lg font-semibold text-stone-900">Products</h2>
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-stone-500">
              <span className="text-brand-700">FiV Heat</span> · relative interest
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {products.map((p) => {
              const heat = heatByProduct[p.id]
              const hasHeatSignal = heat?.hasSignal === true
              const heatPercent = hasHeatSignal ? heat.heatPercent : 0

              return (
                <Link
                  key={p.id}
                  to={`/products/${p.slug}`}
                  onClick={() => { void trackProductOpen(p.id) }}
                  className="group grid min-h-28 grid-cols-[minmax(0,1fr)_5rem] overflow-hidden rounded-2xl border-2 border-stone-900 bg-white shadow-[4px_4px_0_0_#1c1917] transition duration-150 hover:-translate-y-0.5 hover:shadow-[6px_6px_0_0_#1c1917] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-300"
                >
                  <div className="min-w-0 p-4">
                    <h3 className="font-bold leading-snug text-stone-900 group-hover:text-brand-700">
                      {p.name}
                    </h3>
                    <p className={`mt-2 text-xs font-bold ${p.has_sightings ? 'text-brand-700' : 'text-stone-500'}`}>
                      {p.has_sightings ? availabilityLabel(p) : 'No sightings yet'}
                      {releaseLabel(p.release_date) ? ` · ${releaseLabel(p.release_date)}` : ''}
                    </p>
                  </div>

                  <div className="flex flex-col items-center justify-center gap-2 border-l-2 border-stone-900 bg-brand-50 px-2 py-3 text-center">
                    <span className="text-xs font-extrabold uppercase leading-none tracking-[0.06em] text-brand-800">
                      FiV Heat
                    </span>
                    <span className="text-lg font-black tabular-nums text-stone-900">
                      {hasHeatSignal ? heatPercent : '—'}
                    </span>
                    {hasHeatSignal ? (
                      <meter
                        className="fiv-heat-meter"
                        min={0}
                        value={heatPercent}
                        max={100}
                        aria-label={`FiV Heat score ${heatPercent} out of 100, based on product opens within ${trend.name}`}
                      >
                        {heatPercent} out of 100
                      </meter>
                    ) : (
                      <>
                        <span aria-hidden="true" className="h-3 w-full rounded-full border-2 border-stone-900 bg-white" />
                        <span className="sr-only">No product opens recorded for this trend yet.</span>
                      </>
                    )}
                  </div>
                </Link>
              )
            })}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-3 text-lg font-semibold text-stone-900">Open Bounties</h2>
        {bounties.length > 0 ? (
          <div className="space-y-3">
            {bounties.map((b) => (
              <BountyCard key={b.id} bounty={b} />
            ))}
          </div>
        ) : (
          <EmptyState
            title="No open bounties"
            message="No bounties posted for this trend yet."
          />
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-stone-900">Recent Sightings</h2>
        {sightings.length > 0 ? (
          <div className="space-y-3">
            {sightings.map((s) => (
              <SightingCard key={s.id} sighting={s} />
            ))}
          </div>
        ) : (
          <EmptyState
            title="No sightings"
            message="No sightings reported for this trend yet."
          />
        )}
      </section>
    </div>
  )
}
