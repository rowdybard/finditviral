import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import CatalogSearchSelect, { type CatalogSelection } from '../components/CatalogSearchSelect'
import CatalogSuggestionForm, {
  type ProductSuggestionValues,
  type StoreSuggestionValues,
} from '../components/CatalogSuggestionForm'
import ContributionDraftNotice from '../components/ContributionDraftNotice'
import {
  createSighting,
  discardContributionDraft,
  getMyContributionDrafts,
  saveContributionDraft,
  searchProducts,
  searchStores,
  suggestProductForDraft,
  suggestStoreForDraft,
} from '../lib/launchApi'
import { trackEvent } from '../lib/analytics'
import { mapContributionError } from '../lib/errorMap'
import type { ContributionDraft } from '../types/database'

type SightingPayload = {
  version: 1
  product: CatalogSelection | null
  store: CatalogSelection | null
  seenAt: string
  availability: 'in_stock' | 'low_stock' | 'sold_out' | 'unknown'
  quantity: string
  notes: string
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
  const [product, setProduct] = useState<CatalogSelection | null>(null)
  const [store, setStore] = useState<CatalogSelection | null>(null)
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

  function currentPayload(): SightingPayload {
    return { version: 1, product, store, seenAt, availability, quantity, notes }
  }

  async function restoreDraft(nextDraft: ContributionDraft) {
    const payload = nextDraft.payload as Partial<SightingPayload>
    setDraft(nextDraft)
    setProduct(isSelection(payload.product) ? payload.product : null)
    setStore(isSelection(payload.store) ? payload.store : null)
    if (typeof payload.seenAt === 'string') setSeenAt(payload.seenAt)
    if (payload.availability === 'in_stock' || payload.availability === 'low_stock' || payload.availability === 'sold_out' || payload.availability === 'unknown') {
      setAvailability(payload.availability)
    }
    if (typeof payload.quantity === 'string') setQuantity(payload.quantity)
    if (typeof payload.notes === 'string') setNotes(payload.notes)
    if (!isSelection(payload.product) && nextDraft.product_id && payload.productSuggestionName) {
      const result = await searchProducts(payload.productSuggestionName)
      const match = (result.data ?? []).find((candidate) => candidate.id === nextDraft.product_id)
      if (match) setProduct({ id: match.id, slug: match.slug, label: match.name, detail: [match.trend_name, match.availability_status].filter(Boolean).join(' · ') })
    }
    if (!isSelection(payload.store) && nextDraft.store_id && payload.storeSuggestionName) {
      const result = await searchStores(payload.storeSuggestionName)
      const match = (result.data ?? []).find((candidate) => candidate.id === nextDraft.store_id)
      if (match) setStore({ id: match.id, slug: match.slug, label: match.store_name || match.retailer_name, detail: `${match.address_line1}, ${match.city}, ${match.state} ${match.zip_code}` })
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

  async function saveDraft() {
    setError(null)
    setDraftLoading(true)
    const { error: saveError } = await saveContributionDraft({
      id: draft?.id ?? null,
      type: 'sighting',
      payload: currentPayload(),
      productId: product?.id ?? null,
      storeId: store?.id ?? null,
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
          storeId: store?.id ?? null,
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
    if (!store) {
      setError('Choose the exact store where you saw it or submit the location for approval.')
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
    const { error: createError } = await createSighting({
      productId: product.id,
      storeId: store.id,
      seenAt: seenDate.toISOString(),
      availability,
      quantity: parsedQuantity,
      notes: notes.trim() || null,
      draftId: draft?.id ?? null,
    })
    setLoading(false)
    if (createError) {
      setError(mapContributionError(createError))
      return
    }
    trackEvent('report_sighting', { availability })
    setSubmitted(true)
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <Link to="/sightings" className="text-sm text-gray-500 hover:text-gray-700">← Sightings</Link>
        <h1 className="mt-2 text-2xl font-bold text-gray-900">Report a Sighting</h1>
        <p className="mt-1 text-sm text-gray-500">Share a fresh, exact store sighting so another shopper can act on it.</p>
      </div>

      {submitted && (
        <div className="card space-y-3 border-2 border-green-500 bg-green-50">
          <h2 className="text-lg font-bold text-green-800">Submitted for review</h2>
          <p className="text-sm text-green-700">Your sighting has been submitted and will be visible once approved by a moderator. You can track its status in your sightings list.</p>
          <div className="flex gap-2">
            <Link to="/sightings" className="btn-secondary">View sightings</Link>
            <button type="button" className="btn-primary" onClick={() => { setSubmitted(false); setProduct(null); setStore(null); setQuantity(''); setNotes(''); setDraft(null) }}>Report another</button>
          </div>
        </div>
      )}

      {!submitted && (
        <>
      {draft && <ContributionDraftNotice draft={draft} onDiscard={discardDraft} discarding={draftLoading} />}

      <form onSubmit={handleSubmit} className="space-y-5">
        <CatalogSearchSelect
          kind="product"
          label="Product"
          value={product}
          onChange={setProduct}
          onSuggest={(initialName) => setSuggestion({ kind: 'product', initialName })}
          required
        />
        {suggestion?.kind === 'product' && (
          <CatalogSuggestionForm
            kind="product"
            initialName={suggestion.initialName}
            loading={draftLoading}
            error={suggestionError}
            onCancel={() => setSuggestion(null)}
            onSubmit={submitSuggestion}
          />
        )}

        <CatalogSearchSelect
          kind="store"
          label="Exact store"
          value={store}
          onChange={setStore}
          onSuggest={(initialName) => setSuggestion({ kind: 'store', initialName })}
          required
        />
        {suggestion?.kind === 'store' && (
          <CatalogSuggestionForm
            kind="store"
            initialName={suggestion.initialName}
            loading={draftLoading}
            error={suggestionError}
            onCancel={() => setSuggestion(null)}
            onSubmit={submitSuggestion}
          />
        )}

        <div>
          <label className="label" htmlFor="seen-at">When did you see it? *</label>
          <input
            id="seen-at"
            className="input"
            type="datetime-local"
            value={seenAt}
            min={localDateTime(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000))}
            max={localDateTime(new Date(Date.now() + 5 * 60 * 1000))}
            onChange={(event) => setSeenAt(event.target.value)}
            required
          />
        </div>

        <fieldset>
          <legend className="label">Availability *</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {([
              ['in_stock', 'In Stock', 'border-green-600 bg-green-50 text-green-700'],
              ['low_stock', 'Low Stock', 'border-yellow-500 bg-yellow-50 text-yellow-800'],
              ['sold_out', 'Sold Out', 'border-red-500 bg-red-50 text-red-700'],
              ['unknown', 'Unknown', 'border-gray-400 bg-gray-50 text-gray-600'],
            ] as const).map(([value, label, activeClass]) => (
              <label key={value} className={`cursor-pointer rounded-lg border-2 px-3 py-3 text-center text-sm font-semibold ${availability === value ? activeClass : 'border-gray-200 bg-white text-gray-600'}`}>
                <input className="sr-only" type="radio" name="availability" value={value} checked={availability === value} onChange={() => setAvailability(value)} />
                {label}
              </label>
            ))}
          </div>
        </fieldset>

        <div>
          <label className="label" htmlFor="quantity">Approximate quantity (optional)</label>
          <input id="quantity" className="input" type="number" min="1" max="99" step="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} placeholder="6" />
        </div>

        <div>
          <label className="label" htmlFor="notes">Helpful details (optional)</label>
          <textarea id="notes" className="input min-h-24" value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={2000} placeholder="Aisle, color, size, display location…" />
          <p className="mt-1 text-right text-xs text-gray-400">{notes.length}/2000</p>
        </div>

        {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <button type="button" className="btn-secondary sm:flex-1" onClick={saveDraft} disabled={loading || draftLoading}>
            {draftLoading ? 'Saving…' : 'Save private draft'}
          </button>
          <button type="submit" className="btn-primary sm:flex-[2]" disabled={loading || draftLoading}>
            {loading ? 'Submitting…' : 'Submit for review'}
          </button>
        </div>
      </form>
        </>
      )}
    </div>
  )
}
