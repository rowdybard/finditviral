import { useEffect, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import type { Product, Trend } from '../types/database'

export default function NewBounty() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [trends, setTrends] = useState<Trend[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [selectedTrend, setSelectedTrend] = useState('')
  const [selectedProduct, setSelectedProduct] = useState('')
  const [rewardAmount, setRewardAmount] = useState('')
  const [zipCode, setZipCode] = useState('')
  const [radiusMiles, setRadiusMiles] = useState('50')
  const [notes, setNotes] = useState('')
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
    const reward = parseFloat(rewardAmount)
    if (isNaN(reward) || reward <= 0) {
      setError('Please enter a valid reward amount.')
      return
    }
    if (zipCode.length !== 5) {
      setError('Please enter a valid 5-digit ZIP code.')
      return
    }

    setLoading(true)
    const { data, error: insertError } = await supabase
      .from('bounties')
      .insert({
        user_id: user.id,
        product_id: selectedProduct,
        reward_amount: reward,
        zip_code: zipCode,
        radius_miles: parseInt(radiusMiles),
        notes: notes.trim() || null,
        status: 'open',
      })
      .select('id')
      .single()

    setLoading(false)
    if (insertError) {
      setError(insertError.message)
      return
    }
    navigate(`/bounties/${data.id}`)
  }

  return (
    <div className="mx-auto max-w-md space-y-6">
      <div>
        <Link to="/bounties" className="text-sm text-gray-500 hover:text-gray-700">← Bounties</Link>
        <h1 className="mt-2 text-2xl font-bold text-gray-900">Post a Bounty</h1>
        <p className="mt-1 text-sm text-gray-500">
          Offer a reward for someone to find a product for you. Payment is arranged off-platform.
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
          <label className="label" htmlFor="reward">Reward amount ($) *</label>
          <input
            id="reward"
            className="input"
            type="number"
            min="1"
            step="1"
            value={rewardAmount}
            onChange={(e) => setRewardAmount(e.target.value)}
            placeholder="20"
            required
          />
        </div>

        <div className="flex gap-3">
          <div className="flex-1">
            <label className="label" htmlFor="zip">Your ZIP code *</label>
            <input
              id="zip"
              className="input"
              type="text"
              inputMode="numeric"
              pattern="[0-9]{5}"
              maxLength={5}
              value={zipCode}
              onChange={(e) => setZipCode(e.target.value.replace(/\D/g, ''))}
              placeholder="90210"
              required
            />
          </div>
          <div className="w-28">
            <label className="label" htmlFor="radius">Radius</label>
            <select
              id="radius"
              className="input"
              value={radiusMiles}
              onChange={(e) => setRadiusMiles(e.target.value)}
            >
              <option value="10">10 mi</option>
              <option value="25">25 mi</option>
              <option value="50">50 mi</option>
              <option value="100">100 mi</option>
              <option value="250">250 mi</option>
            </select>
          </div>
        </div>

        <div>
          <label className="label" htmlFor="notes">Notes (optional)</label>
          <textarea
            id="notes"
            className="input min-h-20"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Color preference, quantity, etc."
            maxLength={500}
          />
        </div>

        {error && (
          <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <button type="submit" className="btn-primary w-full" disabled={loading}>
          {loading ? 'Posting...' : 'Post Bounty'}
        </button>
      </form>
    </div>
  )
}
