import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { Trend, Bounty, Sighting, Product } from '../types/database'
import BountyCard from '../components/BountyCard'
import SightingCard from '../components/SightingCard'
import EmptyState from '../components/EmptyState'

export default function Home() {
  const [trends, setTrends] = useState<Trend[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [bounties, setBounties] = useState<Bounty[]>([])
  const [sightings, setSightings] = useState<Sighting[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const [trendsRes, productsRes, bountiesRes, sightingsRes] = await Promise.all([
        supabase.from('trends').select('*').eq('is_active', true).order('created_at', { ascending: false }),
        supabase.from('products').select('*, trend(*)').order('name'),
        supabase
          .from('bounties')
          .select('*, product(*), profile:profiles(id, username, karma, is_pro, created_at)')
          .eq('status', 'open')
          .order('created_at', { ascending: false })
          .limit(5),
        supabase
          .from('sightings')
          .select('*, product(*), profile:profiles(id, username, karma, is_pro, created_at)')
          .eq('is_public', true)
          .order('created_at', { ascending: false })
          .limit(5),
      ])

      setTrends(trendsRes.data as Trend[] ?? [])
      setProducts(productsRes.data as Product[] ?? [])
      setBounties(bountiesRes.data as Bounty[] ?? [])
      setSightings(sightingsRes.data as Sighting[] ?? [])
      setLoading(false)
    }
    load()
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-200 border-t-brand-500" />
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <section className="text-center py-6">
        <h1 className="text-3xl font-bold text-gray-900">
          Find hard-to-find <span className="text-brand-500">viral</span> products
        </h1>
        <p className="mt-2 text-gray-600">
          Post bounties, report sightings, connect with finders. No fees, no middleman.
        </p>
        <div className="mt-4 flex justify-center gap-3">
          <Link to="/bounties/new" className="btn-primary">
            Post a Bounty
          </Link>
          <Link to="/sightings/new" className="btn-secondary">
            Report a Sighting
          </Link>
        </div>
      </section>

      {trends.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold text-gray-900">Active Trends</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {trends.map((trend) => {
              const trendProducts = products.filter((p) => p.trend_id === trend.id)
              const trendBounties = bounties.filter((b) => b.product?.trend_id === trend.id)
              const trendSightings = sightings.filter((s) => s.product?.trend_id === trend.id)
              return (
                <Link
                  key={trend.id}
                  to={`/trends/${trend.slug}`}
                  className="card block transition-shadow hover:shadow-md"
                >
                  <h3 className="font-semibold text-gray-900">{trend.name}</h3>
                  {trend.description && (
                    <p className="mt-1 line-clamp-2 text-sm text-gray-500">{trend.description}</p>
                  )}
                  <div className="mt-2 flex items-center gap-3 text-sm text-gray-400">
                    <span>{trendProducts.length} products</span>
                    <span>·</span>
                    <span>{trendBounties.length} bounties</span>
                    <span>·</span>
                    <span>{trendSightings.length} sightings</span>
                  </div>
                </Link>
              )
            })}
          </div>
        </section>
      )}

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Open Bounties</h2>
          <Link to="/bounties" className="text-sm font-medium text-brand-600 hover:text-brand-700">
            View all →
          </Link>
        </div>
        {bounties.length > 0 ? (
          <div className="space-y-3">
            {bounties.map((b) => (
              <BountyCard key={b.id} bounty={b} />
            ))}
          </div>
        ) : (
          <EmptyState
            title="No open bounties yet"
            message="Be the first to post a bounty for a hard-to-find product."
            action={<Link to="/bounties/new" className="btn-primary">Post a Bounty</Link>}
          />
        )}
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Recent Sightings</h2>
          <Link to="/sightings" className="text-sm font-medium text-brand-600 hover:text-brand-700">
            View all →
          </Link>
        </div>
        {sightings.length > 0 ? (
          <div className="space-y-3">
            {sightings.map((s) => (
              <SightingCard key={s.id} sighting={s} />
            ))}
          </div>
        ) : (
          <EmptyState
            title="No sightings yet"
            message="Report a sighting to help the community find stock."
            action={<Link to="/sightings/new" className="btn-secondary">Report a Sighting</Link>}
          />
        )}
      </section>
    </div>
  )
}
