import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { Product, Trend } from '../types/database'
import { mapProductHeat, trackProductOpen, type ProductHeat } from '../lib/productHeat'

export default function Products() {
  const [products, setProducts] = useState<Product[]>([])
  const [heat, setHeat] = useState<Record<string, ProductHeat>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const { data, error } = await supabase.from('products').select('*, trend:trends(*)').eq('is_active', true).order('name')
      if (error) { setLoading(false); return }
      const rows = (data ?? []) as Product[]
      setProducts(rows)
      const trends = new Map<string, Trend>()
      rows.forEach((product) => { if (product.trend) trends.set(product.trend_id, product.trend) })
      const heatRows = await Promise.all([...trends.keys()].map((trendId) => supabase.rpc('get_trend_click_heat', { p_trend_id: trendId })))
      setHeat(heatRows.reduce<Record<string, ProductHeat>>((all, result) => ({ ...all, ...(!result.error ? mapProductHeat(result.data) : {}) }), {}))
      setLoading(false)
    }
    void load()
  }, [])

  if (loading) return <div className="flex justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-200 border-t-brand-500" /></div>

  return <div className="mx-auto max-w-4xl space-y-5">
    <div><h1 className="text-2xl font-black text-stone-950">Browse products</h1><p className="mt-1 text-sm text-stone-600">Explore every tracked product. FiV Heat reflects recent interest within its trend.</p></div>
    <div className="grid gap-3 sm:grid-cols-2">
      {products.map((product) => {
        const score = heat[product.id]
        const value = score?.hasSignal ? score.heatPercent : 0
        return <Link key={product.id} to={`/products/${product.slug}`} onClick={() => { void trackProductOpen(product.id) }} className="grid grid-cols-[minmax(0,1fr)_5.5rem] overflow-hidden rounded-xl border-2 border-stone-950 bg-[#fffdf7] shadow-[3px_3px_0_0_#1c1917] hover:translate-x-0.5 hover:translate-y-0.5">
          <div className="min-w-0 p-3"><p className="text-xs font-bold text-brand-700">{product.trend?.name ?? 'Trend'}</p><h2 className="mt-1 font-black text-stone-950">{product.name}</h2></div>
          <div className="flex flex-col items-center justify-center gap-1 border-l-2 border-stone-950 bg-brand-50 px-2"><span className="text-[10px] font-black uppercase text-brand-800">FiV Heat</span><strong className="text-lg text-stone-950">{score?.hasSignal ? value : '—'}</strong><meter className="fiv-heat-meter" min={0} max={100} value={value} aria-label={`FiV Heat ${value} out of 100 for ${product.name}`} /></div>
        </Link>
      })}
    </div>
  </div>
}
