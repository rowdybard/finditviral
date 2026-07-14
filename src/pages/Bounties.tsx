import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { Bounty, Product, Trend } from '../types/database'
import BountyCard from '../components/BountyCard'
import EmptyState from '../components/EmptyState'
import { activeMarket } from '../lib/market'
import { listPublicBounties } from '../lib/launchApi'

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
      const { data, error: queryError } = await listPublicBounties({
        productId: productFilter || null,
        limit: 50,
        zipCode: zipFilter.trim() || null,
        radiusMiles: zipFilter.trim() ? Number(radiusFilter) : null,
      })
      if (queryError) {
        setError('Failed to load bounties. Please try again.')
        setBounties([])
        setLoading(false)
        return
      }
      setError(null)
      let results = data as Bounty[] ?? []
      if (!productFilter && trendFilter) {
        const trendProductIds = new Set(products.filter((product) => product.trend_id === trendFilter).map((product) => product.id))
        results = results.filter((bounty) => trendProductIds.has(bounty.product_id))
      }

      if (sortBy === 'reward') {
        results.sort((a, b) => (b.reward_cents ?? Math.round((b.reward_amount ?? 0) * 100)) - (a.reward_cents ?? Math.round((a.reward_amount ?? 0) * 100)))
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
