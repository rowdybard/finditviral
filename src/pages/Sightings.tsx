import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { Sighting, Product, Trend } from '../types/database'
import SightingCard from '../components/SightingCard'
import EmptyState from '../components/EmptyState'
import { activeMarket } from '../lib/market'
import { listPublicSightings } from '../lib/launchApi'

export default function Sightings() {
  const [sightings, setSightings] = useState<Sighting[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [trends, setTrends] = useState<Trend[]>([])
  const [loading, setLoading] = useState(true)
  const [trendFilter, setTrendFilter] = useState('')
  const [productFilter, setProductFilter] = useState('')
  const [zipFilter, setZipFilter] = useState(activeMarket.defaultZip)
  const [radiusFilter, setRadiusFilter] = useState('50')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase.from('trends').select('*').eq('is_active', true).order('name').then(({ data }) => {
      setTrends(data as Trend[] ?? [])
    })
    supabase.from('products').select('*, trend:trends(*)').eq('is_active', true).order('name').then(({ data }) => {
      setProducts(data as Product[] ?? [])
    })
  }, [])

  const filteredProducts = trendFilter
    ? products.filter((p) => p.trend_id === trendFilter)
    : products

  useEffect(() => {
    async function load() {
      setLoading(true)
      const { data, error: queryError } = await listPublicSightings({
        productId: productFilter || null,
        limit: 50,
        zipCode: zipFilter.trim() || null,
        radiusMiles: zipFilter.trim() ? Number(radiusFilter) : null,
      })
      if (queryError) {
        setError('Failed to load sightings. Please try again.')
        setSightings([])
        setLoading(false)
        return
      }
      setError(null)
      let results = data as Sighting[] ?? []
      if (!productFilter && trendFilter) {
        const trendProductIds = new Set(products.filter((product) => product.trend_id === trendFilter).map((product) => product.id))
        results = results.filter((sighting) => trendProductIds.has(sighting.product_id))
      }

      setSightings(results)
      setLoading(false)
    }
    load()
  }, [productFilter, trendFilter, zipFilter, radiusFilter, products])

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Local Sightings</h1>
        <Link to="/sightings/new" className="btn-primary text-sm">
          + Report Sighting
        </Link>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <select
          className="input sm:w-auto"
          value={trendFilter}
          onChange={(e) => { setTrendFilter(e.target.value); setProductFilter('') }}
        >
          <option value="">All trends</option>
          {trends.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
        <select
          className="input sm:w-auto"
          value={productFilter}
          onChange={(e) => setProductFilter(e.target.value)}
        >
          <option value="">All products</option>
          {filteredProducts.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <input
          className="input sm:w-32"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={5}
          placeholder="ZIP code"
          value={zipFilter}
          onChange={(e) => setZipFilter(e.target.value.replace(/\D/g, ''))}
        />
        <select
          className="input sm:w-32"
          value={radiusFilter}
          onChange={(e) => setRadiusFilter(e.target.value)}
          disabled={!zipFilter}
        >
          <option value="10">10 mi</option>
          <option value="25">25 mi</option>
          <option value="50">50 mi</option>
          <option value="100">100 mi</option>
          <option value="250">250 mi</option>
        </select>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-200 border-t-brand-500" />
        </div>
      ) : sightings.length > 0 ? (
        <div className="space-y-3">
          {sightings.map((s) => (
            <SightingCard key={s.id} sighting={s} />
          ))}
        </div>
      ) : (
        <EmptyState
          title="No sightings reported yet"
          message={zipFilter ? 'No sightings within your search radius.' : 'Check back later, report what you find, or post a bounty for local help.'}
          action={<Link to="/sightings/new" className="btn-secondary">Report a Sighting</Link>}
        />
      )}
    </div>
  )
}
