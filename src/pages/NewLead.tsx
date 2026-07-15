import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Megaphone, MapPin, ShieldCheck, Users } from '@phosphor-icons/react'
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

const radiusOptions = [10, 25, 50, 100, 250]

export default function NewLead() {
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
    const { error: createError } = await createLead({
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
  }

  return (
    <div className="space-y-6">
      <div>
        <Link to="/sightings" className="text-sm text-gray-500 hover:text-gray-700">← Sightings</Link>
        <div className="mt-3 flex items-center gap-4">
          <div className="fiv-step-badge text-lg">1</div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Share a Restock Lead</h1>
            <p className="mt-0.5 text-sm text-gray-500">Heard about an upcoming restock? Share what you know. Leads are unconfirmed until someone reports a sighting.</p>
          </div>
          <div className="ml-auto hidden h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-100 to-brand-200 sm:flex">
            <Megaphone size={32} weight="duotone" className="text-brand-600" />
          </div>
        </div>
      </div>

      {submitted && (
        <div className="card space-y-3 border-2 border-green-500 bg-green-50">
          <h2 className="text-lg font-bold text-green-800">Submitted for review</h2>
          <p className="text-sm text-green-700">
            Your lead has been submitted and will be visible once approved by a moderator.
          </p>
          <div className="flex gap-2">
            <Link to="/sightings" className="btn-secondary">Back to sightings</Link>
            <button type="button" className="btn-primary" onClick={() => { setSubmitted(false); setProduct(null); setHeadline(''); setDetails(''); setExpectedDate(''); setStore(null); setError(null) }}>Share another</button>
          </div>
        </div>
      )}

      {!submitted && (
        <form onSubmit={handleSubmit} className="grid gap-6 lg:grid-cols-[1fr_1fr]">
          {/* LEFT COLUMN */}
          <div className="space-y-6">
            {/* Step 1: Product */}
            <div className="space-y-3">
              <h2 className="fiv-section-heading"><span className="fiv-step-badge">1</span> What product is restocking?</h2>
              <CatalogSearchSelect
                kind="product"
                label="Product"
                value={product}
                onChange={setProduct}
                required
              />
            </div>

            {/* Step 2: Headline & Details */}
            <div className="space-y-3">
              <h2 className="fiv-section-heading"><span className="fiv-step-badge">2</span> Lead details</h2>
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
            </div>

            {/* Step 3: Search Area */}
            <div className="space-y-3">
              <h2 className="fiv-section-heading"><span className="fiv-step-badge">3</span> Search area</h2>
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
                <CatalogSearchSelect
                  kind="store"
                  label="Store"
                  value={store}
                  onChange={setStore}
                  required
                />
              )}

              {scope === 'region' && (
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
                    placeholder="Enter ZIP code"
                    required
                  />
                  <label className="label mt-3 text-xs">Desired Radius</label>
                  <div className="flex flex-wrap gap-2" role="group" aria-label="Desired search radius">
                    {radiusOptions.map((miles) => (
                      <button
                        key={miles}
                        type="button"
                        className={`fiv-radius-btn ${radiusMiles === String(miles) ? 'fiv-radius-btn-active' : 'fiv-radius-btn-inactive'}`}
                        onClick={() => setRadiusMiles(String(miles))}
                      >
                        {miles} mi
                      </button>
                    ))}
                  </div>
                  <div className="fiv-notice-card mt-3 flex items-start gap-2">
                    <MapPin size={18} weight="duotone" className="mt-0.5 shrink-0 text-amber-600" />
                    <div>
                      <p className="font-semibold">Shoppers within {radiusMiles} miles will see this lead.</p>
                      <p className="text-xs">The wider the radius, the more people can help confirm it.</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* RIGHT COLUMN */}
          <div className="space-y-6">
            {/* Step 4: Expected Date */}
            <div className="space-y-3">
              <h2 className="fiv-section-heading"><span className="fiv-step-badge">4</span> Expected date <span className="text-xs font-normal text-gray-400">(Optional)</span></h2>
              <p className="text-xs text-gray-500">When do you expect the restock to happen?</p>
              <input
                id="expected-date"
                className="input"
                type="date"
                value={expectedDate}
                onChange={(e) => setExpectedDate(e.target.value)}
              />
            </div>

            {/* Step 5: Source */}
            <div className="space-y-3">
              <h2 className="fiv-section-heading"><span className="fiv-step-badge">5</span> Source</h2>
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
            </div>

            {/* Trust Notice */}
            <div className="fiv-notice-card flex items-start gap-2">
              <ShieldCheck size={18} weight="duotone" className="mt-0.5 shrink-0 text-amber-600" />
              <div>
                <p className="font-semibold">Leads are reviewed to prevent spam and misuse.</p>
                <p className="text-xs">Your source helps verify the lead's credibility.</p>
              </div>
            </div>
          </div>

          {/* ACTION STRIP */}
          {error && <div className="lg:col-span-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

          <div className="lg:col-span-2 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-2 text-sm text-gray-600">
              <Users size={18} weight="duotone" className="mt-0.5 shrink-0 text-brand-500" />
              <div>
                <p className="font-semibold text-gray-900">Leads help the community spot restocks early.</p>
                <p className="text-xs">Someone might confirm it with a sighting.</p>
              </div>
            </div>
            <button type="submit" className="btn-primary sm:flex-[2]" disabled={loading}>
              {loading ? 'Submitting…' : 'Submit lead for review'}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
