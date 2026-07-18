import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CalendarBlank, ShieldCheck, Storefront, Users, ShoppingCart } from '@phosphor-icons/react'
import CatalogSearchSelect, { type CatalogSelection } from '../components/CatalogSearchSelect'
import CatalogSuggestionForm, {
  createCatalogSuggestionDraft,
  parseCatalogSuggestionDraft,
  type CatalogSuggestionDraftValues,
  type ProductSuggestionValues,
  type StoreSuggestionValues,
} from '../components/CatalogSuggestionForm'
import ContributionDraftNotice from '../components/ContributionDraftNotice'
import FormDraftStatus from '../components/FormDraftStatus'
import PhotoUpload, { deleteSightingPhotoPaths } from '../components/PhotoUpload'
import {
  confirmLeadWithSighting,
  createSightingsBatch,
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
import { useMascotToast } from '../contexts/MascotToastContext'
import { useAuth } from '../contexts/AuthContext'
import { useFormDraft } from '../hooks/useFormDraft'
import { createDraftSubmissionId } from '../lib/formDraftStore'
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

type SightingLocalDraft = {
  version: 1
  submissionId: string
  product: CatalogSelection | null
  selectedStores: CatalogSelection[]
  seenAt: string
  whenSeen: 'today' | 'yesterday' | 'older'
  olderDate: string
  availability: 'in_stock' | 'low_stock' | 'sold_out' | 'unknown'
  quantity: string
  notes: string
  photoUrls: string[]
  suggestion: { kind: 'product' | 'store'; initialName: string } | null
  suggestionValues: CatalogSuggestionDraftValues | null
  serverDraftId: string | null
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

function parseSightingLocalDraft(value: unknown): SightingLocalDraft | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as Record<string, unknown>
  if (candidate.version !== 1 || typeof candidate.submissionId !== 'string') return null
  const product = candidate.product === null ? null : isSelection(candidate.product) ? candidate.product : undefined
  if (product === undefined || !Array.isArray(candidate.selectedStores) || candidate.selectedStores.some((store) => !isSelection(store))) return null
  if (typeof candidate.seenAt !== 'string' || typeof candidate.olderDate !== 'string') return null
  if (candidate.whenSeen !== 'today' && candidate.whenSeen !== 'yesterday' && candidate.whenSeen !== 'older') return null
  if (candidate.availability !== 'in_stock' && candidate.availability !== 'low_stock' && candidate.availability !== 'sold_out' && candidate.availability !== 'unknown') return null
  if (typeof candidate.quantity !== 'string' || typeof candidate.notes !== 'string') return null
  if (!Array.isArray(candidate.photoUrls) || candidate.photoUrls.some((path) => typeof path !== 'string')) return null
  let suggestion: SightingLocalDraft['suggestion'] = null
  if (candidate.suggestion !== null) {
    if (!candidate.suggestion || typeof candidate.suggestion !== 'object' || Array.isArray(candidate.suggestion)) return null
    const rawSuggestion = candidate.suggestion as Record<string, unknown>
    if ((rawSuggestion.kind !== 'product' && rawSuggestion.kind !== 'store') || typeof rawSuggestion.initialName !== 'string') return null
    suggestion = { kind: rawSuggestion.kind, initialName: rawSuggestion.initialName }
  }
  const suggestionValues = candidate.suggestionValues === null ? null : parseCatalogSuggestionDraft(candidate.suggestionValues)
  if (candidate.suggestionValues !== null && !suggestionValues) return null
  if (suggestion && suggestionValues && suggestion.kind !== suggestionValues.kind) return null
  if (candidate.serverDraftId !== null && typeof candidate.serverDraftId !== 'string') return null
  return {
    version: 1,
    submissionId: candidate.submissionId,
    product,
    selectedStores: candidate.selectedStores as CatalogSelection[],
    seenAt: candidate.seenAt,
    whenSeen: candidate.whenSeen,
    olderDate: candidate.olderDate,
    availability: candidate.availability,
    quantity: candidate.quantity,
    notes: candidate.notes,
    photoUrls: candidate.photoUrls as string[],
    suggestion,
    suggestionValues,
    serverDraftId: candidate.serverDraftId as string | null,
  }
}

function isEmptySightingDraft(value: SightingLocalDraft): boolean {
  return value.product === null
    && value.selectedStores.length === 0
    && value.quantity === ''
    && value.notes === ''
    && value.photoUrls.length === 0
    && value.suggestion === null
    && value.availability === 'in_stock'
    && value.whenSeen === 'today'
}

export default function NewSighting() {
  const [searchParams] = useSearchParams()
  const leadSlug = searchParams.get('lead')
  const requestedDraftId = searchParams.get('draft')
  const suggestedProductName = searchParams.get('suggestProduct')?.trim() ?? ''
  const { user } = useAuth()
  const [submissionId, setSubmissionId] = useState(createDraftSubmissionId)
  const [product, setProduct] = useState<CatalogSelection | null>(null)
  const [selectedStores, setSelectedStores] = useState<CatalogSelection[]>([])
  const [storeQuery, setStoreQuery] = useState('')
  const [storeResults, setStoreResults] = useState<StoreSearchResult[]>([])
  const [seenAt, setSeenAt] = useState(() => localDateTime(new Date()))
  const [whenSeen, setWhenSeen] = useState<'today' | 'yesterday' | 'older'>('today')
  const [olderDate, setOlderDate] = useState('')
  const [availability, setAvailability] = useState<'in_stock' | 'low_stock' | 'sold_out' | 'unknown'>('in_stock')
  const [quantity, setQuantity] = useState('')
  const [notes, setNotes] = useState('')
  const [draft, setDraft] = useState<ContributionDraft | null>(null)
  const [suggestion, setSuggestion] = useState<{ kind: 'product' | 'store'; initialName: string } | null>(null)
  const [suggestionValues, setSuggestionValues] = useState<CatalogSuggestionDraftValues | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [suggestionError, setSuggestionError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [draftLoading, setDraftLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [lead, setLead] = useState<LeadDetailView | null>(null)
  const [leadLoading, setLeadLoading] = useState(false)
  const [photoUrls, setPhotoUrls] = useState<string[]>([])
  const [photoUploading, setPhotoUploading] = useState(false)
  const [mediaRestored, setMediaRestored] = useState(false)
  const restoredLocalDraftRef = useRef(false)
  const openedSuggestionFromQueryRef = useRef(false)
  const toast = useMascotToast()

  const localDraftValue: SightingLocalDraft = {
    version: 1,
    submissionId,
    product,
    selectedStores,
    seenAt,
    whenSeen,
    olderDate,
    availability,
    quantity,
    notes,
    photoUrls,
    suggestion,
    suggestionValues,
    serverDraftId: draft?.id ?? null,
  }
  const localDraft = useFormDraft({
    scope: user ? { userId: user.id, formType: 'sighting', entityId: leadSlug ? `lead:${leadSlug}` : 'new' } : null,
    value: localDraftValue,
    parse: parseSightingLocalDraft,
    isEmpty: isEmptySightingDraft,
    metadata: {
      title: product?.label || (leadSlug ? 'Lead confirmation' : 'Sighting draft'),
      destination: leadSlug ? `/sightings/new?lead=${encodeURIComponent(leadSlug)}` : '/sightings/new',
      submissionId,
      serverDraftId: draft?.id,
      mediaPaths: photoUrls,
    },
    onRestore: (restored) => {
      restoredLocalDraftRef.current = true
      setSubmissionId(restored.submissionId)
      setProduct(restored.product)
      setSelectedStores(restored.selectedStores)
      setSeenAt(restored.seenAt)
      setWhenSeen(restored.whenSeen)
      setOlderDate(restored.olderDate)
      setAvailability(restored.availability)
      setQuantity(restored.quantity)
      setNotes(restored.notes)
      setPhotoUrls(restored.photoUrls)
      setMediaRestored(restored.photoUrls.length > 0)
      setSuggestion(restored.suggestion)
      setSuggestionValues(restored.suggestionValues)
      if (restored.serverDraftId) void loadDraft(restored.serverDraftId, false)
      trackEvent('draft_restored', { form: 'sighting' })
    },
  })

  function currentPayload(): SightingPayload {
    return { version: 2, product, selectedStores, seenAt, availability, quantity, notes, photoUrls }
  }

  function handleProductChange(next: CatalogSelection | null) {
    setProduct(next)
    if (next && draft && (draft.state === 'waiting_for_approval' || draft.state === 'needs_attention')) {
      setDraft(null)
    }
  }

  function openSuggestion(kind: 'product' | 'store', initialName: string) {
    setSuggestion({ kind, initialName })
    setSuggestionValues(createCatalogSuggestionDraft(kind, initialName))
  }

  function closeSuggestion() {
    setSuggestion(null)
    setSuggestionValues(null)
  }

  useEffect(() => {
    if (
      openedSuggestionFromQueryRef.current
      || !suggestedProductName
      || leadSlug
      || requestedDraftId
      || restoredLocalDraftRef.current
    ) return
    openedSuggestionFromQueryRef.current = true
    openSuggestion('product', suggestedProductName)
  }, [leadSlug, requestedDraftId, suggestedProductName])

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
    if (typeof payload.seenAt === 'string') {
      setSeenAt(payload.seenAt)
      const restoredDate = payload.seenAt.slice(0, 10)
      const todayStr = new Date().toISOString().slice(0, 10)
      const yesterdayStr = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
      if (restoredDate === todayStr) setWhenSeen('today')
      else if (restoredDate === yesterdayStr) setWhenSeen('yesterday')
      else { setWhenSeen('older'); setOlderDate(restoredDate) }
    }
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

  async function loadDraft(idToLoad: string, restoreFields = true) {
    const { data } = await getMyContributionDrafts()
    const nextDraft = (data ?? []).find((candidate) => candidate.draft_type === 'sighting' && candidate.id === idToLoad)
    if (!nextDraft) {
      if (requestedDraftId === idToLoad) setError('That sighting draft could not be found. It may have expired or been discarded.')
      return
    }
    if (restoreFields) await restoreDraft(nextDraft)
    else setDraft(nextDraft)
  }

  useEffect(() => {
    if (requestedDraftId) void loadDraft(requestedDraftId, !restoredLocalDraftRef.current)
  }, [requestedDraftId])

  useEffect(() => {
    if (whenSeen === 'today') {
      setSeenAt(localDateTime(new Date()))
    } else if (whenSeen === 'yesterday') {
      const y = new Date()
      y.setDate(y.getDate() - 1)
      setSeenAt(`${localDateTime(y).slice(0, 10)}T12:00`)
    } else if (whenSeen === 'older' && olderDate) {
      setSeenAt(`${olderDate}T12:00`)
    }
  }, [whenSeen, olderDate])

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
      // A lead can only be confirmed by an available product.  A restored
      // regular-sighting draft may carry one of the other availability values.
      setAvailability((current) => current === 'sold_out' || current === 'unknown' ? 'in_stock' : current)
      setProduct({ id: data.product_id, slug: data.product_slug, label: data.product_name, detail: '' })
      if (data.store_id && data.store_name) {
        setSelectedStores([{ id: data.store_id, slug: data.store_slug ?? '', label: data.store_name, detail: [data.store_city, data.store_state].filter(Boolean).join(', ') }])
      }
    })
  }, [leadSlug])

  async function saveDraft() {
    setError(null)
    setDraftLoading(true)
    const { data: savedDraftId, error: saveError } = await saveContributionDraft({
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
    toast('Draft saved!', 'Scout tucked it away safely.')
    if (savedDraftId) await loadDraft(savedDraftId)
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
    toast('Draft discarded', 'Scout cleaned that up.')
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
    toast('Suggestion submitted!', 'Scout sent it for review.')
    closeSuggestion()
    const savedSuggestion = Array.isArray(result.data) ? result.data[0] : result.data
    if (savedSuggestion?.draft_id) await loadDraft(savedSuggestion.draft_id)
  }

  async function discardLocalDraft() {
    const pathsToRemove = [...photoUrls]
    localDraft.discard()
    setSubmissionId(createDraftSubmissionId())
    setProduct(null)
    setSelectedStores([])
    setStoreQuery('')
    setStoreResults([])
    setSeenAt(localDateTime(new Date()))
    setWhenSeen('today')
    setOlderDate('')
    setAvailability('in_stock')
    setQuantity('')
    setNotes('')
    setPhotoUrls([])
    setMediaRestored(false)
    closeSuggestion()
    setDraft(null)
    trackEvent('draft_discarded', { form: 'sighting' })
    const removed = await deleteSightingPhotoPaths(pathsToRemove)
    if (!removed) toast('Draft discarded', 'One or more uploaded photos will be cleaned up automatically.')
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    if (!product) {
      setError('Choose a verified product or submit it for approval.')
      return
    }
    if (photoUploading) {
      setError('Wait for photo uploads to finish before submitting.')
      return
    }
    if (selectedStores.length === 0) {
      setError('Choose at least one store or submit the location for approval.')
      return
    }
    if (lead && selectedStores.length > 1) {
      setError('Lead confirmation requires exactly one store.')
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
        trackEvent('report_sighting_failed', { mode: 'lead_confirmation', reason: 'request_failed' })
        setError(mapContributionError(confirmError))
        return
      }
      trackEvent('confirm_lead', { availability })
      localDraft.discard()
      setSubmitted(true)
      return
    }
    const { error: createError } = await createSightingsBatch({
      submissionId,
      productId: product.id,
      storeIds: selectedStores.map((store) => store.id),
      seenAt: seenDate.toISOString(),
      availability,
      quantity: parsedQuantity,
      notes: notes.trim() || null,
      draftId: draft?.id ?? null,
      photoUrls: photoUrls.length > 0 ? photoUrls : null,
    })
    setLoading(false)
    if (createError) {
      trackEvent('report_sighting_failed', { mode: 'new_sighting', reason: 'request_failed' })
      setError(mapContributionError(createError))
      return
    }
    trackEvent('report_sighting', { availability, store_count: selectedStores.length })
    localDraft.discard()
    setSubmitted(true)
  }

  const whenSeenOptions = [
    { value: 'today' as const, label: 'Today' },
    { value: 'yesterday' as const, label: 'Yesterday' },
    { value: 'older' as const, label: '2+ days ago' },
  ]

  const olderDateMin = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const olderDateMax = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  const availabilityOptions = [
    { value: 'in_stock', label: 'In Stock', activeClass: 'border-green-600 bg-green-50 text-green-700' },
    { value: 'low_stock', label: 'Low Stock', activeClass: 'border-amber-500 bg-brand-50 text-brand-800' },
    { value: 'sold_out', label: 'Sold Out', activeClass: 'border-red-500 bg-red-50 text-red-700' },
    { value: 'unknown', label: 'Unknown', activeClass: 'border-stone-400 bg-stone-50 text-stone-600' },
  ] as const
  const confirmationAvailabilityOptions = availabilityOptions.filter(
    (option) => option.value === 'in_stock' || option.value === 'low_stock',
  )

  return (
    <div className="space-y-6">
      <div>
        <Link to={lead ? `/leads/${lead.slug}` : '/sightings'} className="text-sm text-stone-500 hover:text-stone-700">← {lead ? 'Back to lead' : 'Sightings'}</Link>
        <div className="mt-3 flex items-center gap-4">
          <div className="fiv-step-badge text-lg">1</div>
          <div>
            <h1 className="text-2xl font-bold text-stone-900">{lead ? 'Confirm Lead' : 'New Sighting'}</h1>
            <p className="mt-0.5 text-sm text-stone-500">{lead ? 'Report what you saw to confirm this restock lead.' : 'Found it? Help the community by sharing the details.'}</p>
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
          <h2 className="text-lg font-bold text-green-800">{lead ? 'Confirmation submitted' : `Sighting posted${selectedStores.length === 1 ? ` at ${selectedStores[0]?.label}` : ''}`}</h2>
          <p className="text-sm text-green-700">
            {lead
              ? 'An automated safety check is running. Clean confirmations publish and confirm the lead within a few minutes; flagged reports stay private for owner review.'
              : 'Your sighting is now visible to local shoppers.'}
          </p>
          <div className="flex gap-2">
            <Link to="/sightings" className="btn-secondary">View post</Link>
            <button type="button" className="btn-primary" onClick={() => { setSubmitted(false); setSubmissionId(createDraftSubmissionId()); setProduct(null); setSelectedStores([]); setQuantity(''); setNotes(''); setPhotoUrls([]); setDraft(null) }}>Add another store</button>
          </div>
        </div>
      )}

      {!submitted && !leadLoading && (
        <>
      {draft && <ContributionDraftNotice draft={draft} onDiscard={discardDraft} discarding={draftLoading} />}
      <FormDraftStatus
        status={localDraft.status}
        error={localDraft.error}
        hasDraft={localDraft.hasDraft}
        hasConflict={Boolean(localDraft.conflict)}
        onDiscard={() => void discardLocalDraft()}
        onRestoreConflict={localDraft.restoreConflict}
        onKeepCurrent={localDraft.keepCurrent}
      />

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
              onSuggest={(initialName) => openSuggestion('product', initialName)}
              required
              disabled={Boolean(lead)}
            />
            {suggestion?.kind === 'product' && (
              <CatalogSuggestionForm kind="product" initialName={suggestion.initialName} value={suggestionValues ?? undefined} onChange={setSuggestionValues} loading={draftLoading} error={suggestionError} onCancel={closeSuggestion} onSubmit={submitSuggestion} />
            )}
          </div>

          {/* Step 2: Store Selection */}
          <div className="space-y-3">
            <h2 className="fiv-section-heading"><span className="fiv-step-badge">2</span> Where did you see it?</h2>
            <p className="text-xs text-stone-500">{lead ? 'Select the exact store where you confirmed the product.' : 'Select one or more stores where you spotted the product.'}</p>
            <div>
              {(!lead || selectedStores.length === 0) && (
                <>
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
                      className="block w-full rounded-lg border border-stone-200 px-3 py-2 text-left text-sm hover:bg-stone-50"
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
              {storeQuery.trim().length >= 2 && storeResults.length === 0 && !suggestion && !lead && (
                <button
                  type="button"
                  className="mt-2 text-sm font-semibold text-brand-700 hover:text-brand-900"
                  onClick={() => openSuggestion('store', storeQuery.trim())}
                >
                  Can't find it? Suggest a store
                </button>
              )}
                </>
              )}
            </div>
            {suggestion?.kind === 'store' && (
              <CatalogSuggestionForm kind="store" initialName={suggestion.initialName} value={suggestionValues ?? undefined} onChange={setSuggestionValues} loading={draftLoading} error={suggestionError} onCancel={closeSuggestion} onSubmit={submitSuggestion} />
            )}
            {selectedStores.length > 0 && (
              <div className="mt-2 space-y-2">
                {selectedStores.map(s => (
                  <div key={s.id} className="fiv-store-card fiv-store-card-selected">
                    <Storefront size={20} weight="fill" className="shrink-0 text-brand-600" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-stone-900">{s.label}</p>
                      <p className="truncate text-xs text-stone-500">{s.detail}</p>
                    </div>
                    {(!lead || selectedStores.length > 1) && (
                      <button
                        type="button"
                        className="rounded p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-700"
                        onClick={() => removeStore(s.id)}
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Step 3: Exact Location Notes */}
          <div className="space-y-3">
            <h2 className="fiv-section-heading"><span className="fiv-step-badge">3</span> Exact location <span className="text-xs font-normal text-stone-400">(Optional)</span></h2>
            <p className="text-xs text-stone-500">Help others find it faster.</p>
            <textarea
              className="input min-h-20"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              maxLength={2000}
              placeholder="Aisle G32, top shelf on the right..."
            />
            <p className="text-right text-xs text-stone-400">{notes.length}/2000</p>
          </div>
        </div>

        {/* RIGHT COLUMN */}
        <div className="space-y-6">
          {/* Step 4: When did you see it? */}
          <div className="space-y-3">
            <h2 className="fiv-section-heading"><span className="fiv-step-badge">4</span> When did you see it?</h2>
            <fieldset>
              <legend className="sr-only">When did you see it?</legend>
              <div className="grid grid-cols-3 gap-2">
                {whenSeenOptions.map((opt) => (
                  <label key={opt.value} className={`fiv-availability-btn ${whenSeen === opt.value ? 'border-brand-600 bg-brand-50 text-brand-700' : 'fiv-availability-btn-inactive'}`}>
                    <input className="sr-only" type="radio" name="whenSeen" value={opt.value} checked={whenSeen === opt.value} onChange={() => setWhenSeen(opt.value)} />
                    {opt.label}
                  </label>
                ))}
              </div>
            </fieldset>
            {whenSeen === 'older' && (
              <div>
                <label className="label" htmlFor="seen-date">Pick a date</label>
                <div className="relative">
                  <CalendarBlank size={18} weight="duotone" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-stone-400" />
                  <input
                    id="seen-date"
                    className="input pr-10"
                    type="date"
                    value={olderDate}
                    min={olderDateMin}
                    max={olderDateMax}
                    onChange={(event) => setOlderDate(event.target.value)}
                    required
                  />
                </div>
              </div>
            )}
          </div>

          {/* Step 5: Photo Upload */}
          <div className="space-y-3">
            <h2 className="fiv-section-heading"><span className="fiv-step-badge">5</span> Upload a photo</h2>
            <p className="text-xs text-stone-500">A clear photo helps verify the sighting.</p>
            <PhotoUpload
              photoUrls={photoUrls}
              onChange={(urls) => { setPhotoUrls(urls); setMediaRestored(false) }}
              submissionId={submissionId}
              onUploadingChange={setPhotoUploading}
              maxPhotos={4}
              disabled={loading || draftLoading}
            />
            {photoUrls.length > 0 && mediaRestored && <p className="text-xs font-medium text-green-700">Uploaded photos were restored with this draft.</p>}
          </div>

          {/* Availability */}
          <div className="space-y-3">
            <h2 className="fiv-section-heading"><span className="fiv-step-badge">6</span> Availability</h2>
            <fieldset>
              <legend className="sr-only">Availability</legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {(lead ? confirmationAvailabilityOptions : availabilityOptions).map((opt) => (
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
          <div className="flex items-start gap-2 text-sm text-stone-600">
            <Users size={18} weight="duotone" className="mt-0.5 shrink-0 text-brand-500" />
            <div>
              <p className="font-semibold text-stone-900">Thanks! Your sighting helps the community.</p>
              <p className="text-xs">It might make someone's day.</p>
            </div>
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <button type="button" className="btn-secondary sm:flex-1" onClick={saveDraft} disabled={loading || draftLoading}>
              {draftLoading ? 'Saving…' : 'Save private draft'}
            </button>
            <button type="submit" className="btn-primary sm:flex-[2]" disabled={loading || draftLoading || photoUploading}>
              {loading ? 'Submitting…' : photoUploading ? 'Uploading photos…' : lead ? 'Confirm lead' : 'Submit sighting'}
            </button>
          </div>
        </div>
      </form>
        </>
      )}
    </div>
  )
}
