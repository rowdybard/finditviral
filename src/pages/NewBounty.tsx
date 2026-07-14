import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import CatalogSearchSelect, { type CatalogSelection } from '../components/CatalogSearchSelect'
import CatalogSuggestionForm, {
  type ProductSuggestionValues,
  type StoreSuggestionValues,
} from '../components/CatalogSuggestionForm'
import ContributionDraftNotice from '../components/ContributionDraftNotice'
import {
  createBounty,
  discardContributionDraft,
  getMyContributionDrafts,
  saveContributionDraft,
  searchProducts,
  searchRetailers,
  searchStores,
  suggestProductForDraft,
  suggestStoreForDraft,
} from '../lib/launchApi'
import { activeMarket } from '../lib/market'
import { trackEvent } from '../lib/analytics'
import { mapContributionError } from '../lib/errorMap'
import type { ContributionDraft, RetailerSearchResult, StoreSearchResult } from '../types/database'

type BountyPayload = {
  version: 1
  product: CatalogSelection | null
  scope: 'region' | 'retailers' | 'stores'
  store: CatalogSelection | null
  zipCode: string
  radiusMiles: string
  rewardAmount: string
  deadline: string
  requirements: string
  quantityNeeded: string
  variantRequirements: string
  acceptEquivalent: boolean
  selectedRetailers: CatalogSelection[]
  selectedStores: CatalogSelection[]
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

export default function NewBounty() {
  const [product, setProduct] = useState<CatalogSelection | null>(null)
  const [scope, setScope] = useState<'region' | 'retailers' | 'stores'>('region')
  const [store, setStore] = useState<CatalogSelection | null>(null)
  const [selectedRetailers, setSelectedRetailers] = useState<CatalogSelection[]>([])
  const [selectedStores, setSelectedStores] = useState<CatalogSelection[]>([])
  const [retailerQuery, setRetailerQuery] = useState('')
  const [storeQuery, setStoreQuery] = useState('')
  const [retailerResults, setRetailerResults] = useState<RetailerSearchResult[]>([])
  const [storeResults, setStoreResults] = useState<StoreSearchResult[]>([])
  const [zipCode, setZipCode] = useState(activeMarket.defaultZip)
  const [radiusMiles, setRadiusMiles] = useState('50')
  const [rewardAmount, setRewardAmount] = useState('')
  const [deadline, setDeadline] = useState(() => localDateTime(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)))
  const [requirements, setRequirements] = useState('')
  const [quantityNeeded, setQuantityNeeded] = useState('')
  const [variantRequirements, setVariantRequirements] = useState('')
  const [acceptEquivalent, setAcceptEquivalent] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [draft, setDraft] = useState<ContributionDraft | null>(null)
  const [suggestion, setSuggestion] = useState<{ kind: 'product' | 'store'; initialName: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [suggestionError, setSuggestionError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [draftLoading, setDraftLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  function currentPayload(): BountyPayload {
    return { version: 1, product, scope, store, zipCode, radiusMiles, rewardAmount, deadline, requirements, quantityNeeded, variantRequirements, acceptEquivalent, selectedRetailers, selectedStores }
  }

  async function restoreDraft(nextDraft: ContributionDraft) {
    const payload = nextDraft.payload as Partial<BountyPayload>
    setDraft(nextDraft)
    setProduct(isSelection(payload.product) ? payload.product : null)
    setStore(isSelection(payload.store) ? payload.store : null)
    if (payload.scope === 'region' || payload.scope === 'retailers' || payload.scope === 'stores') setScope(payload.scope)
    if (Array.isArray(payload.selectedRetailers)) setSelectedRetailers(payload.selectedRetailers.filter(isSelection))
    if (Array.isArray(payload.selectedStores)) setSelectedStores(payload.selectedStores.filter(isSelection))
    if (typeof payload.zipCode === 'string') setZipCode(payload.zipCode)
    if (typeof payload.radiusMiles === 'string') setRadiusMiles(payload.radiusMiles)
    if (typeof payload.rewardAmount === 'string') setRewardAmount(payload.rewardAmount)
    if (typeof payload.deadline === 'string') setDeadline(payload.deadline)
    if (typeof payload.requirements === 'string') setRequirements(payload.requirements)
    if (typeof payload.quantityNeeded === 'string') setQuantityNeeded(payload.quantityNeeded)
    if (typeof payload.variantRequirements === 'string') setVariantRequirements(payload.variantRequirements)
    if (typeof payload.acceptEquivalent === 'boolean') setAcceptEquivalent(payload.acceptEquivalent)
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
      .filter((candidate) => candidate.draft_type === 'bounty')
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
      type: 'bounty',
      payload: currentPayload(),
      productId: product?.id ?? null,
      storeId: scope === 'stores' ? (store?.id ?? selectedStores[0]?.id ?? null) : null,
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
          type: 'bounty',
          payload: { ...currentPayload(), productSuggestionName: (values as ProductSuggestionValues).name },
          storeId: scope === 'stores' ? (store?.id ?? selectedStores[0]?.id ?? null) : null,
          ...(values as ProductSuggestionValues),
        })
      : await suggestStoreForDraft({
          draftId: draft?.id ?? null,
          type: 'bounty',
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

  async function handleValidate(): Promise<boolean> {
    setError(null)
    if (!product) {
      setError('Choose a verified product or submit it for approval.')
      return false
    }
    if (scope === 'stores' && !store && selectedStores.length === 0) {
      setError('Choose at least one store or submit it for approval.')
      return false
    }
    if (scope === 'retailers' && selectedRetailers.length === 0) {
      setError('Choose at least one retailer.')
      return false
    }
    if (scope === 'region' && !/^[0-9]{5}$/.test(zipCode)) {
      setError('Enter a valid 5-digit ZIP code.')
      return false
    }
    if (draft?.state === 'waiting_for_approval' || draft?.state === 'needs_attention') {
      setError('This draft still needs owner review. Wait for approval or discard it and start again with catalog matches.')
      return false
    }
    if (!/^\d+(?:\.\d{1,2})?$/.test(rewardAmount)) {
      setError('Enter a reward with no more than two decimal places.')
      return false
    }
    const rewardCents = Math.round(Number(rewardAmount) * 100)
    if (!Number.isSafeInteger(rewardCents) || rewardCents < 100 || rewardCents > 1_000_000) {
      setError('Reward must be between $1 and $10,000.')
      return false
    }
    const deadlineDate = new Date(deadline)
    const now = Date.now()
    if (Number.isNaN(deadlineDate.getTime()) || deadlineDate.getTime() < now + 60 * 60 * 1000 || deadlineDate.getTime() > now + 30 * 24 * 60 * 60 * 1000) {
      setError('Deadline must be between 1 hour and 30 days from now.')
      return false
    }
    const parsedQty = quantityNeeded === '' ? null : Number(quantityNeeded)
    if (parsedQty !== null && (!Number.isInteger(parsedQty) || parsedQty < 1 || parsedQty > 999)) {
      setError('Quantity needed must be a whole number from 1 to 999.')
      return false
    }
    return true
  }

  async function handlePreview(event: React.FormEvent) {
    event.preventDefault()
    const ok = await handleValidate()
    if (ok) setShowPreview(true)
  }

  async function handleSubmit() {
    const ok = await handleValidate()
    if (!ok || !product) return
    const rewardCents = Math.round(Number(rewardAmount) * 100)
    const deadlineDate = new Date(deadline)
    const parsedQty = quantityNeeded === '' ? null : Number(quantityNeeded)

    setLoading(true)
    const { error: createError } = await createBounty({
      productId: product.id,
      scopeType: scope,
      storeId: scope === 'stores' ? (store?.id ?? null) : null,
      zipCode: scope === 'region' ? zipCode : null,
      radiusMiles: scope === 'region' ? Number(radiusMiles) : null,
      retailerIds: scope === 'retailers' ? selectedRetailers.map(r => r.id) : null,
      storeIds: scope === 'stores' && !store ? selectedStores.map(s => s.id) : null,
      rewardCents,
      deadline: deadlineDate.toISOString(),
      requirements: requirements.trim() || null,
      quantityNeeded: parsedQty,
      variantRequirements: variantRequirements.trim() || null,
      acceptEquivalent,
      draftId: draft?.id ?? null,
    })
    setLoading(false)
    if (createError) {
      setError(mapContributionError(createError))
      return
    }
    trackEvent('post_bounty', { reward_cents: rewardCents, scope })
    setSubmitted(true)
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <Link to="/bounties" className="text-sm text-gray-500 hover:text-gray-700">← Bounties</Link>
        <h1 className="mt-2 text-2xl font-bold text-gray-900">Post a Bounty</h1>
        <p className="mt-1 text-sm text-gray-500">Ask local shoppers to help find a product. Rewards are promises between members; FindItViral does not process payment or escrow.</p>
      </div>

      {submitted && (
        <div className="card space-y-3 border-2 border-green-500 bg-green-50">
          <h2 className="text-lg font-bold text-green-800">Submitted for review</h2>
          <p className="text-sm text-green-700">Your bounty has been submitted and will be visible once approved by a moderator. You can track its status in your bounties list.</p>
          <div className="flex gap-2">
            <Link to="/bounties" className="btn-secondary">View bounties</Link>
            <button type="button" className="btn-primary" onClick={() => { setSubmitted(false); setProduct(null); setStore(null); setSelectedRetailers([]); setSelectedStores([]); setRewardAmount(''); setRequirements(''); setDraft(null) }}>Post another</button>
          </div>
        </div>
      )}

      {!submitted && (
        <>
      {draft && <ContributionDraftNotice draft={draft} onDiscard={discardDraft} discarding={draftLoading} />}

      <form onSubmit={handlePreview} className="space-y-5">
        <CatalogSearchSelect
          kind="product"
          label="Product"
          value={product}
          onChange={setProduct}
          onSuggest={(initialName) => setSuggestion({ kind: 'product', initialName })}
          required
        />
        {suggestion?.kind === 'product' && (
          <CatalogSuggestionForm kind="product" initialName={suggestion.initialName} loading={draftLoading} error={suggestionError} onCancel={() => setSuggestion(null)} onSubmit={submitSuggestion} />
        )}

        <fieldset>
          <legend className="label">Where should shoppers look? *</legend>
          <div className="grid grid-cols-3 gap-2">
            <label className={`cursor-pointer rounded-lg border-2 px-3 py-3 text-center text-sm font-semibold ${scope === 'region' ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-gray-200 bg-white text-gray-600'}`}>
              <input className="sr-only" type="radio" name="scope" checked={scope === 'region'} onChange={() => setScope('region')} />
              ZIP Radius
            </label>
            <label className={`cursor-pointer rounded-lg border-2 px-3 py-3 text-center text-sm font-semibold ${scope === 'retailers' ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-gray-200 bg-white text-gray-600'}`}>
              <input className="sr-only" type="radio" name="scope" checked={scope === 'retailers'} onChange={() => setScope('retailers')} />
              Retailers
            </label>
            <label className={`cursor-pointer rounded-lg border-2 px-3 py-3 text-center text-sm font-semibold ${scope === 'stores' ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-gray-200 bg-white text-gray-600'}`}>
              <input className="sr-only" type="radio" name="scope" checked={scope === 'stores'} onChange={() => setScope('stores')} />
              Stores
            </label>
          </div>
        </fieldset>

        {scope === 'region' && (
          <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
            <div>
              <label className="label" htmlFor="zip">Origin ZIP *</label>
              <input id="zip" className="input" inputMode="numeric" pattern="[0-9]{5}" maxLength={5} value={zipCode} onChange={(event) => setZipCode(event.target.value.replace(/\D/g, ''))} required />
            </div>
            <div>
              <label className="label" htmlFor="radius">Radius</label>
              <select id="radius" className="input" value={radiusMiles} onChange={(event) => setRadiusMiles(event.target.value)}>
                {[10, 25, 50, 100, 250].map((miles) => <option key={miles} value={miles}>{miles} mi</option>)}
              </select>
            </div>
          </div>
        )}

        {scope === 'retailers' && (
          <div>
            <label className="label" htmlFor="retailer-search">Search retailers *</label>
            <input id="retailer-search" className="input" type="text" value={retailerQuery} onChange={async (event) => { setRetailerQuery(event.target.value); if (event.target.value.trim().length >= 2) { const result = await searchRetailers(event.target.value); setRetailerResults(result.data ?? []) } }} placeholder="Type a retailer name…" />
            {retailerResults.length > 0 && (
              <div className="mt-2 space-y-1">
                {retailerResults.filter(r => !selectedRetailers.some(s => s.id === r.id)).map(r => (
                  <button key={r.id} type="button" className="block w-full rounded-lg border border-gray-200 px-3 py-2 text-left text-sm hover:bg-gray-50" onClick={() => { setSelectedRetailers([...selectedRetailers, { id: r.id, label: r.name, detail: r.website_url ?? '' }]); setRetailerQuery(''); setRetailerResults([]) }}>
                    {r.name}
                  </button>
                ))}
              </div>
            )}
            {selectedRetailers.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {selectedRetailers.map(r => (
                  <span key={r.id} className="inline-flex items-center gap-1 rounded-full bg-brand-100 px-3 py-1 text-sm font-medium text-brand-800">
                    {r.label}
                    <button type="button" className="text-brand-600 hover:text-brand-900" onClick={() => setSelectedRetailers(selectedRetailers.filter(s => s.id !== r.id))}>×</button>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {scope === 'stores' && (
          <>
            <CatalogSearchSelect kind="store" label="Exact store (optional if adding multiple below)" value={store} onChange={setStore} onSuggest={(initialName) => setSuggestion({ kind: 'store', initialName })} />
            {suggestion?.kind === 'store' && (
              <CatalogSuggestionForm kind="store" initialName={suggestion.initialName} loading={draftLoading} error={suggestionError} onCancel={() => setSuggestion(null)} onSubmit={submitSuggestion} />
            )}
            <div>
              <label className="label" htmlFor="store-search">Or add multiple stores</label>
              <input id="store-search" className="input" type="text" value={storeQuery} onChange={async (event) => { setStoreQuery(event.target.value); if (event.target.value.trim().length >= 2) { const result = await searchStores(event.target.value); setStoreResults(result.data ?? []) } }} placeholder="Type a store name…" />
              {storeResults.length > 0 && (
                <div className="mt-2 space-y-1">
                  {storeResults.filter(s => !selectedStores.some(sel => sel.id === s.id)).map(s => (
                    <button key={s.id} type="button" className="block w-full rounded-lg border border-gray-200 px-3 py-2 text-left text-sm hover:bg-gray-50" onClick={() => { setSelectedStores([...selectedStores, { id: s.id, label: s.store_name || s.retailer_name, detail: `${s.address_line1}, ${s.city}, ${s.state} ${s.zip_code}` }]); setStoreQuery(''); setStoreResults([]) }}>
                      {s.store_name || s.retailer_name} — {s.city}, {s.state}
                    </button>
                  ))}
                </div>
              )}
              {selectedStores.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {selectedStores.map(s => (
                    <span key={s.id} className="inline-flex items-center gap-1 rounded-full bg-brand-100 px-3 py-1 text-sm font-medium text-brand-800">
                      {s.label}
                      <button type="button" className="text-brand-600 hover:text-brand-900" onClick={() => setSelectedStores(selectedStores.filter(sel => sel.id !== s.id))}>×</button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        <div>
          <label className="label" htmlFor="reward">Promised reward ($) *</label>
          <input id="reward" className="input" type="number" min="1" max="10000" step="0.01" value={rewardAmount} onChange={(event) => setRewardAmount(event.target.value)} placeholder="20.00" required />
        </div>

        <div>
          <label className="label" htmlFor="deadline">Deadline *</label>
          <input id="deadline" className="input" type="datetime-local" min={localDateTime(new Date(Date.now() + 60 * 60 * 1000))} max={localDateTime(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000))} value={deadline} onChange={(event) => setDeadline(event.target.value)} required />
        </div>

        <div>
          <label className="label" htmlFor="requirements">Requirements (optional)</label>
          <textarea id="requirements" className="input min-h-24" value={requirements} onChange={(event) => setRequirements(event.target.value)} maxLength={2000} placeholder="Color, size, condition, quantity…" />
          <p className="mt-1 text-right text-xs text-gray-400">{requirements.length}/2000</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="quantity-needed">Quantity needed (optional)</label>
            <input id="quantity-needed" className="input" type="number" min="1" max="999" step="1" value={quantityNeeded} onChange={(event) => setQuantityNeeded(event.target.value)} placeholder="1" />
          </div>
          <div className="flex items-end pb-2">
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
              <input type="checkbox" checked={acceptEquivalent} onChange={(event) => setAcceptEquivalent(event.target.checked)} className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500" />
              Accept equivalent variants
            </label>
          </div>
        </div>

        <div>
          <label className="label" htmlFor="variant-requirements">Variant requirements (optional)</label>
          <textarea id="variant-requirements" className="input min-h-20" value={variantRequirements} onChange={(event) => setVariantRequirements(event.target.value)} maxLength={1000} placeholder="Specify acceptable variants, colors, sizes, editions…" />
          <p className="mt-1 text-right text-xs text-gray-400">{variantRequirements.length}/1000</p>
        </div>

        {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <button type="button" className="btn-secondary sm:flex-1" onClick={saveDraft} disabled={loading || draftLoading}>
            {draftLoading ? 'Saving…' : 'Save private draft'}
          </button>
          <button type="submit" className="btn-primary sm:flex-[2]" disabled={loading || draftLoading}>
            Review & Submit
          </button>
        </div>
      </form>

      {showPreview && (
        <div className="card space-y-4 border-2 border-brand-300">
          <h2 className="text-lg font-bold text-gray-900">Preview your bounty</h2>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-4"><dt className="font-bold text-gray-600">Product</dt><dd className="text-right text-gray-900">{product?.label}</dd></div>
            <div className="flex justify-between gap-4"><dt className="font-bold text-gray-600">Scope</dt><dd className="text-right text-gray-900">{scope === 'region' ? `ZIP ${zipCode} · ${radiusMiles} mi` : scope === 'retailers' ? selectedRetailers.map(r => r.label).join(', ') : (store?.label ?? selectedStores.map(s => s.label).join(', '))}</dd></div>
            <div className="flex justify-between gap-4"><dt className="font-bold text-gray-600">Reward</dt><dd className="text-right text-gray-900">${rewardAmount}</dd></div>
            <div className="flex justify-between gap-4"><dt className="font-bold text-gray-600">Deadline</dt><dd className="text-right text-gray-900">{new Date(deadline).toLocaleString()}</dd></div>
            {quantityNeeded && <div className="flex justify-between gap-4"><dt className="font-bold text-gray-600">Quantity needed</dt><dd className="text-right text-gray-900">{quantityNeeded}</dd></div>}
            {variantRequirements.trim() && <div className="flex justify-between gap-4"><dt className="font-bold text-gray-600">Variant requirements</dt><dd className="text-right text-gray-900">{variantRequirements.trim()}</dd></div>}
            <div className="flex justify-between gap-4"><dt className="font-bold text-gray-600">Accept equivalents</dt><dd className="text-right text-gray-900">{acceptEquivalent ? 'Yes' : 'No'}</dd></div>
            {requirements.trim() && <div className="flex justify-between gap-4"><dt className="font-bold text-gray-600">Requirements</dt><dd className="text-right text-gray-900">{requirements.trim()}</dd></div>}
          </dl>
          <p className="text-xs text-gray-500">This bounty will be submitted for moderator review before becoming visible.</p>
          {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
          <div className="flex gap-2">
            <button type="button" className="btn-secondary" onClick={() => setShowPreview(false)} disabled={loading}>Back to edit</button>
            <button type="button" className="btn-primary" onClick={() => void handleSubmit()} disabled={loading}>{loading ? 'Submitting…' : 'Submit for review'}</button>
          </div>
        </div>
      )}
        </>
      )}
    </div>
  )
}
