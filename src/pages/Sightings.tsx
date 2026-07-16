import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { Sighting, Product, Trend, Lead } from '../types/database'
import SightingCard from '../components/SightingCard'
import LeadCard from '../components/LeadCard'
import EmptyState from '../components/EmptyState'
import { activeMarket } from '../lib/market'
import { listPublicSightings, listPublicLeads } from '../lib/launchApi'
import { useViewerLocation } from '../contexts/ViewerLocationContext'

type Tab = 'all' | 'sightings' | 'leads'

type FeedItem =
  | { kind: 'sighting'; data: Sighting; sortKey: string }
  | { kind: 'lead'; data: Lead; sortKey: string }

export default function Sightings() {
  const viewerLocation = useViewerLocation()
  const [searchParams] = useSearchParams()
  const [sightings, setSightings] = useState<Sighting[]>([])
  const [leads, setLeads] = useState<Lead[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [trends, setTrends] = useState<Trend[]>([])
  const [loading, setLoading] = useState(true)
  const [trendFilter, setTrendFilter] = useState('')
  const [productFilter, setProductFilter] = useState(searchParams.get('product') ?? '')
  const [zipFilter, setZipFilter] = useState(activeMarket.defaultZip)
  const zipEditedRef = useRef(false)
  const [radiusFilter, setRadiusFilter] = useState('50')
  const [tab, setTab] = useState<Tab>('all')
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
  const effectiveZip = zipEditedRef.current ? zipFilter : viewerLocation.zipCode

  useEffect(() => {
    if (!viewerLocation.loading && !zipEditedRef.current) {
      setZipFilter(viewerLocation.zipCode)
    }
  }, [viewerLocation.loading, viewerLocation.zipCode])

  useEffect(() => {
    if (viewerLocation.loading && !zipEditedRef.current) return
    async function load() {
      setLoading(true)
      const [sightingsRes, leadsRes] = await Promise.all([
        listPublicSightings({
          productId: productFilter || null,
          limit: 50,
          zipCode: effectiveZip.trim() || null,
          radiusMiles: effectiveZip.trim() ? Number(radiusFilter) : null,
        }),
        listPublicLeads({
          productId: productFilter || null,
          limit: 50,
          zipCode: effectiveZip.trim() || null,
          radiusMiles: effectiveZip.trim() ? Number(radiusFilter) : null,
        }),
      ])

      if (sightingsRes.error) {
        setError('Failed to load sightings. Please try again.')
        setSightings([])
        setLeads([])
        setLoading(false)
        return
      }
      if (leadsRes.error) {
        setError('Failed to load leads. Please try again.')
        setLeads([])
        setLoading(false)
        return
      }

      setError(null)
      let sightingResults = sightingsRes.data as Sighting[] ?? []
      let leadResults = leadsRes.data as Lead[] ?? []

      if (!productFilter && trendFilter) {
        const trendProductIds = new Set(products.filter((product) => product.trend_id === trendFilter).map((product) => product.id))
        sightingResults = sightingResults.filter((sighting) => trendProductIds.has(sighting.product_id))
        leadResults = leadResults.filter((lead) => trendProductIds.has(lead.product_id))
      }

      setSightings(sightingResults)
      setLeads(leadResults)
      setLoading(false)
    }
    load()
  }, [productFilter, trendFilter, effectiveZip, radiusFilter, products, viewerLocation.loading])

  const feedItems: FeedItem[] = []
  if (tab === 'all' || tab === 'sightings') {
    for (const s of sightings) {
      feedItems.push({ kind: 'sighting', data: s, sortKey: s.seen_at ?? s.created_at })
    }
  }
  if (tab === 'all' || tab === 'leads') {
    for (const l of leads) {
      feedItems.push({ kind: 'lead', data: l, sortKey: l.created_at })
    }
  }
  feedItems.sort((a, b) => b.sortKey.localeCompare(a.sortKey))

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Local Sightings</h1>
      </div>

      <div className="flex gap-1 rounded-lg bg-stone-100 p-1">
        {(['all', 'sightings', 'leads'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-bold capitalize transition ${
              tab === t ? 'bg-white text-brand-700 shadow-sm' : 'text-stone-500 hover:text-stone-700'
            }`}
          >
            {t}
          </button>
        ))}
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
          onChange={(e) => { zipEditedRef.current = true; setZipFilter(e.target.value.replace(/\D/g, '')) }}
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
      ) : feedItems.length > 0 ? (
        <div className="space-y-3">
          {feedItems.map((item) =>
            item.kind === 'sighting'
              ? <SightingCard key={`s-${item.data.id}`} sighting={item.data} />
              : <LeadCard key={`l-${item.data.id}`} lead={item.data} />
          )}
        </div>
      ) : (
        <EmptyState
          title={tab === 'leads' ? 'No leads shared yet' : 'No sightings reported yet'}
          message={zipFilter ? 'No results within your search radius.' : 'Check back later, report what you find, or share a restock lead.'}
          action={
            <div className="flex gap-2">
              <Link to="/sightings/new" className="btn-secondary">Report a Sighting</Link>
              <Link to="/leads/new" className="btn-primary">Share a Lead</Link>
            </div>
          }
        />
      )}
    </div>
  )
}
