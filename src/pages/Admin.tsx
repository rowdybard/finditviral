import { ArrowsCounterClockwise, Check, ClockCounterClockwise, EyeSlash, LinkSimple, PencilSimple, ShieldCheck, X } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import CatalogSearchSelect, { type CatalogSelection } from '../components/CatalogSearchSelect'
import { mapContributionError } from '../lib/errorMap'
import {
  adminCreateProduct,
  adminCreateStore,
  adminDisableProduct,
  adminDisableStore,
  adminListInterestEvents,
  adminListMemberRestrictions,
  adminListModerationHistory,
  adminListProducts,
  adminListProductSuggestions,
  adminListRecentContributions,
  adminListStores,
  adminListStoreSuggestions,
  adminResolveProductSuggestion,
  adminResolveStoreSuggestion,
  adminSearchMembers,
  adminSetContributionModeration,
  adminSetLeadModeration,
  adminSetMemberRestriction,
  adminUpdateProduct,
  adminUpdateStore,
} from '../lib/launchApi'
import { trackEvent } from '../lib/analytics'
import TrendEnginePanel from './admin/TrendEnginePanel'
import { useAdminReview } from '../contexts/AdminReviewContext'
import type {
  AdminContribution,
  AdminMemberSearchResult,
  AdminProduct,
  AdminStore,
  CatalogSuggestion,
  InterestEvent,
  MemberRestriction,
  ModerationEvent,
} from '../types/database'

type Tab = 'review' | 'suggestions' | 'contributions' | 'interests' | 'members' | 'history' | 'stores' | 'products' | 'trend-engine'
type NewProductAvailability = 'available' | 'backorder' | 'preorder' | 'announced' | 'limited'

const ADMIN_TABS = new Set<Tab>(['review', 'suggestions', 'contributions', 'interests', 'members', 'history', 'stores', 'products', 'trend-engine'])

function suggestionTitle(suggestion: CatalogSuggestion): string {
  return suggestion.product_name
    ?? suggestion.store_name
    ?? suggestion.name
    ?? suggestion.retailer_name
    ?? 'Untitled suggestion'
}

