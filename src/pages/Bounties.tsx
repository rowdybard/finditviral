import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { Bounty, Product, Trend } from '../types/database'
import BountyCard from '../components/BountyCard'
import EmptyState from '../components/EmptyState'
import { haversineMiles } from '../lib/distance'
import { activeMarket } from '../lib/market'

export default function Bounties() {
  const [bounties, setBounties] = useState<Bounty[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [trends, setTrends] = useState<Trend[]>([])
  const [loading, setLoading] = useState(true)
  const [trendFilter, setTrendFilter] = useState('')
  const [productFilter, setProductFilter] = useState('')
  const [zipFilter, setZipFilter] = useState(activeMarket.defaultZip)
  const [radiusFilter, setRadiusFilter] = useState('50')
  const [sortBy, setSortBy] = useState<'newest' | 'reward'>('newest')
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
      let query = supabase
        .from('bounties')
        .select('*, product:products(*), profile:profiles(id, username, karma, is_pro, created_at)')
        .eq('status', 'open')
        .order('created_at', { ascending: false })

      if (productFilter) {
        query = query.eq('product_id', productFilter)
      } else if (trendFilter) {
        const trendProductIds = products.filter((p) => p.trend_id === trendFilter).map((p) => p.id)
        if (trendProductIds.length > 0) {
          query = query.in('product_id', trendProductIds)
        } else {
          setBounties([])
          setLoading(false)
          return
        }
      }

      const { data, error: queryError } = await query
      if (queryError) {
        setError('Failed to load bounties. Please try again.')
        setBounties([])
        setLoading(false)
        return
      }
      setError(null)
      let results = data as Bounty[] ?? []

      if (zipFilter.trim()) {
        const { data: zipData } = await supabase
          .from('zip_codes')
          .select('latitude, longitude')
          .eq('zip_code', zipFilter.trim())
          .single()

        if (zipData) {
          const radius = parseInt(radiusFilter) || 50
          const userLat = zipData.latitude
          const userLon = zipData.longitude
          const bountyZipCodes = Array.from(new Set(results.map((b) => b.zip_code)))
          const { data: bountyZips } = await supabase
            .from('zip_codes')
            .select('zip_code, latitude, longitude')
            .in('zip_code', bountyZipCodes)
          const zipMap = new Map(
            (bountyZips ?? []).map((z) => [(z as { zip_code: string }).zip_code, z as { latitude: number; longitude: number }]),
          )
          const filtered: Bounty[] = []
          for (const b of results) {
            const bz = zipMap.get(b.zip_code)
            if (bz) {
              const dist = haversineMiles(userLat, userLon, bz.latitude, bz.longitude)
              if (dist <= radius) {
                filtered.push({ ...b, distance_miles: dist })
              }
            }
          }
          results = filtered
          results.sort((a, b) => (a.distance_miles ?? 0) - (b.distance_miles ?? 0))
        } else {
          results = []
        }
      }

      if (sortBy === 'reward') {
        results.sort((a, b) => b.reward_amount - a.reward_amount)
      }
      setBounties(results)
      setLoading(false)
    }
    load()
  }, [productFilter, trendFilter, zipFilter, radiusFilter, sortBy, products])

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Local Bounties</h1>
        <Link to="/bounties/new" className="btn-primary text-sm">
          + Post Bounty
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
        <select
          className="input sm:w-auto"
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as 'newest' | 'reward')}
        >
          <option value="newest">Newest</option>
          <option value="reward">Highest reward</option>
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
      ) : bounties.length > 0 ? (
        <div className="space-y-3">
          {bounties.map((b) => (
            <BountyCard key={b.id} bounty={b} />
          ))}
        </div>
      ) : (
        <EmptyState
          title="No bounties yet"
          message={zipFilter ? 'No bounties within your search radius.' : 'Be the first to post a bounty for a hard-to-find product.'}
          action={<Link to="/bounties/new" className="btn-primary">Post a Bounty</Link>}
        />
      )}
    </div>
  )
}
