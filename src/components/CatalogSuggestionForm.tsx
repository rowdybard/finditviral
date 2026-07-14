import { useState } from 'react'
import { activeMarket } from '../lib/market'

export type ProductSuggestionValues = {
  name: string
  brand: string | null
  sourceUrl: string | null
}

export type StoreSuggestionValues = {
  retailerName: string
  storeName: string | null
  addressLine1: string
  city: string
  state: string
  zipCode: string
  phone: string | null
  websiteUrl: string | null
}

type Props = {
  kind: 'product' | 'store'
  initialName?: string
  loading?: boolean
  error?: string | null
  onCancel: () => void
  onSubmit: (values: ProductSuggestionValues | StoreSuggestionValues) => void
}

export default function CatalogSuggestionForm({
  kind,
  initialName = '',
  loading = false,
  error = null,
  onCancel,
  onSubmit,
}: Props) {
  const [name, setName] = useState(initialName)
  const [brand, setBrand] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  const [storeName, setStoreName] = useState('')
  const [address, setAddress] = useState('')
  const [city, setCity] = useState('Lansing')
  const [state, setState] = useState(activeMarket.state)
  const [zip, setZip] = useState(activeMarket.defaultZip)
  const [phone, setPhone] = useState('')
  const [websiteUrl, setWebsiteUrl] = useState('')

  function submit() {
    if (kind === 'product') {
      onSubmit({
        name: name.trim(),
        brand: brand.trim() || null,
        sourceUrl: sourceUrl.trim() || null,
      })
      return
    }

    onSubmit({
      retailerName: name.trim(),
      storeName: storeName.trim() || null,
      addressLine1: address.trim(),
      city: city.trim(),
      state: state.trim().toUpperCase(),
      zipCode: zip.trim(),
      phone: phone.trim() || null,
      websiteUrl: websiteUrl.trim() || null,
    })
  }

  const valid = kind === 'product'
    ? name.trim().length >= 2
    : name.trim().length > 0
      && address.trim().length > 0
      && city.trim().length > 0
      && /^[a-z]{2}$/i.test(state.trim())
      && /^[0-9]{5}$/.test(zip)

  return (
    <div className="rounded-xl border border-brand-200 bg-brand-50/60 p-4">
      <h3 className="font-semibold text-gray-900">
        Suggest {kind === 'product' ? 'a product' : 'a store or boutique'}
      </h3>
      <p className="mt-1 text-xs leading-relaxed text-gray-600">
        An owner will verify this before it enters the catalog. Your contribution will be saved as a private draft; nothing publishes automatically.
      </p>

      <div className="mt-4 space-y-3">
        <div>
          <label className="label" htmlFor={`${kind}-suggestion-name`}>
            {kind === 'product' ? 'Product name' : 'Retailer or boutique name'} *
          </label>
          <input
            id={`${kind}-suggestion-name`}
            className="input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={160}
            required
          />
        </div>

        {kind === 'product' ? (
          <>
            <div>
              <label className="label" htmlFor="suggestion-brand">Brand (optional)</label>
              <input
                id="suggestion-brand"
                className="input"
                value={brand}
                onChange={(event) => setBrand(event.target.value)}
                maxLength={120}
              />
            </div>
            <div>
              <label className="label" htmlFor="suggestion-source">Official or retailer link (optional)</label>
              <input
                id="suggestion-source"
                className="input"
                type="url"
                value={sourceUrl}
                onChange={(event) => setSourceUrl(event.target.value)}
                placeholder="https://…"
                maxLength={500}
              />
            </div>
          </>
        ) : (
          <>
            <div>
              <label className="label" htmlFor="suggestion-store-name">Location label (optional)</label>
              <input
                id="suggestion-store-name"
                className="input"
                value={storeName}
                onChange={(event) => setStoreName(event.target.value)}
                placeholder="East Lansing, Store #123…"
                maxLength={160}
              />
            </div>
            <div>
              <label className="label" htmlFor="suggestion-address">Street address *</label>
              <input
                id="suggestion-address"
                className="input"
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                maxLength={200}
                required
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-[1fr_5rem_7rem]">
              <div>
                <label className="label" htmlFor="suggestion-city">City *</label>
                <input id="suggestion-city" className="input" value={city} onChange={(event) => setCity(event.target.value)} maxLength={100} required />
              </div>
              <div>
                <label className="label" htmlFor="suggestion-state">State *</label>
                <input id="suggestion-state" className="input" value={state} onChange={(event) => setState(event.target.value.replace(/[^a-z]/gi, '').slice(0, 2))} pattern="[A-Za-z]{2}" required />
              </div>
              <div>
                <label className="label" htmlFor="suggestion-zip">ZIP *</label>
                <input id="suggestion-zip" className="input" inputMode="numeric" value={zip} onChange={(event) => setZip(event.target.value.replace(/\D/g, '').slice(0, 5))} pattern="[0-9]{5}" required />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="suggestion-phone">Phone (optional)</label>
                <input id="suggestion-phone" className="input" type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} maxLength={40} />
              </div>
              <div>
                <label className="label" htmlFor="suggestion-website">Website (optional)</label>
                <input id="suggestion-website" className="input" type="url" value={websiteUrl} onChange={(event) => setWebsiteUrl(event.target.value)} placeholder="https://…" maxLength={500} />
              </div>
            </div>
          </>
        )}
      </div>

      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" className="btn-primary" disabled={loading || !valid} onClick={submit}>
          {loading ? 'Submitting…' : 'Submit for approval & save draft'}
        </button>
        <button type="button" className="btn-ghost" onClick={onCancel} disabled={loading}>Cancel</button>
      </div>
    </div>
  )
}
