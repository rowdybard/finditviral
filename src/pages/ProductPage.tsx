import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { Product, Bounty, Sighting } from '../types/database'
import BountyCard from '../components/BountyCard'
import SightingCard from '../components/SightingCard'
import EmptyState from '../components/EmptyState'

export default function ProductPage() {
  const { slug } = useParams<{ slug: string }>()
  const [product, setProduct] = useState<Product | null>(null)
  const [bounties, setBounties] = useState<Bounty[]>([])
  const [sightings, setSightings] = useState<Sighting[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!slug) return
    async function load() {
      const { data: productData } = await supabase
        .from('products')
        .select('*, trend(*)')
        .eq('slug', slug)
        .single()
      if (!productData) {
        setLoading(false)
        return
      }
      setProduct(productData as Product)

      const [bountiesRes, sightingsRes] = await Promise.all([
        supabase
          .from('bounties')
          .select('*, product(*), profile:profiles(*)')
          .eq('product_id', productData.id)
          .eq('status', 'open')
          .order('created_at', { ascending: false }),
        supabase
          .from('sightings')
          .select('*, product(*), profile:profiles(*)')
          .eq('product_id', productData.id)
          .eq('is_public', true)
          .order('created_at', { ascending: false }),
      ])

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
      <div>
        {product.trend && (
          <Link to={`/trends/${product.trend.slug}`} className="text-sm text-gray-500 hover:text-gray-700">
            ← {product.trend.name}
          </Link>
        )}
        <h1 className="mt-2 text-2xl font-bold text-gray-900">{product.name}</h1>
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
            title="No open bounties"
            message="No one is hunting for this product yet."
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
            title="No sightings"
            message="No one has spotted this product yet."
            action={<Link to="/sightings/new" className="btn-secondary">Report a Sighting</Link>}
          />
        )}
      </section>
    </div>
  )
}
