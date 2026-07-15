import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import CatalogSearchSelect, { type CatalogSelection } from '../components/CatalogSearchSelect'
import { createLead } from '../lib/launchApi'
import { activeMarket } from '../lib/market'
import { trackEvent } from '../lib/analytics'
import { mapContributionError } from '../lib/errorMap'

const sourceTypeOptions = [
  { value: 'employee_tip', label: 'Employee tip' },
  { value: 'social_media', label: 'Social media' },
  { value: 'press_release', label: 'Press release' },
  { value: 'restock_schedule', label: 'Restock schedule' },
  { value: 'other', label: 'Other' },
] as const

export default function NewLead() {
  const navigate = useNavigate()
  const [product, setProduct] = useState<CatalogSelection | null>(null)
  const [headline, setHeadline] = useState('')
  const [details, setDetails] = useState('')
  const [expectedDate, setExpectedDate] = useState('')
  const [scope, setScope] = useState<'region' | 'stores'>('region')
  const [store, setStore] = useState<CatalogSelection | null>(null)
  const [zipCode, setZipCode] = useState(activeMarket.defaultZip)
  const [radiusMiles, setRadiusMiles] = useState('50')
  const [sourceType, setSourceType] = useState<typeof sourceTypeOptions[number]['value']>('employee_tip')
  const [sourceUrl, setSourceUrl] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)

    if (!product) {
      setError('Choose a product.')
      return
    }
    if (headline.trim().length < 3) {
      setError('Headline must be at least 3 characters.')
      return
    }
    if (headline.trim().length > 140) {
      setError('Headline must be 140 characters or fewer.')
      return
    }
    if (scope === 'stores' && !store) {
      setError('Choose a store.')
      return
    }
    if (scope === 'region' && !/^[0-9]{5}$/.test(zipCode)) {
      setError('Enter a valid 5-digit ZIP code.')
      return
    }

    setLoading(true)
    const { data: leadId, error: createError } = await createLead({
      productId: product.id,
      headline: headline.trim(),
      details: details.trim() || null,
      expectedDate: expectedDate || null,
      scopeType: scope,
      storeId: scope === 'stores' ? store?.id ?? null : null,
      zipCode: scope === 'region' ? zipCode : null,
      radiusMiles: scope === 'region' ? Number(radiusMiles) : null,
      sourceType,
      sourceUrl: sourceUrl.trim() || null,
    })
    setLoading(false)

    if (createError) {
      setError(mapContributionError(createError))
      return
    }

    trackEvent('post_lead', { scope, source_type: sourceType })
    setSubmitted(true)
    if (leadId) {
      setTimeout(() => navigate('/sightings'), 1500)
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <Link to="/sightings" className="text-sm text-gray-500 hover:text-gray-700">← Sightings</Link>
        <h1 className="mt-2 text-2xl font-bold text-gray-900">Share a Restock Lead</h1>
        <p className="mt-1 text-sm text-gray-500">
          Heard about an upcoming restock? Share what you know. Leads are unconfirmed until someone reports a sighting.
        </p>
      </div>

      {submitted && (
        <div className="card space-y-3 border-2 border-green-500 bg-green-50">
          <h2 className="text-lg font-bold text-green-800">Submitted for review</h2>
          <p className="text-sm text-green-700">
            Your lead has been submitted and will be visible once approved by a moderator.
          </p>
          <Link to="/sightings" className="btn-secondary">Back to sightings</Link>
        </div>
      )}

      {!submitted && (
        <form onSubmit={handleSubmit} className="space-y-5">
          <CatalogSearchSelect
            kind="product"
            label="Product"
            value={product}
            onChange={setProduct}
            required
          />

          <div>
            <label className="label" htmlFor="headline">Headline *</label>
            <input
              id="headline"
              className="input"
              type="text"
              value={headline}
              onChange={(e) => setHeadline(e.target.value)}
              maxLength={140}
              placeholder="Expected restock at Target Lansing"
              required
            />
            <p className="mt-1 text-right text-xs text-gray-400">{headline.length}/140</p>
          </div>

          <div>
            <label className="label" htmlFor="details">Details (optional)</label>
            <textarea
              id="details"
              className="input min-h-24"
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              maxLength={2000}
              placeholder="What did you hear? When? Any specifics about quantity or variants?"
            />
            <p className="mt-1 text-right text-xs text-gray-400">{details.length}/2000</p>
          </div>

          <div>
            <label className="label" htmlFor="expected-date">Expected date (optional)</label>
            <input
              id="expected-date"
              className="input"
              type="date"
              value={expectedDate}
              onChange={(e) => setExpectedDate(e.target.value)}
            />
          </div>

          <fieldset>
            <legend className="label">Where is this lead about? *</legend>
            <div className="grid grid-cols-2 gap-2">
              <label className={`cursor-pointer rounded-lg border-2 px-3 py-3 text-center text-sm font-semibold ${scope === 'region' ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-gray-200 bg-white text-gray-600'}`}>
                <input className="sr-only" type="radio" name="scope" checked={scope === 'region'} onChange={() => setScope('region')} />
                ZIP Radius
              </label>
              <label className={`cursor-pointer rounded-lg border-2 px-3 py-3 text-center text-sm font-semibold ${scope === 'stores' ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-gray-200 bg-white text-gray-600'}`}>
                <input className="sr-only" type="radio" name="scope" checked={scope === 'stores'} onChange={() => setScope('stores')} />
                Store
              </label>
            </div>
          </fieldset>

          {scope === 'stores' && (
            <>
              <CatalogSearchSelect
                kind="store"
                label="Store"
                value={store}
                onChange={setStore}
                required
              />
            </>
          )}

          {scope === 'region' && (
            <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
              <div>
                <label className="label" htmlFor="zip">Origin ZIP *</label>
                <input
                  id="zip"
                  className="input"
                  inputMode="numeric"
                  pattern="[0-9]{5}"
                  maxLength={5}
                  value={zipCode}
                  onChange={(e) => setZipCode(e.target.value.replace(/\D/g, ''))}
                  required
                />
              </div>
              <div>
                <label className="label" htmlFor="radius">Radius</label>
                <select id="radius" className="input" value={radiusMiles} onChange={(e) => setRadiusMiles(e.target.value)}>
                  {[10, 25, 50, 100, 250].map((miles) => <option key={miles} value={miles}>{miles} mi</option>)}
                </select>
              </div>
            </div>
          )}

          <div>
            <label className="label" htmlFor="source-type">Source type *</label>
            <select
              id="source-type"
              className="input"
              value={sourceType}
              onChange={(e) => setSourceType(e.target.value as typeof sourceTypeOptions[number]['value'])}
            >
              {sourceTypeOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="label" htmlFor="source-url">Source URL (optional)</label>
            <input
              id="source-url"
              className="input"
              type="url"
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              maxLength={2000}
              placeholder="https://..."
            />
          </div>

          {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

          <button type="submit" className="btn-primary w-full" disabled={loading}>
            {loading ? 'Submitting…' : 'Submit lead for review'}
          </button>
        </form>
      )}
    </div>
  )
}
