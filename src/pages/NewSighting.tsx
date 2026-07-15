import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CalendarBlank, Clock, ShieldCheck, Storefront, Users, ShoppingCart } from '@phosphor-icons/react'
import CatalogSearchSelect, { type CatalogSelection } from '../components/CatalogSearchSelect'
import CatalogSuggestionForm, {
  type ProductSuggestionValues,
  type StoreSuggestionValues,
} from '../components/CatalogSuggestionForm'
import ContributionDraftNotice from '../components/ContributionDraftNotice'
import PhotoUpload from '../components/PhotoUpload'
import {
  confirmLeadWithSighting,
  createSighting,
  discardContributionDraft,
  getLeadDetail,
  getMyContributionDrafts,
  saveContributionDraft,
  searchProducts,
  searchStores,
  suggestProductForDraft,
  suggestStoreForDraft,
} from '../lib/launchApi'
import { trackEvent } from '../lib/analytics'
import { mapContributionError } from '../lib/errorMap'
import type { ContributionDraft, LeadDetailView, StoreSearchResult } from '../types/database'

type SightingPayload = {
  version: 2
  product: CatalogSelection | null
  selectedStores: CatalogSelection[]
  seenAt: string
  availability: 'in_stock' | 'low_stock' | 'sold_out' | 'unknown'
  quantity: string
  notes: string
  photoUrls: string[]
  productSuggestionName?: string
  storeSuggestionName?: string
}

