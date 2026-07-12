import { useEffect, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { trackEvent } from '../lib/analytics'
import type { Product, Trend } from '../types/database'
import { activeMarket, citySuggestions } from '../lib/market'

export default function NewSighting() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [trends, setTrends] = useState<Trend[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [selectedTrend, setSelectedTrend] = useState('')
  const [selectedProduct, setSelectedProduct] = useState('')
  const [storeName, setStoreName] = useState('')
  const [city, setCity] = useState('')
  const [state, setState] = useState('MI')
  const [zipCode, setZipCode] = useState('')
  const [stockLevel, setStockLevel] = useState('in_stock')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    supabase.from('trends').select('*').eq('is_active', true).order('name').then(({ data }) => {
      setTrends(data as Trend[] ?? [])
    })
    supabase.from('products').select('*, trend(*)').order('name').then(({ data }) => {
      setProducts(data as Product[] ?? [])
    })
  }, [])

  const filteredProducts = selectedTrend
    ? products.filter((p) => p.trend_id === selectedTrend)
    : products

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!user) return
    if (!selectedProduct) {
      setError('Please select a product.')
      return
    }
    if (!storeName.trim()) {
      setError('Store name is required.')
      return
    }
    if (storeName.trim().length > 120) {
      setError('Store name must be 120 characters or fewer.')
      return
    }
    if (city.trim() && city.trim().length > 100) {
      setError('City must be 100 characters or fewer.')
      return
    }
    if (zipCode.trim() && !/^[0-9]{5}$/.test(zipCode.trim())) {
      setError('Please enter a valid 5-digit ZIP code.')
      return
    }

    setLoading(true)
    const { error: insertError } = await supabase
      .from('sightings')
      .insert({
        user_id: user.id,
        product_id: selectedProduct,
        store_name: storeName.trim(),
        city: city.trim() || null,
        state: state.trim() || null,
        zip_code: zipCode.trim() || null,
        stock_level: stockLevel,
        is_public: true,
        bounty_id: null,
      })

    setLoading(false)
    if (insertError) {
      setError(insertError.message)
      return
    }
    trackEvent('report_sighting', { stock_level: stockLevel })
    navigate('/sightings')
  }

  return (
    <div className="mx-auto max-w-md space-y-6">
      <div>
        <Link to="/sightings" className="text-sm text-gray-500 hover:text-gray-700">← Sightings</Link>
        <h1 className="mt-2 text-2xl font-bold text-gray-900">Report a Sighting</h1>
        <p className="mt-1 text-sm text-gray-500">
          Spotted something? Share it so others don't waste a trip.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="label" htmlFor="trend">Trend</label>
          <select
            id="trend"
            className="input"
            value={selectedTrend}
            onChange={(e) => {
              setSelectedTrend(e.target.value)
              setSelectedProduct('')
            }}
          >
            <option value="">All trends</option>
            {trends.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="label" htmlFor="product">Product *</label>
          <select
            id="product"
            className="input"
            value={selectedProduct}
            onChange={(e) => setSelectedProduct(e.target.value)}
            required
          >
            <option value="">Select a product</option>
            {filteredProducts.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="label" htmlFor="store">Store name *</label>
          <input
            id="store"
            className="input"
            value={storeName}
            onChange={(e) => setStoreName(e.target.value)}
            placeholder={activeMarket.storePlaceholder}
            maxLength={120}
            required
          />
        </div>

        <div className="flex gap-3">
          <div className="flex-1">
            <label className="label" htmlFor="city">City</label>
            <input
              id="city"
              className="input"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              list="city-suggestions"
              maxLength={100}
            />
            <datalist id="city-suggestions">
              {citySuggestions().map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
          <div className="w-20">
            <label className="label" htmlFor="state">State</label>
            <input
              id="state"
              className="input"
              value={state}
              onChange={(e) => setState(e.target.value.toUpperCase().slice(0, 2))}
              maxLength={2}
            />
          </div>
        </div>

        <div>
          <label className="label" htmlFor="zip">ZIP code</label>
          <input
            id="zip"
            className="input"
            type="text"
            inputMode="numeric"
            maxLength={5}
            value={zipCode}
            onChange={(e) => setZipCode(e.target.value.replace(/\D/g, ''))}
            placeholder="48910"
          />
        </div>

        <div>
          <label className="label" htmlFor="stock">Stock level</label>
          <select
            id="stock"
            className="input"
            value={stockLevel}
            onChange={(e) => setStockLevel(e.target.value)}
          >
            <option value="in_stock">In Stock</option>
            <option value="low">Low Stock</option>
            <option value="none">Out of Stock</option>
          </select>
        </div>

        {error && (
          <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <button type="submit" className="btn-primary w-full" disabled={loading}>
          {loading ? 'Reporting...' : 'Report Sighting'}
        </button>
      </form>
    </div>
  )
}