function SuggestionReviewCard({
  kind,
  suggestion,
  onResolved,
}: {
  kind: 'product' | 'store'
  suggestion: CatalogSuggestion
  onResolved: () => Promise<void>
}) {
  const [mode, setMode] = useState<'idle' | 'reject' | 'duplicate'>('idle')
  const [canonical, setCanonical] = useState<CatalogSelection | null>(null)
  const [reason, setReason] = useState('')
  const [availabilityStatus, setAvailabilityStatus] = useState<NewProductAvailability>('available')
  const [releaseDate, setReleaseDate] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function resolve(decision: 'approved' | 'rejected' | 'duplicate') {
    if (decision === 'duplicate' && !canonical) {
      setError('Choose the existing catalog record first.')
      return
    }
    setLoading(true)
    setError(null)
    const baseInput = {
      id: suggestion.id,
      decision,
      canonicalId: decision === 'duplicate' ? canonical?.id ?? null : null,
      reason: reason.trim() || null,
    }
    const result = kind === 'product'
      ? await adminResolveProductSuggestion({
          ...baseInput,
          availabilityStatus: decision === 'approved' ? availabilityStatus : null,
          releaseDate: decision === 'approved' && releaseDate ? releaseDate : null,
        })
      : await adminResolveStoreSuggestion(baseInput)
    setLoading(false)
    if (result.error) {
      setError(mapContributionError(result.error))
      return
    }
    await onResolved()
  }

  return (
    <article className="card border-2 border-stone-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-brand-700">{kind}</p>
          <h3 className="text-lg font-black text-stone-950">{suggestionTitle(suggestion)}</h3>
          {kind === 'product' && suggestion.brand && <p className="mt-1 text-sm text-stone-600">Brand: {suggestion.brand}</p>}
          {kind === 'store' && (
            <>
              <p className="mt-1 text-sm text-stone-600">
                {[suggestion.address_line1, suggestion.city, suggestion.state, suggestion.zip_code].filter(Boolean).join(', ')}
              </p>
              {suggestion.phone && <p className="text-sm text-stone-600">{suggestion.phone}</p>}
            </>
          )}
          {suggestion.source_url && <a className="mt-1 block text-sm font-semibold text-brand-700" href={suggestion.source_url} target="_blank" rel="noreferrer">Review source ↗</a>}
          <p className="mt-2 text-xs text-stone-500">Submitted {new Date(suggestion.created_at).toLocaleString()}</p>
        </div>
        <span className="badge bg-amber-100 text-amber-800">{suggestion.status}</span>
      </div>

      {mode === 'duplicate' && (
        <div className="mt-4 space-y-3 rounded-lg border border-stone-200 bg-stone-50 p-3">
          <CatalogSearchSelect kind={kind} label={`Link existing ${kind}`} value={canonical} onChange={setCanonical} required />
          <input className="input" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Resolution note (optional)" maxLength={500} />
          <div className="flex gap-2">
            <button type="button" className="btn-primary" onClick={() => void resolve('duplicate')} disabled={loading}>Link duplicate</button>
            <button type="button" className="btn-ghost" onClick={() => setMode('idle')}>Cancel</button>
          </div>
        </div>
      )}

      {mode === 'reject' && (
        <div className="mt-4 space-y-3 rounded-lg border border-red-200 bg-red-50 p-3">
          <label className="label" htmlFor={`reject-${suggestion.id}`}>Reason for rejection *</label>
          <textarea id={`reject-${suggestion.id}`} className="input min-h-20" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} required />
          <div className="flex gap-2">
            <button type="button" className="btn bg-red-600 text-white hover:bg-red-700" onClick={() => void resolve('rejected')} disabled={loading || !reason.trim()}>Reject suggestion</button>
            <button type="button" className="btn-ghost" onClick={() => setMode('idle')}>Cancel</button>
          </div>
        </div>
      )}

      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {mode === 'idle' && suggestion.status === 'pending' && (
        <div className="mt-4 space-y-3 border-t border-stone-200 pt-4">
          {kind === 'product' && (
            <div className="grid gap-3 rounded-lg border border-stone-200 bg-stone-50 p-3 sm:grid-cols-2">
              <label className="text-sm font-semibold text-stone-800">
                Availability
                <select className="input mt-1" value={availabilityStatus} onChange={(event) => setAvailabilityStatus(event.target.value as NewProductAvailability)}>
                  <option value="available">Available now</option>
                  <option value="backorder">Backorder</option>
                  <option value="preorder">Preorder</option>
                  <option value="announced">Announced</option>
                  <option value="limited">Limited release</option>
                </select>
              </label>
              <label className="text-sm font-semibold text-stone-800">
                Release date
                <input className="input mt-1" type="date" value={releaseDate} onChange={(event) => setReleaseDate(event.target.value)} />
                <span className="mt-1 block text-xs font-normal text-stone-500">Leave blank only when the official date is unknown.</span>
              </label>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary" onClick={() => void resolve('approved')} disabled={loading} title="Create a verified canonical record from this suggestion">
              <Check size={17} weight="bold" aria-hidden="true" /> Approve & create
            </button>
            <button type="button" className="btn-secondary" onClick={() => setMode('duplicate')} disabled={loading}><LinkSimple size={17} weight="bold" aria-hidden="true" /> Link duplicate</button>
            <button type="button" className="btn-ghost text-red-700" onClick={() => setMode('reject')} disabled={loading}><X size={17} weight="bold" aria-hidden="true" /> Reject</button>
          </div>
        </div>
      )}
    </article>
  )
}

function ProductCatalogRow({
  product,
  editing,
  actionLoading,
  onEdit,
  onSave,
  onDisable,
  onRestore,
}: {
  product: AdminProduct
  editing: boolean
  actionLoading: boolean
  onEdit: () => void
  onSave: (updates: { name: string; availabilityStatus: string; category: string; searchTerms: string }) => void
  onDisable: () => void
  onRestore: () => void
}) {
  const [name, setName] = useState(product.name)
  const [availabilityStatus, setAvailabilityStatus] = useState(product.availability_status)
  const [category, setCategory] = useState(product.category ?? '')
  const [searchTerms, setSearchTerms] = useState(product.search_terms ?? '')

  return (
    <article className="card border border-stone-200">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-bold text-stone-900">{product.name}</h3>
            {!product.is_active && <span className="badge bg-red-100 text-red-800">disabled</span>}
          </div>
          <p className="mt-0.5 text-sm text-stone-600">
            {product.trend_name}{product.brand ? ` · ${product.brand}` : ''} · {product.availability_status}
            {product.category ? ` · ${product.category}` : ''}
          </p>
        </div>
        {!editing && (
          <div className="flex shrink-0 gap-2">
            <button type="button" className="btn-ghost" onClick={onEdit} disabled={actionLoading} title="Edit"><PencilSimple size={17} aria-hidden="true" /></button>
            {product.is_active
              ? <button type="button" className="btn-ghost text-red-700" onClick={onDisable} disabled={actionLoading} title="Disable"><EyeSlash size={17} aria-hidden="true" /></button>
              : <button type="button" className="btn-ghost text-brand-700" onClick={onRestore} disabled={actionLoading} title="Restore"><ArrowsCounterClockwise size={17} aria-hidden="true" /></button>}
          </div>
        )}
      </div>

      {editing && (
        <div className="mt-4 space-y-3 rounded-lg border border-stone-200 bg-stone-50 p-3">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Product name" maxLength={160} />
          <div className="grid gap-3 sm:grid-cols-2">
            <select className="input" value={availabilityStatus} onChange={(e) => setAvailabilityStatus(e.target.value)}>
              <option value="available">Available now</option>
              <option value="backorder">Backorder</option>
              <option value="preorder">Preorder</option>
              <option value="announced">Announced</option>
              <option value="limited">Limited release</option>
              <option value="retired">Retired</option>
            </select>
            <input className="input" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Category" maxLength={120} />
          </div>
          <input className="input" value={searchTerms} onChange={(e) => setSearchTerms(e.target.value)} placeholder="Search keywords (space-separated)" maxLength={500} />
          <div className="flex gap-2">
            <button type="button" className="btn-primary" onClick={() => onSave({ name, availabilityStatus, category, searchTerms })} disabled={actionLoading}><Check size={17} aria-hidden="true" /> Save</button>
            <button type="button" className="btn-ghost" onClick={onEdit} disabled={actionLoading}>Cancel</button>
          </div>
        </div>
      )}
    </article>
  )
}

function StoreCatalogRow({
  store,
  editing,
  actionLoading,
  onEdit,
  onSave,
  onDisable,
  onRestore,
}: {
  store: AdminStore
  editing: boolean
  actionLoading: boolean
  onEdit: () => void
  onSave: (updates: { name: string; addressLine1: string }) => void
  onDisable: () => void
  onRestore: () => void
}) {
  const [name, setName] = useState(store.name)
  const [addressLine1, setAddressLine1] = useState(store.address_line1 ?? '')

  return (
    <article className="card border border-stone-200">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-bold text-stone-900">{store.name}</h3>
            {!store.is_active && <span className="badge bg-red-100 text-red-800">disabled</span>}
          </div>
          <p className="mt-0.5 text-sm text-stone-600">
            {store.retailer_name}{store.city ? ` · ${store.city}, ${store.state ?? ''}` : ''}{store.zip_code ? ` ${store.zip_code}` : ''}
          </p>
        </div>
        {!editing && (
          <div className="flex shrink-0 gap-2">
            <button type="button" className="btn-ghost" onClick={onEdit} disabled={actionLoading} title="Edit"><PencilSimple size={17} aria-hidden="true" /></button>
            {store.is_active
              ? <button type="button" className="btn-ghost text-red-700" onClick={onDisable} disabled={actionLoading} title="Disable"><EyeSlash size={17} aria-hidden="true" /></button>
              : <button type="button" className="btn-ghost text-brand-700" onClick={onRestore} disabled={actionLoading} title="Restore"><ArrowsCounterClockwise size={17} aria-hidden="true" /></button>}
          </div>
        )}
      </div>

      {editing && (
        <div className="mt-4 space-y-3 rounded-lg border border-stone-200 bg-stone-50 p-3">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Store name" maxLength={160} />
          <input className="input" value={addressLine1} onChange={(e) => setAddressLine1(e.target.value)} placeholder="Street address" maxLength={200} />
          <div className="flex gap-2">
            <button type="button" className="btn-primary" onClick={() => onSave({ name, addressLine1 })} disabled={actionLoading}><Check size={17} aria-hidden="true" /> Save</button>
            <button type="button" className="btn-ghost" onClick={onEdit} disabled={actionLoading}>Cancel</button>
          </div>
        </div>
      )}
    </article>
  )
}

export default function Admin() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { owner, counts: reviewCounts, refresh: refreshReviewCounts } = useAdminReview()
  const requestedTab = searchParams.get('tab') as Tab | null
  const tab = requestedTab && ADMIN_TABS.has(requestedTab) ? requestedTab : 'review'
  const queue = searchParams.get('queue')
  const [products, setProducts] = useState<CatalogSuggestion[]>([])
  const [stores, setStores] = useState<CatalogSuggestion[]>([])
  const [contributions, setContributions] = useState<AdminContribution[]>([])
  const [interests, setInterests] = useState<InterestEvent[]>([])
  const [restrictions, setRestrictions] = useState<MemberRestriction[]>([])
  const [history, setHistory] = useState<ModerationEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionId, setActionId] = useState<string | null>(null)
  const [memberId, setMemberId] = useState('')
  const [memberStatus, setMemberStatus] = useState<'suspended' | 'disabled'>('suspended')
  const [memberReason, setMemberReason] = useState('')
  const [memberExpiry, setMemberExpiry] = useState('')
  const [memberSearchQuery, setMemberSearchQuery] = useState('')
  const [memberSearchResults, setMemberSearchResults] = useState<AdminMemberSearchResult[]>([])
  const [newStoreRetailer, setNewStoreRetailer] = useState('')
  const [newStoreName, setNewStoreName] = useState('')
  const [newStoreAddress, setNewStoreAddress] = useState('')
  const [newStoreCity, setNewStoreCity] = useState('')
  const [newStoreState, setNewStoreState] = useState('')
  const [newStoreZip, setNewStoreZip] = useState('')
  const [newProductName, setNewProductName] = useState('')
  const [newProductTrend, setNewProductTrend] = useState('')
  const [newProductAvailability, setNewProductAvailability] = useState('available')
  const [newProductBrand, setNewProductBrand] = useState('')
  const [newProductCategory, setNewProductCategory] = useState('')
  const [newProductSearchTerms, setNewProductSearchTerms] = useState('')
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [catalogProducts, setCatalogProducts] = useState<AdminProduct[]>([])
  const [catalogStores, setCatalogStores] = useState<AdminStore[]>([])
  const [editingProductId, setEditingProductId] = useState<string | null>(null)
  const [editingStoreId, setEditingStoreId] = useState<string | null>(null)
  const [catalogActionId, setCatalogActionId] = useState<string | null>(null)

  function selectTab(nextTab: Tab, nextQueue?: string) {
    const params = new URLSearchParams(searchParams)
    params.set('tab', nextTab)
    if (nextQueue) params.set('queue', nextQueue)
    else params.delete('queue')
    setSearchParams(params)
  }

  async function loadAdminData() {
    setLoading(true)
    const results = await Promise.all([
      adminListProductSuggestions(),
      adminListStoreSuggestions(),
      adminListRecentContributions(),
      adminListInterestEvents(),
      adminListMemberRestrictions(),
      adminListModerationHistory(),
      adminListProducts(true),
      adminListStores(true),
    ])
    setProducts(results[0].data ?? [])
    setStores(results[1].data ?? [])
    setContributions(results[2].data ?? [])
    setInterests(results[3].data ?? [])
    setRestrictions(results[4].data ?? [])
    setHistory(results[5].data ?? [])
    setCatalogProducts(results[6].data ?? [])
    setCatalogStores(results[7].data ?? [])
    setError(results.some((result) => result.error) ? 'Some owner data could not be loaded.' : null)
    setLoading(false)
    await refreshReviewCounts()
  }

  useEffect(() => {
    if (owner === true) void loadAdminData()
    else if (owner === false) setLoading(false)
  }, [owner])

  useEffect(() => {
    if (owner && tab === 'review') trackEvent('open_admin_review_queue', { queue: queue ?? 'all' })
  }, [owner, queue, tab])

  async function moderate(contribution: AdminContribution, action: 'approve' | 'hide' | 'restore' | 'reject') {
    if ((action === 'hide' || action === 'reject') && !window.confirm(`Are you sure you want to ${action} this ${contribution.contribution_type}?`)) return
    setActionId(contribution.contribution_id)
    if (contribution.contribution_type === 'lead') {
      if (action === 'reject') {
        setActionId(null)
        setError('Leads cannot be rejected.')
        return
      }
      const result = await adminSetLeadModeration({ leadId: contribution.contribution_id, action, reason: null })
      setActionId(null)
      if (result.error) setError(mapContributionError(result.error))
      else await loadAdminData()
      return
    }

    const result = await adminSetContributionModeration({ kind: contribution.contribution_type, id: contribution.contribution_id, action, reason: null })
    setActionId(null)
    if (result.error) setError(mapContributionError(result.error))
    else await loadAdminData()
  }

  async function restrictMember(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    const result = await adminSetMemberRestriction({
      userId: memberId.trim(),
      status: memberStatus,
      reason: memberReason.trim() || null,
      expiresAt: memberStatus === 'suspended' && memberExpiry ? new Date(memberExpiry).toISOString() : null,
    })
    if (result.error) setError(mapContributionError(result.error))
    else {
      setMemberId('')
      setMemberReason('')
      setMemberExpiry('')
      await loadAdminData()
    }
  }

  async function clearRestriction(userId: string) {
    const result = await adminSetMemberRestriction({ userId, status: null, reason: null, expiresAt: null })
    if (result.error) setError(mapContributionError(result.error))
    else await loadAdminData()
  }

  async function searchMembers(query: string) {
    setMemberSearchQuery(query)
    if (query.trim().length < 2) { setMemberSearchResults([]); return }
    const result = await adminSearchMembers(query)
    setMemberSearchResults(result.data ?? [])
  }

  async function handleCreateStore(event: React.FormEvent) {
    event.preventDefault()
    setCatalogError(null)
    if (!newStoreName.trim() || !newStoreRetailer.trim() || !newStoreAddress.trim() || !newStoreCity.trim() || !newStoreState.trim() || !newStoreZip.trim()) {
      setCatalogError('All fields are required.')
      return
    }
    setCatalogLoading(true)
    const result = await adminCreateStore({
      retailerName: newStoreRetailer.trim(),
      storeName: newStoreName.trim(),
      addressLine1: newStoreAddress.trim(),
      city: newStoreCity.trim(),
      state: newStoreState.trim(),
      zipCode: newStoreZip.trim(),
      sourceUrl: null,
      latitude: null,
      longitude: null,
    })
    setCatalogLoading(false)
    if (result.error) { setCatalogError(mapContributionError(result.error)); return }
    setNewStoreRetailer(''); setNewStoreName(''); setNewStoreAddress(''); setNewStoreCity(''); setNewStoreState(''); setNewStoreZip('')
    await loadAdminData()
  }

  async function handleCreateProduct(event: React.FormEvent) {
    event.preventDefault()
    setCatalogError(null)
    if (!newProductName.trim() || !newProductTrend.trim()) {
      setCatalogError('Product name and trend ID are required.')
      return
    }
    setCatalogLoading(true)
    const result = await adminCreateProduct({
      trendId: newProductTrend.trim(),
      name: newProductName.trim(),
      availabilityStatus: newProductAvailability,
      releaseDate: null,
      sourceUrl: null,
      brand: newProductBrand.trim() || null,
      category: newProductCategory.trim() || null,
      searchTerms: newProductSearchTerms.trim() || null,
    })
    setCatalogLoading(false)
    if (result.error) { setCatalogError(mapContributionError(result.error)); return }
    setNewProductName(''); setNewProductTrend(''); setNewProductBrand(''); setNewProductCategory(''); setNewProductSearchTerms('')
    await loadAdminData()
  }

  async function handleUpdateProduct(product: AdminProduct, updates: {
    name: string
    availabilityStatus: string
    category: string
    searchTerms: string
  }) {
    setCatalogActionId(product.id)
    setCatalogError(null)
    const result = await adminUpdateProduct({
      productId: product.id,
      name: updates.name.trim() || null,
      availabilityStatus: updates.availabilityStatus || null,
      releaseDate: null,
      isActive: null,
      category: updates.category !== product.category ? updates.category : null,
      searchTerms: updates.searchTerms !== product.search_terms ? updates.searchTerms : null,
    })
    setCatalogActionId(null)
    if (result.error) { setCatalogError(mapContributionError(result.error)); return }
    setEditingProductId(null)
    await loadAdminData()
  }

  async function handleDisableProduct(productId: string) {
    if (!window.confirm('Disable this product? It will no longer appear in the public catalog.')) return
    setCatalogActionId(productId)
    setCatalogError(null)
    const result = await adminDisableProduct(productId)
    setCatalogActionId(null)
    if (result.error) { setCatalogError(mapContributionError(result.error)); return }
    await loadAdminData()
  }

  async function handleRestoreProduct(productId: string) {
    setCatalogActionId(productId)
    setCatalogError(null)
    const result = await adminUpdateProduct({
      productId,
      name: null,
      availabilityStatus: null,
      releaseDate: null,
      isActive: true,
      category: null,
      searchTerms: null,
    })
    setCatalogActionId(null)
    if (result.error) { setCatalogError(mapContributionError(result.error)); return }
    await loadAdminData()
  }

  async function handleUpdateStore(store: AdminStore, updates: {
    name: string
    addressLine1: string
  }) {
    setCatalogActionId(store.id)
    setCatalogError(null)
    const result = await adminUpdateStore({
      storeId: store.id,
      storeName: updates.name.trim() || null,
      addressLine1: updates.addressLine1.trim() || null,
      sourceUrl: null,
      isActive: null,
    })
    setCatalogActionId(null)
    if (result.error) { setCatalogError(mapContributionError(result.error)); return }
    setEditingStoreId(null)
    await loadAdminData()
  }

  async function handleDisableStore(storeId: string) {
    if (!window.confirm('Disable this store? It will no longer appear in public search.')) return
    setCatalogActionId(storeId)
    setCatalogError(null)
    const result = await adminDisableStore(storeId)
    setCatalogActionId(null)
    if (result.error) { setCatalogError(mapContributionError(result.error)); return }
    await loadAdminData()
  }

  async function handleRestoreStore(storeId: string) {
    setCatalogActionId(storeId)
    setCatalogError(null)
    const result = await adminUpdateStore({
      storeId,
      storeName: null,
      addressLine1: null,
      sourceUrl: null,
      isActive: true,
    })
    setCatalogActionId(null)
    if (result.error) { setCatalogError(mapContributionError(result.error)); return }
    await loadAdminData()
  }

  if (owner === false) return <Navigate to="/home" replace />
  if (owner === null || loading) return <div className="flex items-center justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-200 border-t-brand-500" /></div>

  const tabs: { id: Tab; label: string }[] = [
    { id: 'review', label: `Review (${reviewCounts.total})` },
    { id: 'suggestions', label: `Suggestions (${reviewCounts.pending_product_suggestions + reviewCounts.pending_store_suggestions})` },
    { id: 'contributions', label: `Contributions (${reviewCounts.pending_sightings + reviewCounts.pending_bounties + reviewCounts.pending_leads})` },
    { id: 'interests', label: 'Interest inbox' },
    { id: 'members', label: 'Members' },
    { id: 'stores', label: 'Stores' },
    { id: 'products', label: 'Products' },
    { id: 'history', label: 'History' },
    { id: 'trend-engine', label: 'Trend Engine' },
  ]

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-1.5 text-xs font-black uppercase tracking-[0.14em] text-brand-700"><ShieldCheck size={17} weight="fill" aria-hidden="true" /> Owner only</p>
          <h1 className="mt-1 text-3xl font-black text-stone-950">Launch Operations</h1>
        </div>
        <Link to="/drafts" className="btn-secondary">My drafts</Link>
      </header>

      {error && <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{error}</div>}

      <div className="flex gap-1 overflow-x-auto border-b border-stone-200 pb-2" role="tablist">
        {tabs.map((item) => <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} className={`min-h-11 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 ${tab === item.id ? 'bg-brand-100 text-brand-800' : 'text-stone-600 hover:bg-stone-100'}`} onClick={() => selectTab(item.id)}>{item.label}</button>)}
      </div>

      {tab === 'review' && (
        <section className="space-y-4" aria-labelledby="review-heading">
          <div>
            <h2 id="review-heading" className="text-xl font-black text-stone-950">Review queues</h2>
            <p className="mt-1 text-sm text-stone-600">Only unresolved work requiring an owner decision is counted.</p>
          </div>
          {reviewCounts.total === 0 ? (
            <p className="card text-sm font-semibold text-stone-600">Nothing needs review right now.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                ['product_suggestions', 'Product suggestions', reviewCounts.pending_product_suggestions, 'suggestions'],
                ['store_suggestions', 'Store suggestions', reviewCounts.pending_store_suggestions, 'suggestions'],
                ['sightings', 'Pending sightings', reviewCounts.pending_sightings, 'contributions'],
                ['bounties', 'Pending bounties', reviewCounts.pending_bounties, 'contributions'],
                ['leads', 'Pending leads', reviewCounts.pending_leads, 'contributions'],
              ].map(([id, label, count, destination]) => (
                <button
                  key={String(id)}
                  type="button"
                  className="card flex min-h-16 items-center justify-between gap-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
                  onClick={() => selectTab(destination as Tab, String(id))}
                >
                  <span className="font-bold text-stone-900">{label}</span>
                  <span className="inline-flex min-h-8 min-w-8 items-center justify-center rounded-full bg-amber-100 px-2 font-black text-amber-900">{count}</span>
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {tab === 'suggestions' && (
        <div className="space-y-4">
          {[...products.map((item) => ({ item, kind: 'product' as const })), ...stores.map((item) => ({ item, kind: 'store' as const }))]
            .filter(({ item }) => item.status === 'pending')
            .filter(({ kind }) => !queue || queue === `${kind}_suggestions`)
            .map(({ item, kind }) => <SuggestionReviewCard key={`${kind}-${item.id}`} kind={kind} suggestion={item} onResolved={loadAdminData} />)}
          {products.every((item) => item.status !== 'pending') && stores.every((item) => item.status !== 'pending') && <p className="card text-sm text-stone-600">No suggestions are waiting for review.</p>}
        </div>
      )}

      {tab === 'contributions' && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2" aria-label="Contribution filters">
            <button type="button" className={`btn-secondary min-h-11 ${!queue ? 'ring-2 ring-brand-600' : ''}`} onClick={() => selectTab('contributions')}>All</button>
            <button type="button" className={`btn-secondary min-h-11 ${queue === 'sightings' ? 'ring-2 ring-brand-600' : ''}`} onClick={() => selectTab('contributions', 'sightings')}>Sightings</button>
            <button type="button" className={`btn-secondary min-h-11 ${queue === 'bounties' ? 'ring-2 ring-brand-600' : ''}`} onClick={() => selectTab('contributions', 'bounties')}>Bounties</button>
            <button type="button" className={`btn-secondary min-h-11 ${queue === 'leads' ? 'ring-2 ring-brand-600' : ''}`} onClick={() => selectTab('contributions', 'leads')}>Leads</button>
            <span className="mx-1 self-center text-stone-400" aria-hidden="true">|</span>
            <button type="button" className={`btn-secondary min-h-11 ${queue === 'disputed' ? 'ring-2 ring-brand-600' : ''}`} onClick={() => selectTab('contributions', 'disputed')}>Disputed</button>
            <button type="button" className={`btn-secondary min-h-11 ${queue === 'possibly_gone' ? 'ring-2 ring-brand-600' : ''}`} onClick={() => selectTab('contributions', 'possibly_gone')}>Possibly gone</button>
            {queue && <button type="button" className="btn-ghost min-h-11" onClick={() => selectTab('contributions')}>Clear filter</button>}
          </div>
          {contributions
            .filter((item) => !queue || queue === `${item.contribution_type}s` || queue === item.community_state)
            .map((item) => (
            <article key={`${item.contribution_type}-${item.contribution_id}`} className="card flex flex-wrap items-center justify-between gap-3">
              <div><p className="text-xs font-bold uppercase text-stone-500">{item.contribution_type} · {item.moderation_status}</p><h3 className="font-bold text-stone-900">{item.product_name}</h3><p className="text-sm text-stone-600">{item.username ? `@${item.username}` : 'Member'} · {new Date(item.occurred_at).toLocaleString()}</p></div>
              {item.moderation_flagged && (
                <p className="rounded border border-red-300 bg-red-50 px-2 py-1 text-xs font-black uppercase tracking-wide text-red-800">
                  OpenAI flagged{item.moderation_categories?.length ? `: ${item.moderation_categories.join(', ')}` : ''}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {item.moderation_status === 'pending' && (
                  <button type="button" className="btn-primary" disabled={actionId === item.contribution_id} onClick={() => void moderate(item, 'approve')}><Check size={17} aria-hidden="true" /> Approve</button>
                )}
                {item.moderation_status === 'hidden'
                  ? <button type="button" className="btn-secondary" disabled={actionId === item.contribution_id} onClick={() => void moderate(item, 'restore')}><ClockCounterClockwise size={17} aria-hidden="true" /> Restore</button>
                  : <button type="button" className="btn-secondary" disabled={actionId === item.contribution_id} onClick={() => void moderate(item, 'hide')}><EyeSlash size={17} aria-hidden="true" /> Hide</button>}
              </div>
              {item.contribution_type === 'sighting' && (
                <p className="w-full text-xs font-semibold text-stone-600">
                  {item.verified_count ?? 0} verified · {item.not_found_count ?? 0} not found
                  {item.community_state ? ` · ${item.community_state.replace(/_/g, ' ')}` : ''}
                </p>
              )}
            </article>
          ))}
          {!contributions.some((item) => !queue || queue === `${item.contribution_type}s` || queue === item.community_state) && <p className="card text-sm text-stone-600">No contributions match this review filter.</p>}
        </div>
      )}

      {tab === 'interests' && (
        <div className="space-y-3">
          {interests.map((item) => <article key={item.id} className="card"><div className="flex flex-wrap justify-between gap-2"><p className="text-xs font-bold uppercase text-brand-700">{item.source} · {item.digest_status ?? 'unassigned'}</p><time className="text-xs text-stone-500">{new Date(item.created_at).toLocaleString()}</time></div>{item.email && item.source !== 'onboarding_looking_for' && <p className="mt-2 text-sm font-semibold text-stone-900">{item.email}{item.username ? ` · @${item.username}` : ''}</p>}<p className="mt-1 whitespace-pre-wrap text-sm text-stone-700">{item.reason ?? item.looking_for ?? 'No details supplied.'}</p></article>)}
          {interests.length === 0 && <p className="card text-sm text-stone-600">No interest submissions yet.</p>}
        </div>
      )}

      {tab === 'members' && (
        <div className="space-y-5">
          <form onSubmit={restrictMember} className="card space-y-3">
            <h2 className="font-bold text-stone-900">Restrict a member</h2>
            <input className="input" value={memberSearchQuery} onChange={(event) => void searchMembers(event.target.value)} placeholder="Search by username…" />
            {memberSearchResults.length > 0 && (
              <div className="space-y-1">
                {memberSearchResults.map((m) => (
                  <button key={m.user_id} type="button" className="block w-full rounded-lg border border-stone-200 px-3 py-2 text-left text-sm hover:bg-stone-50" onClick={() => { setMemberId(m.user_id); setMemberSearchQuery(`@${m.username}`); setMemberSearchResults([]) }}>
                    @{m.username} · {m.karma} karma · joined {new Date(m.created_at).toLocaleDateString()}
                  </button>
                ))}
              </div>
            )}
            <input className="input" value={memberId} onChange={(event) => setMemberId(event.target.value)} placeholder="Member UUID (auto-filled from search)" required />
            <div className="grid gap-3 sm:grid-cols-2"><select className="input" value={memberStatus} onChange={(event) => setMemberStatus(event.target.value as 'suspended' | 'disabled')}><option value="suspended">Suspended</option><option value="disabled">Disabled</option></select><input className="input" type="datetime-local" value={memberExpiry} onChange={(event) => setMemberExpiry(event.target.value)} aria-label="Optional restriction expiry" disabled={memberStatus === 'disabled'} /></div>
            <textarea className="input min-h-20" value={memberReason} onChange={(event) => setMemberReason(event.target.value)} maxLength={500} placeholder="Reason (private)" required />
            <button type="submit" className="btn-primary">Apply restriction</button>
          </form>
          {restrictions.map((item) => <article key={item.user_id} className="card flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-bold text-stone-900">{item.username ? `@${item.username}` : item.user_id}</h3><p className="text-sm text-stone-600">{item.status}{item.expires_at ? ` until ${new Date(item.expires_at).toLocaleString()}` : ''}</p>{item.reason && <p className="mt-1 text-sm text-stone-600">{item.reason}</p>}</div><button type="button" className="btn-secondary" onClick={() => void clearRestriction(item.user_id)}>Restore access</button></article>)}
        </div>
      )}

      {tab === 'stores' && (
        <div className="space-y-5">
          <form onSubmit={handleCreateStore} className="card space-y-3">
            <h2 className="font-bold text-stone-900">Add a store</h2>
            <input className="input" value={newStoreRetailer} onChange={(event) => setNewStoreRetailer(event.target.value)} placeholder="Retailer name (e.g. Target)" required />
            <input className="input" value={newStoreName} onChange={(event) => setNewStoreName(event.target.value)} placeholder="Store name (e.g. Target Lansing)" required />
            <input className="input" value={newStoreAddress} onChange={(event) => setNewStoreAddress(event.target.value)} placeholder="Street address" required />
            <div className="grid gap-3 sm:grid-cols-3">
              <input className="input" value={newStoreCity} onChange={(event) => setNewStoreCity(event.target.value)} placeholder="City" required />
              <input className="input" value={newStoreState} onChange={(event) => setNewStoreState(event.target.value.toUpperCase().slice(0, 2))} placeholder="State (2-letter)" required />
              <input className="input" value={newStoreZip} onChange={(event) => setNewStoreZip(event.target.value.replace(/\D/g, '').slice(0, 5))} placeholder="ZIP" required />
            </div>
            {catalogError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{catalogError}</p>}
            <button type="submit" className="btn-primary" disabled={catalogLoading}>{catalogLoading ? 'Creating…' : 'Create store'}</button>
          </form>

          {catalogStores.length > 0 && (
            <div className="space-y-3">
              <h2 className="font-bold text-stone-900">Manage stores ({catalogStores.length})</h2>
              {catalogStores.map((store) => (
                <StoreCatalogRow
                  key={store.id}
                  store={store}
                  editing={editingStoreId === store.id}
                  actionLoading={catalogActionId === store.id}
                  onEdit={() => setEditingStoreId(editingStoreId === store.id ? null : store.id)}
                  onSave={(updates) => void handleUpdateStore(store, updates)}
                  onDisable={() => void handleDisableStore(store.id)}
                  onRestore={() => void handleRestoreStore(store.id)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'products' && (
        <div className="space-y-5">
          <form onSubmit={handleCreateProduct} className="card space-y-3">
            <h2 className="font-bold text-stone-900">Add a product</h2>
            <input className="input" value={newProductName} onChange={(event) => setNewProductName(event.target.value)} placeholder="Product name" required />
            <input className="input" value={newProductTrend} onChange={(event) => setNewProductTrend(event.target.value)} placeholder="Trend UUID" required />
            <div className="grid gap-3 sm:grid-cols-2">
              <select className="input" value={newProductAvailability} onChange={(event) => setNewProductAvailability(event.target.value)}>
                <option value="available">Available now</option>
                <option value="backorder">Backorder</option>
                <option value="preorder">Preorder</option>
                <option value="announced">Announced</option>
                <option value="limited">Limited release</option>
              </select>
              <input className="input" value={newProductBrand} onChange={(event) => setNewProductBrand(event.target.value)} placeholder="Brand (optional)" maxLength={120} />
            </div>
            <input className="input" value={newProductCategory} onChange={(event) => setNewProductCategory(event.target.value)} placeholder="Category (optional, e.g. Squishy)" maxLength={120} />
            <input className="input" value={newProductSearchTerms} onChange={(event) => setNewProductSearchTerms(event.target.value)} placeholder="Search keywords (optional, space-separated)" maxLength={500} />
            {catalogError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{catalogError}</p>}
            <button type="submit" className="btn-primary" disabled={catalogLoading}>{catalogLoading ? 'Creating…' : 'Create product'}</button>
          </form>

          {catalogProducts.length > 0 && (
            <div className="space-y-3">
              <h2 className="font-bold text-stone-900">Manage products ({catalogProducts.length})</h2>
              {catalogProducts.map((product) => (
                <ProductCatalogRow
                  key={product.id}
                  product={product}
                  editing={editingProductId === product.id}
                  actionLoading={catalogActionId === product.id}
                  onEdit={() => setEditingProductId(editingProductId === product.id ? null : product.id)}
                  onSave={(updates) => void handleUpdateProduct(product, updates)}
                  onDisable={() => void handleDisableProduct(product.id)}
                  onRestore={() => void handleRestoreProduct(product.id)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'history' && (
        <div className="space-y-3">
          {history.map((item) => <article key={item.id} className="card"><div className="flex flex-wrap justify-between gap-2"><p className="text-sm font-bold text-stone-900">{item.contribution_type}: {item.previous_status ?? 'new'} → {item.new_status}</p><time className="text-xs text-stone-500">{new Date(item.created_at).toLocaleString()}</time></div><p className="mt-1 break-all text-xs text-stone-500">{item.contribution_id}</p>{item.reason && <p className="mt-2 text-sm text-stone-700">{item.reason}</p>}</article>)}
          {history.length === 0 && <p className="card text-sm text-stone-600">No moderation history yet.</p>}
        </div>
      )}

      {tab === 'trend-engine' && <TrendEnginePanel />}
    </div>
  )
}
