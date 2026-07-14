import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
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
  searchStores,
  suggestProductForDraft,
  suggestStoreForDraft,
} from '../lib/launchApi'
import { activeMarket } from '../lib/market'
import { trackEvent } from '../lib/analytics'
import type { ContributionDraft } from '../types/database'

type BountyPayload = {
  version: 1
  product: CatalogSelection | null
  scope: 'area' | 'store'
  store: CatalogSelection | null
  zipCode: string
  radiusMiles: string
  rewardAmount: string
  deadline: string
  requirements: string
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
  const navigate = useNavigate()
  const [product, setProduct] = useState<CatalogSelection | null>(null)
  const [scope, setScope] = useState<'area' | 'store'>('area')
  const [store, setStore] = useState<CatalogSelection | null>(null)
  const [zipCode, setZipCode] = useState(activeMarket.defaultZip)
  const [radiusMiles, setRadiusMiles] = useState('50')
  const [rewardAmount, setRewardAmount] = useState('')
  const [deadline, setDeadline] = useState(() => localDateTime(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)))
  const [requirements, setRequirements] = useState('')
  const [draft, setDraft] = useState<ContributionDraft | null>(null)
  const [suggestion, setSuggestion] = useState<{ kind: 'product' | 'store'; initialName: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [suggestionError, setSuggestionError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [draftLoading, setDraftLoading] = useState(false)

  function currentPayload(): BountyPayload {
    return { version: 1, product, scope, store, zipCode, radiusMiles, rewardAmount, deadline, requirements }
  }

  async function restoreDraft(nextDraft: ContributionDraft) {
    const payload = nextDraft.payload as Partial<BountyPayload>
    setDraft(nextDraft)
    setProduct(isSelection(payload.product) ? payload.product : null)
    setStore(isSelection(payload.store) ? payload.store : null)
    if (payload.scope === 'area' || payload.scope === 'store') setScope(payload.scope)
    if (typeof payload.zipCode === 'string') setZipCode(payload.zipCode)
    if (typeof payload.radiusMiles === 'string') setRadiusMiles(payload.radiusMiles)
    if (typeof payload.rewardAmount === 'string') setRewardAmount(payload.rewardAmount)
    if (typeof payload.deadline === 'string') setDeadline(payload.deadline)
    if (typeof payload.requirements === 'string') setRequirements(payload.requirements)
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
      storeId: scope === 'store' ? store?.id ?? null : null,
    })
    setDraftLoading(false)
    if (saveError) {
      setError(saveError.message)
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
      setError(discardError.message)
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
          storeId: scope === 'store' ? store?.id ?? null : null,
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

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    if (!product) {
      setError('Choose a verified product or submit it for approval.')
      return
    }
    if (scope === 'store' && !store) {
      setError('Choose the exact store or submit it for approval.')
      return
    }
    if (scope === 'area' && !/^[0-9]{5}$/.test(zipCode)) {
      setError('Enter a valid 5-digit ZIP code.')
      return
    }
    if (draft?.state === 'waiting_for_approval' || draft?.state === 'needs_attention') {
      setError('This draft still needs owner review. Wait for approval or discard it and start again with catalog matches.')
      return
    }
    if (!/^\d+(?:\.\d{1,2})?$/.test(rewardAmount)) {
      setError('Enter a reward with no more than two decimal places.')
      return
    }
    const rewardCents = Math.round(Number(rewardAmount) * 100)
    if (!Number.isSafeInteger(rewardCents) || rewardCents < 100 || rewardCents > 1_000_000) {
      setError('Reward must be between $1 and $10,000.')
      return
    }
    const deadlineDate = new Date(deadline)
    const now = Date.now()
    if (Number.isNaN(deadlineDate.getTime()) || deadlineDate.getTime() < now + 60 * 60 * 1000 || deadlineDate.getTime() > now + 90 * 24 * 60 * 60 * 1000) {
      setError('Deadline must be between 1 hour and 90 days from now.')
      return
    }

    setLoading(true)
    const { data, error: createError } = await createBounty({
      productId: product.id,
      storeId: scope === 'store' ? store?.id ?? null : null,
      zipCode: scope === 'area' ? zipCode : null,
      radiusMiles: scope === 'area' ? Number(radiusMiles) : null,
      rewardCents,
      deadline: deadlineDate.toISOString(),
      requirements: requirements.trim() || null,
      draftId: draft?.id ?? null,
    })
    setLoading(false)
    if (createError) {
      setError(createError.message)
      return
    }
    trackEvent('post_bounty', { reward_cents: rewardCents, scope })
    navigate(data ? `/bounties/${data}` : '/bounties')
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <Link to="/bounties" className="text-sm text-gray-500 hover:text-gray-700">← Bounties</Link>
        <h1 className="mt-2 text-2xl font-bold text-gray-900">Post a Bounty</h1>
        <p className="mt-1 text-sm text-gray-500">Ask local shoppers to help find a product. Rewards are promises between members; FindItViral does not process payment or escrow.</p>
      </div>

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
          <CatalogSuggestionForm kind="product" initialName={suggestion.initialName} loading={draftLoading} error={suggestionError} onCancel={() => setSuggestion(null)} onSubmit={submitSuggestion} />
        )}

        <fieldset>
          <legend className="label">Where should shoppers look? *</legend>
          <div className="grid grid-cols-2 gap-2">
            <label className={`cursor-pointer rounded-lg border-2 px-3 py-3 text-center text-sm font-semibold ${scope === 'area' ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-gray-200 bg-white text-gray-600'}`}>
              <input className="sr-only" type="radio" name="scope" checked={scope === 'area'} onChange={() => setScope('area')} />
              Around a ZIP
            </label>
            <label className={`cursor-pointer rounded-lg border-2 px-3 py-3 text-center text-sm font-semibold ${scope === 'store' ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-gray-200 bg-white text-gray-600'}`}>
              <input className="sr-only" type="radio" name="scope" checked={scope === 'store'} onChange={() => setScope('store')} />
              Exact store
            </label>
          </div>
        </fieldset>

        {scope === 'store' ? (
          <>
            <CatalogSearchSelect kind="store" label="Exact store" value={store} onChange={setStore} onSuggest={(initialName) => setSuggestion({ kind: 'store', initialName })} required />
            {suggestion?.kind === 'store' && (
              <CatalogSuggestionForm kind="store" initialName={suggestion.initialName} loading={draftLoading} error={suggestionError} onCancel={() => setSuggestion(null)} onSubmit={submitSuggestion} />
            )}
          </>
        ) : (
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

        <div>
          <label className="label" htmlFor="reward">Promised reward ($) *</label>
          <input id="reward" className="input" type="number" min="1" max="10000" step="0.01" value={rewardAmount} onChange={(event) => setRewardAmount(event.target.value)} placeholder="20.00" required />
        </div>

        <div>
          <label className="label" htmlFor="deadline">Deadline *</label>
          <input id="deadline" className="input" type="datetime-local" min={localDateTime(new Date(Date.now() + 60 * 60 * 1000))} max={localDateTime(new Date(Date.now() + 90 * 24 * 60 * 60 * 1000))} value={deadline} onChange={(event) => setDeadline(event.target.value)} required />
        </div>

        <div>
          <label className="label" htmlFor="requirements">Requirements (optional)</label>
          <textarea id="requirements" className="input min-h-24" value={requirements} onChange={(event) => setRequirements(event.target.value)} maxLength={2000} placeholder="Color, size, condition, quantity…" />
          <p className="mt-1 text-right text-xs text-gray-400">{requirements.length}/2000</p>
        </div>

        {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <button type="button" className="btn-secondary sm:flex-1" onClick={saveDraft} disabled={loading || draftLoading}>
            {draftLoading ? 'Saving…' : 'Save private draft'}
          </button>
          <button type="submit" className="btn-primary sm:flex-[2]" disabled={loading || draftLoading}>
            {loading ? 'Publishing…' : 'Publish Bounty'}
          </button>
        </div>
      </form>
    </div>
  )
}
