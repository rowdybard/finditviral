import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { Trend, Product, Bounty, Sighting } from '../types/database'
import BountyCard from '../components/BountyCard'
import SightingCard from '../components/SightingCard'
import EmptyState from '../components/EmptyState'

export default function TrendPage() {
  const { slug } = useParams<{ slug: string }>()
  const [trend, setTrend] = useState<Trend | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [bounties, setBounties] = useState<Bounty[]>([])
  const [sightings, setSightings] = useState<Sighting[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!slug) return
    async function load() {
      const { data: trendData } = await supabase
        .from('trends')
        .select('*')
        .eq('slug', slug)
        .single()
      if (!trendData) {
        setLoading(false)
        return
      }
      setTrend(trendData as Trend)

      const { data: productsData } = await supabase
        .from('products')
        .select('*')
        .eq('trend_id', trendData.id)
        .order('name')
      const productList = productsData as Product[] ?? []
      const productIds = productList.map((p) => p.id)

      const [bountiesRes, sightingsRes] = await Promise.all([
        supabase
          .from('bounties')
          .select('*, product(*), profile:profiles(id, username, karma, is_pro, created_at)')
          .eq('status', 'open')
          .in('product_id', productIds)
          .order('created_at', { ascending: false })
          .limit(10),
        supabase
          .from('sightings')
          .select('*, product(*), profile:profiles(id, username, karma, is_pro, created_at)')
          .eq('is_public', true)
          .in('product_id', productIds)
          .order('created_at', { ascending: false })
          .limit(10),
      ])

      setProducts(productList)
      setBounties(bountiesRes.data as Bounty[] ?? [])
      setSightings(sightingsRes.data as Sighting[] ?? [])
      setLoading(false)
    }
    load()
  }, [slug])

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
        action={<Link to="/" className="btn-primary">Go home</Link>}
      />
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <Link to="/" className="text-sm text-gray-500 hover:text-gray-700">← Home</Link>
        <h1 className="mt-2 text-2xl font-bold text-gray-900">{trend.name}</h1>
        {trend.description && <p className="mt-1 text-gray-600">{trend.description}</p>}
      </div>

      {products.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold text-gray-900">Products</h2>
          <div className="grid grid-cols-2 gap-3">
            {products.map((p) => (
              <Link
                key={p.id}
                to={`/products/${p.slug}`}
                className="card transition-shadow hover:shadow-md"
              >
                <h3 className="font-medium text-gray-900">{p.name}</h3>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-3 text-lg font-semibold text-gray-900">Open Bounties</h2>
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
        <h2 className="mb-3 text-lg font-semibold text-gray-900">Recent Sightings</h2>
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