function localDateTime(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

function isSelection(value: unknown): value is CatalogSelection {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<CatalogSelection>
  return typeof candidate.id === 'string'
    && typeof candidate.label === 'string'
    && typeof candidate.detail === 'string'
}

export default function NewSighting() {
  const [searchParams] = useSearchParams()
  const leadSlug = searchParams.get('lead')
  const [product, setProduct] = useState<CatalogSelection | null>(null)
  const [selectedStores, setSelectedStores] = useState<CatalogSelection[]>([])
  const [storeQuery, setStoreQuery] = useState('')
  const [storeResults, setStoreResults] = useState<StoreSearchResult[]>([])
  const [seenAt, setSeenAt] = useState(() => localDateTime(new Date()))
  const [availability, setAvailability] = useState<'in_stock' | 'low_stock' | 'sold_out' | 'unknown'>('in_stock')
  const [quantity, setQuantity] = useState('')
  const [notes, setNotes] = useState('')
  const [draft, setDraft] = useState<ContributionDraft | null>(null)
  const [suggestion, setSuggestion] = useState<{ kind: 'product' | 'store'; initialName: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [suggestionError, setSuggestionError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [draftLoading, setDraftLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [lead, setLead] = useState<LeadDetailView | null>(null)
  const [leadLoading, setLeadLoading] = useState(false)
  const [photoUrls, setPhotoUrls] = useState<string[]>([])

  function currentPayload(): SightingPayload {
    return { version: 2, product, selectedStores, seenAt, availability, quantity, notes, photoUrls }
  }

  function handleProductChange(next: CatalogSelection | null) {
    setProduct(next)
    if (next && draft && (draft.state === 'waiting_for_approval' || draft.state === 'needs_attention')) {
      setDraft(null)
    }
  }

  function addStore(store: CatalogSelection) {
    if (!selectedStores.some(s => s.id === store.id)) {
      setSelectedStores([...selectedStores, store])
      if (draft && (draft.state === 'waiting_for_approval' || draft.state === 'needs_attention')) {
        setDraft(null)
      }
    }
  }

  function removeStore(id: string) {
    setSelectedStores(selectedStores.filter(s => s.id !== id))
  }

  async function restoreDraft(nextDraft: ContributionDraft) {
    const payload = nextDraft.payload as Partial<SightingPayload>
    setDraft(nextDraft)
    setProduct(isSelection(payload.product) ? payload.product : null)
    if (Array.isArray(payload.selectedStores)) setSelectedStores(payload.selectedStores.filter(isSelection))
    else if (isSelection((payload as Record<string, unknown>).store)) setSelectedStores([(payload as Record<string, unknown>).store as CatalogSelection])
    if (typeof payload.seenAt === 'string') setSeenAt(payload.seenAt)
    if (payload.availability === 'in_stock' || payload.availability === 'low_stock' || payload.availability === 'sold_out' || payload.availability === 'unknown') {
      setAvailability(payload.availability)
    }
    if (typeof payload.quantity === 'string') setQuantity(payload.quantity)
    if (typeof payload.notes === 'string') setNotes(payload.notes)
    if (Array.isArray(payload.photoUrls)) setPhotoUrls(payload.photoUrls.filter((u): u is string => typeof u === 'string'))
    if (!isSelection(payload.product) && nextDraft.product_id && payload.productSuggestionName) {
      const result = await searchProducts(payload.productSuggestionName)
      const match = (result.data ?? []).find((candidate) => candidate.id === nextDraft.product_id)
      if (match) setProduct({ id: match.id, slug: match.slug, label: match.name, detail: [match.trend_name, match.availability_status].filter(Boolean).join(' · ') })
    }
    if (selectedStores.length === 0 && nextDraft.store_id && payload.storeSuggestionName) {
      const result = await searchStores(payload.storeSuggestionName)
      const match = (result.data ?? []).find((candidate) => candidate.id === nextDraft.store_id)
      if (match) setSelectedStores([{ id: match.id, slug: match.slug, label: match.store_name || match.retailer_name, detail: `${match.address_line1}, ${match.city}, ${match.state} ${match.zip_code}` }])
    }
  }

  async function loadDraft() {
    const { data } = await getMyContributionDrafts()
    const nextDraft = (data ?? [])
      .filter((candidate) => candidate.draft_type === 'sighting')
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0]
    if (nextDraft) await restoreDraft(nextDraft)
  }

  useEffect(() => {
    void loadDraft()
  }, [])

  useEffect(() => {
    if (!leadSlug) return
    setLeadLoading(true)
    getLeadDetail(leadSlug).then(({ data, error: leadError }) => {
      setLeadLoading(false)
      if (leadError || !data) {
        setError('Could not load the lead for confirmation.')
        return
      }
      setLead(data)
      setProduct({ id: data.product_id, slug: data.product_slug, label: data.product_name, detail: '' })
      if (data.store_id && data.store_name) {
        setSelectedStores([{ id: data.store_id, slug: data.store_slug ?? '', label: data.store_name, detail: [data.store_city, data.store_state].filter(Boolean).join(', ') }])
      }
    })
  }, [leadSlug])

  async function saveDraft() {
    setError(null)
    setDraftLoading(true)
    const { error: saveError } = await saveContributionDraft({
      id: draft?.id ?? null,
      type: 'sighting',
      payload: currentPayload(),
      productId: product?.id ?? null,
      storeId: selectedStores[0]?.id ?? null,
    })
    setDraftLoading(false)
    if (saveError) {
      setError(mapContributionError(saveError))
      return
    }
    await loadDraft()
  }

  async function discardDraft() {
    if (!draft) return
    setDraftLoading(true)
    const { error: discardError } = await discardContributionDraft(draft.id)
    setDraftLoading(false)
    if (discardError) {
      setError(mapContributionError(discardError))
      return
    }
    setDraft(null)
  }

  async function submitSuggestion(values: ProductSuggestionValues | StoreSuggestionValues) {
    if (!suggestion) return
    setSuggestionError(null)
    setDraftLoading(true)
    const result = suggestion.kind === 'product'
      ? await suggestProductForDraft({
          draftId: draft?.id ?? null,
          type: 'sighting',
          payload: { ...currentPayload(), productSuggestionName: (values as ProductSuggestionValues).name },
          storeId: selectedStores[0]?.id ?? null,
          ...(values as ProductSuggestionValues),
        })
      : await suggestStoreForDraft({
          draftId: draft?.id ?? null,
          type: 'sighting',
          payload: { ...currentPayload(), storeSuggestionName: (values as StoreSuggestionValues).storeName ?? (values as StoreSuggestionValues).retailerName },
          productId: product?.id ?? null,
          ...(values as StoreSuggestionValues),
        })
    setDraftLoading(false)
    if (result.error) {
      setSuggestionError(result.error.message)
      return
    }
    setSuggestion(null)
    await loadDraft()
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    if (!product) {
      setError('Choose a verified product or submit it for approval.')
      return
    }
    if (selectedStores.length === 0) {
      setError('Choose at least one store or submit the location for approval.')
      return
    }
    if (draft?.state === 'waiting_for_approval' || draft?.state === 'needs_attention') {
      setError('This draft still needs owner review. Wait for approval or discard it and start again with catalog matches.')
      return
    }
    const seenDate = new Date(seenAt)
    const now = Date.now()
    if (Number.isNaN(seenDate.getTime()) || seenDate.getTime() < now - 7 * 24 * 60 * 60 * 1000 || seenDate.getTime() > now + 5 * 60 * 1000) {
      setError('The sighting time must be within the past 7 days and no more than 5 minutes in the future.')
      return
    }
    const parsedQuantity = quantity === '' ? null : Number(quantity)
    if (parsedQuantity !== null && (!Number.isInteger(parsedQuantity) || parsedQuantity < 1 || parsedQuantity > 99)) {
      setError('Quantity must be a whole number from 1 to 99.')
      return
    }

    setLoading(true)
    if (lead) {
      const { error: confirmError } = await confirmLeadWithSighting({
        leadId: lead.id,
        storeId: selectedStores[0].id,
        seenAt: seenDate.toISOString(),
        availability,
        quantity: parsedQuantity,
        notes: notes.trim() || null,
        photoUrls: photoUrls.length > 0 ? photoUrls : null,
      })
      setLoading(false)
      if (confirmError) {
        setError(mapContributionError(confirmError))
        return
      }
      trackEvent('confirm_lead', { availability })
      setSubmitted(true)
      return
    }
    let lastError: string | null = null
    for (let i = 0; i < selectedStores.length; i++) {
      const { error: createError } = await createSighting({
        productId: product.id,
        storeId: selectedStores[i].id,
        seenAt: seenDate.toISOString(),
        availability,
        quantity: parsedQuantity,
        notes: notes.trim() || null,
        draftId: i === 0 ? (draft?.id ?? null) : null,
        photoUrls: photoUrls.length > 0 ? photoUrls : null,
      })
      if (createError) {
        lastError = mapContributionError(createError)
        break
      }
    }
    setLoading(false)
    if (lastError) {
      setError(lastError)
      return
    }
    trackEvent('report_sighting', { availability, store_count: selectedStores.length })
    setSubmitted(true)
  }

  const seenDate = seenAt.slice(0, 10)
  const seenTime = seenAt.slice(11, 16)

  function updateSeenDate(date: string) {
    setSeenAt(`${date}T${seenTime || '12:00'}`)
  }
  function updateSeenTime(time: string) {
    setSeenAt(`${seenDate}T${time}`)
  }

  const availabilityOptions = [
    { value: 'in_stock', label: 'In Stock', activeClass: 'border-green-600 bg-green-50 text-green-700' },
    { value: 'low_stock', label: 'Low Stock', activeClass: 'border-yellow-500 bg-yellow-50 text-yellow-800' },
    { value: 'sold_out', label: 'Sold Out', activeClass: 'border-red-500 bg-red-50 text-red-700' },
    { value: 'unknown', label: 'Unknown', activeClass: 'border-gray-400 bg-gray-50 text-gray-600' },
  ] as const

  return (
    <div className="space-y-6">
      <div>
        <Link to={lead ? `/leads/${lead.slug}` : '/sightings'} className="text-sm text-gray-500 hover:text-gray-700">← {lead ? 'Back to lead' : 'Sightings'}</Link>
        <div className="mt-3 flex items-center gap-4">
          <div className="fiv-step-badge text-lg">1</div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{lead ? 'Confirm Lead' : 'New Sighting'}</h1>
            <p className="mt-0.5 text-sm text-gray-500">{lead ? 'Report what you saw to confirm this restock lead.' : 'Found it? Help the community by sharing the details.'}</p>
          </div>
          <div className="ml-auto hidden h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-100 to-brand-200 sm:flex">
            <ShoppingCart size={32} weight="duotone" className="text-brand-600" />
          </div>
        </div>
      </div>

      {lead && (
        <div className="rounded-xl border-2 border-brand-200 bg-brand-50 px-4 py-3">
          <p className="text-sm font-bold text-brand-700">Confirming lead: {lead.headline}</p>
          <p className="mt-1 text-xs text-brand-600">{lead.product_name}</p>
        </div>
      )}

      {leadLoading && (
        <div className="flex items-center justify-center py-8">
          <div className="h-6 w-6 animate-spin rounded-full border-4 border-brand-200 border-t-brand-500" />
        </div>
      )}

      {submitted && (
        <div className="card space-y-3 border-2 border-green-500 bg-green-50">
          <h2 className="text-lg font-bold text-green-800">Submitted for review</h2>
          <p className="text-sm text-green-700">Your sighting has been submitted and will be visible once approved by a moderator. You can track its status in your sightings list.</p>
          <div className="flex gap-2">
            <Link to="/sightings" className="btn-secondary">View sightings</Link>
            <button type="button" className="btn-primary" onClick={() => { setSubmitted(false); setProduct(null); setSelectedStores([]); setQuantity(''); setNotes(''); setPhotoUrls([]); setDraft(null) }}>Report another</button>
          </div>
        </div>
      )}

      {!submitted && !leadLoading && (
        <>
      {draft && <ContributionDraftNotice draft={draft} onDiscard={discardDraft} discarding={draftLoading} />}

      <form onSubmit={handleSubmit} className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        {/* LEFT COLUMN */}
        <div className="space-y-6">
          {/* Step 1: Matched Product */}
          <div className="space-y-3">
            <h2 className="fiv-section-heading"><span className="fiv-step-badge">1</span> Matched product</h2>
            <CatalogSearchSelect
              kind="product"
              label="Product"
              value={product}
              onChange={handleProductChange}
              onSuggest={(initialName) => setSuggestion({ kind: 'product', initialName })}
              required
            />
            {suggestion?.kind === 'product' && (
              <CatalogSuggestionForm kind="product" initialName={suggestion.initialName} loading={draftLoading} error={suggestionError} onCancel={() => setSuggestion(null)} onSubmit={submitSuggestion} />
            )}
          </div>

          {/* Step 2: Store Selection */}
          <div className="space-y-3">
            <h2 className="fiv-section-heading"><span className="fiv-step-badge">2</span> Where did you see it?</h2>
            <p className="text-xs text-gray-500">Select one or more stores where you spotted the product.</p>
            <div>
              <label className="label" htmlFor="store-search">Search stores *</label>
              <input
                id="store-search"
                className="input"
                type="text"
                value={storeQuery}
                onChange={async (event) => {
                  setStoreQuery(event.target.value)
                  if (event.target.value.trim().length >= 2) {
                    const result = await searchStores(event.target.value)
                    setStoreResults(result.data ?? [])
                  } else {
                    setStoreResults([])
                  }
                }}
                placeholder="Type a store name…"
              />
              {storeResults.length > 0 && (
                <div className="mt-2 space-y-1">
                  {storeResults.filter(s => !selectedStores.some(sel => sel.id === s.id)).map(s => (
                    <button
                      key={s.id}
                      type="button"
                      className="block w-full rounded-lg border border-gray-200 px-3 py-2 text-left text-sm hover:bg-gray-50"
                      onClick={() => {
                        addStore({ id: s.id, slug: s.slug, label: s.store_name || s.retailer_name, detail: `${s.address_line1}, ${s.city}, ${s.state} ${s.zip_code}` })
                        setStoreResults([])
                      }}
                    >
                      {s.store_name || s.retailer_name} — {s.city}, {s.state}
                    </button>
                  ))}
                </div>
              )}
              {storeQuery.trim().length >= 2 && storeResults.length === 0 && !suggestion && (
                <button
                  type="button"
                  className="mt-2 text-sm font-semibold text-brand-700 hover:text-brand-900"
                  onClick={() => setSuggestion({ kind: 'store', initialName: storeQuery.trim() })}
                >
                  Can't find it? Suggest a store
                </button>
              )}
            </div>
            {suggestion?.kind === 'store' && (
              <CatalogSuggestionForm kind="store" initialName={suggestion.initialName} loading={draftLoading} error={suggestionError} onCancel={() => setSuggestion(null)} onSubmit={submitSuggestion} />
            )}
            {selectedStores.length > 0 && (
              <div className="mt-2 space-y-2">
                {selectedStores.map(s => (
                  <div key={s.id} className="fiv-store-card fiv-store-card-selected">
                    <Storefront size={20} weight="fill" className="shrink-0 text-brand-600" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-gray-900">{s.label}</p>
                      <p className="truncate text-xs text-gray-500">{s.detail}</p>
                    </div>
                    <button
                      type="button"
                      className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                      onClick={() => removeStore(s.id)}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Step 3: Exact Location Notes */}
          <div className="space-y-3">
            <h2 className="fiv-section-heading"><span className="fiv-step-badge">3</span> Exact location <span className="text-xs font-normal text-gray-400">(Optional)</span></h2>
            <p className="text-xs text-gray-500">Help others find it faster.</p>
            <textarea
              className="input min-h-20"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              maxLength={2000}
              placeholder="Aisle G32, top shelf on the right..."
            />
            <p className="text-right text-xs text-gray-400">{notes.length}/2000</p>
          </div>
        </div>

        {/* RIGHT COLUMN */}
        <div className="space-y-6">
          {/* Step 4: Date & Time */}
          <div className="space-y-3">
            <h2 className="fiv-section-heading"><span className="fiv-step-badge">4</span> When did you see it?</h2>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="seen-date">Date</label>
                <div className="relative">
                  <CalendarBlank size={18} weight="duotone" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    id="seen-date"
                    className="input pr-10"
                    type="date"
                    value={seenDate}
                    min={new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)}
                    max={new Date(Date.now() + 5 * 60 * 1000).toISOString().slice(0, 10)}
                    onChange={(event) => updateSeenDate(event.target.value)}
                    required
                  />
                </div>
              </div>
              <div>
                <label className="label" htmlFor="seen-time">Time</label>
                <div className="relative">
                  <Clock size={18} weight="duotone" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    id="seen-time"
                    className="input pr-10"
                    type="time"
                    value={seenTime}
                    onChange={(event) => updateSeenTime(event.target.value)}
                    required
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Step 5: Photo Upload */}
          <div className="space-y-3">
            <h2 className="fiv-section-heading"><span className="fiv-step-badge">5</span> Upload a photo</h2>
            <p className="text-xs text-gray-500">A clear photo helps verify the sighting.</p>
            <PhotoUpload photoUrls={photoUrls} onChange={setPhotoUrls} maxPhotos={4} disabled={loading || draftLoading} />
          </div>

          {/* Availability */}
          <div className="space-y-3">
            <h2 className="fiv-section-heading"><span className="fiv-step-badge">6</span> Availability</h2>
            <fieldset>
              <legend className="sr-only">Availability</legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {availabilityOptions.map((opt) => (
                  <label key={opt.value} className={`fiv-availability-btn ${availability === opt.value ? opt.activeClass : 'fiv-availability-btn-inactive'}`}>
                    <input className="sr-only" type="radio" name="availability" value={opt.value} checked={availability === opt.value} onChange={() => setAvailability(opt.value)} />
                    {opt.label}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>

          {/* Quantity */}
          <div>
            <label className="label" htmlFor="quantity">Approximate quantity (optional)</label>
            <input id="quantity" className="input" type="number" min="1" max="99" step="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} placeholder="6" />
          </div>

          {/* Trust Notice */}
          <div className="fiv-notice-card flex items-start gap-2">
            <ShieldCheck size={18} weight="duotone" className="mt-0.5 shrink-0 text-amber-600" />
            <div>
              <p className="font-semibold">Photos are reviewed to prevent spam and misuse.</p>
              <p className="text-xs">Your location details help confirm the sighting.</p>
            </div>
          </div>
        </div>

        {/* ACTION STRIP */}
        {error && <div className="lg:col-span-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        <div className="lg:col-span-2 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2 text-sm text-gray-600">
            <Users size={18} weight="duotone" className="mt-0.5 shrink-0 text-brand-500" />
            <div>
              <p className="font-semibold text-gray-900">Thanks! Your sighting helps the community.</p>
              <p className="text-xs">It might make someone's day.</p>
            </div>
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <button type="button" className="btn-secondary sm:flex-1" onClick={saveDraft} disabled={loading || draftLoading}>
              {draftLoading ? 'Saving…' : 'Save private draft'}
            </button>
            <button type="submit" className="btn-primary sm:flex-[2]" disabled={loading || draftLoading}>
              {loading ? 'Submitting…' : lead ? 'Confirm lead' : 'Submit sighting'}
            </button>
          </div>
        </div>
      </form>
        </>
      )}
    </div>
  )
}
