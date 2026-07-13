import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { Product, Bounty, Sighting } from '../types/database'
import BountyCard from '../components/BountyCard'
import SightingCard from '../components/SightingCard'
import EmptyState from '../components/EmptyState'
import { availabilityLabel, releaseLabel } from '../lib/productAvailability'

export default function ProductPage() {
  const { slug } = useParams<{ slug: string }>()
  const [product, setProduct] = useState<Product | null>(null)
  const [bounties, setBounties] = useState<Bounty[]>([])
  const [sightings, setSightings] = useState<Sighting[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!slug) return
    async function load() {
      const { data: productData, error: productError } = await supabase
        .from('products')
        .select('*, trend:trends(*)')
        .eq('slug', slug)
        .eq('is_active', true)
        .single()
      if (productError || !productData) {
        setLoading(false)
        return
      }
      setProduct(productData as Product)

      const [bountiesRes, sightingsRes] = await Promise.all([
        supabase
          .from('bounties')
          .select('*, product:products(*), profile:profiles(id, username, karma, is_pro, created_at)')
          .eq('product_id', productData.id)
          .eq('status', 'open')
          .order('created_at', { ascending: false }),
        supabase
          .from('sightings')
          .select('*, product:products(*), profile:profiles(id, username, karma, is_pro, created_at)')
          .eq('product_id', productData.id)
          .eq('is_public', true)
          .order('created_at', { ascending: false }),
      ])

      setBounties(bountiesRes.data as Bounty[] ?? [])
      setSightings(sightingsRes.data as Sighting[] ?? [])
      if (bountiesRes.error || sightingsRes.error) {
        setError('Some content failed to load.')
      }
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

  if (!product) {
    return (
      <EmptyState
        title="Product not found"
        message="This product may have been removed."
        action={<Link to="/" className="btn-primary">Go home</Link>}
      />
    )
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}
      <div>
        {product.trend && (
          <Link to={`/trends/${product.trend.slug}`} className="text-sm text-gray-500 hover:text-gray-700">
            ← {product.trend.name}
          </Link>
        )}
        <h1 className="mt-2 text-2xl font-bold text-gray-900">{product.name}</h1>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="rounded-full bg-brand-50 px-3 py-1 font-semibold text-brand-700">
            {availabilityLabel(product)}
          </span>
          {releaseLabel(product.release_date) && (
            <span className="text-gray-600">Releases {releaseLabel(product.release_date)}</span>
          )}
          {product.source_url && (
            <a href={product.source_url} target="_blank" rel="noreferrer" className="font-medium text-brand-600 hover:text-brand-700">
              Verify at {product.retailer ?? 'official source'} ↗
            </a>
          )}
        </div>
      </div>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Open Bounties</h2>
          <Link to="/bounties/new" className="text-sm font-medium text-brand-600 hover:text-brand-700">
            Post a bounty →
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
            title="No open bounties for this product"
            message="Post a bounty to ask local shoppers for help finding it."
            action={<Link to="/bounties/new" className="btn-primary">Post a Bounty</Link>}
          />
        )}
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Public Sightings</h2>
          <Link to="/sightings/new" className="text-sm font-medium text-brand-600 hover:text-brand-700">
            Report a sighting →
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
            title="No sightings reported for this product yet"
            message="Check back later, report what you find, or post a bounty for local help."
            action={<Link to="/sightings/new" className="btn-secondary">Report a Sighting</Link>}
          />
        )}
      </section>
    </div>
  )
}
