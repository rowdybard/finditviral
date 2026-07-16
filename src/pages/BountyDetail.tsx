import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { CalendarBlank } from '@phosphor-icons/react'
import CatalogSearchSelect, { type CatalogSelection } from '../components/CatalogSearchSelect'
import EmptyState from '../components/EmptyState'
import FormDraftStatus from '../components/FormDraftStatus'
import { useAuth } from '../contexts/AuthContext'
import { useFormDraft } from '../hooks/useFormDraft'
import { createDraftSubmissionId } from '../lib/formDraftStore'
import { trackEvent } from '../lib/analytics'
import { mapContributionError } from '../lib/errorMap'
import { deleteBounty, getBountyDetail, listMyBountyClaims, submitBountyClaim, updateBounty } from '../lib/launchApi'
import { supabase } from '../lib/supabase'
import type { BountyClaimView, BountyDetailView } from '../types/database'
import { formatReward, statusColor, statusLabel, timeAgo } from '../lib/utils'

function localDateTime(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

type ClaimLocalDraft = {
  version: 1
  submissionId: string
  showClaimForm: boolean
  store: CatalogSelection | null
  seenAt: string
  whenSeen: 'today' | 'yesterday' | 'older'
  olderDate: string
  availability: 'in_stock' | 'low_stock'
  quantity: string
  notes: string
}

function isSelection(value: unknown): value is CatalogSelection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.id === 'string' && typeof candidate.label === 'string' && typeof candidate.detail === 'string'
}

function parseClaimLocalDraft(value: unknown): ClaimLocalDraft | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as Record<string, unknown>
  if (candidate.version !== 1 || typeof candidate.submissionId !== 'string' || typeof candidate.showClaimForm !== 'boolean') return null
  const store = candidate.store === null ? null : isSelection(candidate.store) ? candidate.store : undefined
  if (store === undefined || typeof candidate.seenAt !== 'string' || typeof candidate.olderDate !== 'string') return null
  if (candidate.whenSeen !== 'today' && candidate.whenSeen !== 'yesterday' && candidate.whenSeen !== 'older') return null
  if (candidate.availability !== 'in_stock' && candidate.availability !== 'low_stock') return null
  if (typeof candidate.quantity !== 'string' || typeof candidate.notes !== 'string') return null
  return {
    version: 1,
    submissionId: candidate.submissionId,
    showClaimForm: candidate.showClaimForm,
    store,
    seenAt: candidate.seenAt,
    whenSeen: candidate.whenSeen,
    olderDate: candidate.olderDate,
    availability: candidate.availability,
    quantity: candidate.quantity,
    notes: candidate.notes,
  }
}

function isEmptyClaimDraft(value: ClaimLocalDraft): boolean {
  return !value.showClaimForm
    && value.quantity === ''
    && value.notes === ''
    && value.availability === 'in_stock'
    && value.whenSeen === 'today'
}

export default function BountyDetail() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const [submissionId, setSubmissionId] = useState(createDraftSubmissionId)
  const [bounty, setBounty] = useState<BountyDetailView | null>(null)
  const [claims, setClaims] = useState<BountyClaimView[]>([])
  const [loading, setLoading] = useState(true)
  const [showClaimForm, setShowClaimForm] = useState(false)
  const [claimStore, setClaimStore] = useState<CatalogSelection | null>(null)
  const [claimSeenAt, setClaimSeenAt] = useState(() => localDateTime(new Date()))
  const [whenSeen, setWhenSeen] = useState<'today' | 'yesterday' | 'older'>('today')
  const [olderDate, setOlderDate] = useState('')
  const [claimAvailability, setClaimAvailability] = useState<'in_stock' | 'low_stock'>('in_stock')
  const [claimQuantity, setClaimQuantity] = useState('')
  const [claimNotes, setClaimNotes] = useState('')
  const [claimError, setClaimError] = useState<string | null>(null)
  const [claimLoading, setClaimLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [editRequirements, setEditRequirements] = useState('')
  const [editRewardAmount, setEditRewardAmount] = useState('')
  const [editDeadline, setEditDeadline] = useState('')
  const [editQuantityNeeded, setEditQuantityNeeded] = useState('')
  const [editVariantRequirements, setEditVariantRequirements] = useState('')
  const [editAcceptEquivalent, setEditAcceptEquivalent] = useState(false)
  const navigate = useNavigate()

  const localDraft = useFormDraft({
    scope: user && id ? { userId: user.id, formType: 'bounty-claim', entityId: id } : null,
    value: {
      version: 1,
      submissionId,
      showClaimForm,
      store: claimStore,
      seenAt: claimSeenAt,
      whenSeen,
      olderDate,
      availability: claimAvailability,
      quantity: claimQuantity,
      notes: claimNotes,
    } satisfies ClaimLocalDraft,
    parse: parseClaimLocalDraft,
    isEmpty: isEmptyClaimDraft,
    metadata: {
      title: bounty ? `Claim: ${bounty.product_name}` : 'Bounty claim draft',
      destination: id ? `/bounties/${id}` : '/bounties',
      submissionId,
    },
    onRestore: (restored) => {
      setSubmissionId(restored.submissionId)
      setShowClaimForm(restored.showClaimForm)
      setClaimStore(restored.store)
      setClaimSeenAt(restored.seenAt)
      setWhenSeen(restored.whenSeen)
      setOlderDate(restored.olderDate)
      setClaimAvailability(restored.availability)
      setClaimQuantity(restored.quantity)
      setClaimNotes(restored.notes)
      trackEvent('draft_restored', { form: 'bounty_claim' })
    },
  })

  function discardLocalClaim() {
    localDraft.discard()
    setSubmissionId(createDraftSubmissionId())
    setShowClaimForm(false)
    setClaimStore(bounty?.store_id && bounty.store_name ? { id: bounty.store_id, label: bounty.store_name, detail: 'Required store for this bounty' } : null)
    setClaimSeenAt(localDateTime(new Date()))
    setWhenSeen('today')
    setOlderDate('')
    setClaimAvailability('in_stock')
    setClaimQuantity('')
    setClaimNotes('')
    setClaimError(null)
    trackEvent('draft_discarded', { form: 'bounty_claim' })
  }

  const whenSeenOptions = [
    { value: 'today' as const, label: 'Today' },
    { value: 'yesterday' as const, label: 'Yesterday' },
    { value: 'older' as const, label: '2+ days ago' },
  ]
  const olderDateMin = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const olderDateMax = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  useEffect(() => {
    if (whenSeen === 'today') {
      setClaimSeenAt(localDateTime(new Date()))
    } else if (whenSeen === 'yesterday') {
      const y = new Date()
      y.setDate(y.getDate() - 1)
      setClaimSeenAt(`${localDateTime(y).slice(0, 10)}T12:00`)
    } else if (whenSeen === 'older' && olderDate) {
      setClaimSeenAt(`${olderDate}T12:00`)
    }
  }, [whenSeen, olderDate])

  async function reload() {
    if (!id) return
    const [detailResult, claimsResult] = await Promise.all([
      getBountyDetail(id),
      listMyBountyClaims(id),
    ])
    setBounty(detailResult.data)
    setClaims(claimsResult.data ?? [])
    if (detailResult.data?.store_id && detailResult.data.store_name) {
      setClaimStore({ id: detailResult.data.store_id, label: detailResult.data.store_name, detail: 'Required store for this bounty' })
    }
    if (detailResult.error) setActionError('This bounty could not be loaded.')
  }

  useEffect(() => {
    async function load() {
      await reload()
      setLoading(false)
    }
    void load()
  }, [id])

  async function handleClaimSubmit(event: React.FormEvent) {
    event.preventDefault()
    setClaimError(null)
    if (!bounty || !claimStore) {
      setClaimError('Choose the exact store where you found the product.')
      return
    }
    const quantity = claimQuantity === '' ? null : Number(claimQuantity)
    if (quantity !== null && (!Number.isInteger(quantity) || quantity < 1 || quantity > 99)) {
      setClaimError('Quantity must be a whole number from 1 to 99.')
      return
    }
    const seenDate = new Date(claimSeenAt)
    if (Number.isNaN(seenDate.getTime())) {
      setClaimError('Enter a valid sighting time.')
      return
    }

    setClaimLoading(true)
    const result = await submitBountyClaim({
      bountyId: bounty.id,
      storeId: claimStore.id,
      seenAt: seenDate.toISOString(),
      availability: claimAvailability,
      quantity,
      notes: claimNotes.trim() || null,
    })
    setClaimLoading(false)
    if (result.error) {
      setClaimError(mapContributionError(result.error))
      return
    }
    localDraft.discard()
    setSubmissionId(createDraftSubmissionId())
    setShowClaimForm(false)
    setClaimQuantity('')
    setClaimNotes('')
    setClaimAvailability('in_stock')
    setWhenSeen('today')
    setOlderDate('')
    trackEvent('submit_bounty_claim', { availability: claimAvailability })
    await reload()
  }

  async function handleClaimAction(claimId: string, action: 'accepted' | 'rejected') {
    setActionError(null)
    setActionLoading(claimId)
    const { error } = await supabase.rpc(action === 'accepted' ? 'accept_bounty_claim' : 'reject_bounty_claim', { p_claim_id: claimId })
    setActionLoading(null)
    if (error) {
      setActionError(error.message)
      return
    }
    if (action === 'accepted') trackEvent('accept_claim')
    await reload()
  }

  async function handleClose() {
    if (!id) return
    setActionError(null)
    setActionLoading('close')
    const { error } = await supabase.rpc('close_bounty', { p_bounty_id: id })
    setActionLoading(null)
    if (error) setActionError(error.message)
    else await reload()
  }

  function startEditing() {
    if (!bounty) return
    setEditRequirements(bounty.requirements ?? '')
    setEditRewardAmount(String(bounty.reward_cents / 100))
    setEditDeadline(localDateTime(new Date(bounty.deadline)))
    setEditQuantityNeeded(bounty.quantity_needed != null ? String(bounty.quantity_needed) : '')
    setEditVariantRequirements(bounty.variant_requirements ?? '')
    setEditAcceptEquivalent(bounty.accept_equivalent)
    setEditing(true)
    setActionError(null)
  }

  async function handleSaveEdit() {
    if (!bounty || !id) return
    setActionError(null)
    if (!/^\d+(?:\.\d{1,2})?$/.test(editRewardAmount)) {
      setActionError('Enter a reward with no more than two decimal places.')
      return
    }
    const rewardCents = Math.round(Number(editRewardAmount) * 100)
    if (!Number.isSafeInteger(rewardCents) || rewardCents < 100 || rewardCents > 1_000_000) {
      setActionError('Reward must be between $1 and $10,000.')
      return
    }
    const deadlineDate = new Date(editDeadline)
    const now = Date.now()
    if (Number.isNaN(deadlineDate.getTime()) || deadlineDate.getTime() < now + 60 * 60 * 1000 || deadlineDate.getTime() > now + 30 * 24 * 60 * 60 * 1000) {
      setActionError('Deadline must be between 1 hour and 30 days from now.')
      return
    }
    const parsedQty = editQuantityNeeded === '' ? null : Number(editQuantityNeeded)
    if (parsedQty !== null && (!Number.isInteger(parsedQty) || parsedQty < 1 || parsedQty > 999)) {
      setActionError('Quantity needed must be a whole number from 1 to 999.')
      return
    }
    setActionLoading('edit')
    const { error: updateError } = await updateBounty({
      bountyId: id,
      requirements: editRequirements.trim() || null,
      rewardCents,
      deadline: deadlineDate.toISOString(),
      quantityNeeded: parsedQty,
      variantRequirements: editVariantRequirements.trim() || null,
      acceptEquivalent: editAcceptEquivalent,
    })
    setActionLoading(null)
    if (updateError) {
      setActionError(mapContributionError(updateError))
      return
    }
    setEditing(false)
    trackEvent('edit_bounty')
    await reload()
  }

  async function handleDelete() {
    if (!id) return
    if (!window.confirm('Delete this bounty? This cannot be undone.')) return
    setActionError(null)
    setActionLoading('delete')
    const { error: deleteError } = await deleteBounty(id)
    setActionLoading(null)
    if (deleteError) {
      setActionError(mapContributionError(deleteError))
      return
    }
    trackEvent('delete_bounty')
    navigate('/bounties')
  }

  if (loading) return <div className="flex items-center justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-200 border-t-brand-500" /></div>
  if (!bounty) return <EmptyState title="Bounty not found" message="It may be expired, hidden, or unavailable to this account." action={<Link to="/bounties" className="btn-primary">View bounties</Link>} />

  const canClaim = !bounty.is_owner
    && bounty.status === 'open'
    && bounty.moderation_status === 'approved'
    && new Date(bounty.deadline).getTime() > Date.now()
    && !bounty.caller_claim_id

  return (
    <div className="space-y-6">
      <div>
        <Link to="/bounties" className="text-sm text-gray-500 hover:text-gray-700">← Bounties</Link>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
          <div><h1 className="text-2xl font-black text-gray-900">{bounty.product_name}</h1><p className="mt-1 text-sm text-gray-500">Posted by @{bounty.owner_username} · {timeAgo(bounty.created_at)}</p></div>
          <span className={`badge ${statusColor(bounty.status)}`}>{statusLabel(bounty.status)}</span>
        </div>
      </div>

      {bounty.moderation_status !== 'approved' && (
        <div className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">This bounty is {bounty.moderation_status}. New claims are disabled.</div>
      )}
      {actionError && <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{actionError}</div>}

      <section className="card space-y-4 border-2 border-stone-900 shadow-[4px_4px_0_0_#0c251d]">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div><p className="text-xs font-bold uppercase text-gray-500">Reward</p><p className="text-2xl font-black text-red-600">{formatReward(bounty.reward_cents / 100)}</p></div>
          <div><p className="text-xs font-bold uppercase text-gray-500">Scope</p><p className="font-bold text-gray-900">{bounty.scope_type === 'region' ? `ZIP ${bounty.zip_code}` : bounty.scope_type === 'retailers' ? (bounty.retailer_names?.length ? bounty.retailer_names.join(', ') : 'Retailers') : bounty.store_name ?? (bounty.store_names?.length ? bounty.store_names.join(', ') : 'Stores')}</p><p className="text-xs text-gray-500">{bounty.scope_type === 'region' ? `${bounty.radius_miles} mile radius` : bounty.scope_type === 'retailers' ? `Within ${bounty.radius_miles} mi of ${bounty.zip_code}` : 'Exact store'}</p></div>
          <div><p className="text-xs font-bold uppercase text-gray-500">Deadline</p><p className="font-bold text-gray-900">{new Date(bounty.deadline).toLocaleDateString()}</p><p className="text-xs text-gray-500">{new Date(bounty.deadline).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</p></div>
          <div><p className="text-xs font-bold uppercase text-gray-500">Claims</p><p className="text-2xl font-black text-gray-900">{claims.length}</p></div>
        </div>
        {bounty.requirements && <div className="border-t border-gray-200 pt-4"><h2 className="text-sm font-bold text-gray-900">Requirements</h2><p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">{bounty.requirements}</p></div>}
        {(bounty.quantity_needed || bounty.variant_requirements || bounty.accept_equivalent) && (
          <div className="border-t border-gray-200 pt-4 space-y-2">
            <h2 className="text-sm font-bold text-gray-900">Details</h2>
            {bounty.quantity_needed && <p className="text-sm text-gray-700"><span className="font-medium">Quantity needed:</span> {bounty.quantity_needed}</p>}
            {bounty.variant_requirements && <p className="text-sm text-gray-700"><span className="font-medium">Variant requirements:</span> {bounty.variant_requirements}</p>}
            {bounty.accept_equivalent && <p className="text-sm text-gray-700"><span className="font-medium">Accept equivalent variants</span></p>}
          </div>
        )}
        <p className="border-t border-gray-200 pt-4 text-xs leading-relaxed text-gray-500">FindItViral records the promised reward but does not process payment or hold funds. Participants arrange fulfillment directly.</p>
      </section>

      {bounty.is_owner && (bounty.status === 'open' || bounty.status === 'claimed') && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary" onClick={() => void handleClose()} disabled={actionLoading === 'close'}>{actionLoading === 'close' ? 'Closing…' : 'Close Bounty'}</button>
          {bounty.status === 'open' && !editing && (
            <button type="button" className="btn-secondary" onClick={startEditing} disabled={actionLoading !== null}>Edit Bounty</button>
          )}
          <button type="button" className="btn bg-red-600 text-white hover:bg-red-700" onClick={() => void handleDelete()} disabled={actionLoading === 'delete'}>{actionLoading === 'delete' ? 'Deleting…' : 'Delete Bounty'}</button>
        </div>
      )}

      {editing && bounty.is_owner && bounty.status === 'open' && (
        <form className="card space-y-4 border-2 border-brand-300" onSubmit={(e) => { e.preventDefault(); void handleSaveEdit() }}>
          <h2 className="font-bold text-gray-900">Edit bounty</h2>
          <div>
            <label className="label" htmlFor="edit-reward">Reward ($)</label>
            <input id="edit-reward" className="input" type="text" inputMode="decimal" value={editRewardAmount} onChange={(e) => setEditRewardAmount(e.target.value)} required />
          </div>
          <div>
            <label className="label" htmlFor="edit-deadline">Deadline</label>
            <input id="edit-deadline" className="input" type="datetime-local" value={editDeadline} onChange={(e) => setEditDeadline(e.target.value)} required />
          </div>
          <div>
            <label className="label" htmlFor="edit-requirements">Requirements</label>
            <textarea id="edit-requirements" className="input min-h-20" maxLength={2000} value={editRequirements} onChange={(e) => setEditRequirements(e.target.value)} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="edit-quantity">Quantity needed (optional)</label>
              <input id="edit-quantity" className="input" type="number" min="1" max="999" step="1" value={editQuantityNeeded} onChange={(e) => setEditQuantityNeeded(e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="edit-variant">Variant requirements (optional)</label>
              <input id="edit-variant" className="input" maxLength={1000} value={editVariantRequirements} onChange={(e) => setEditVariantRequirements(e.target.value)} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm font-semibold text-gray-800">
            <input type="checkbox" checked={editAcceptEquivalent} onChange={(e) => setEditAcceptEquivalent(e.target.checked)} />
            Accept equivalent variants
          </label>
          <div className="flex gap-2">
            <button type="submit" className="btn-primary" disabled={actionLoading === 'edit'}>{actionLoading === 'edit' ? 'Saving…' : 'Save changes'}</button>
            <button type="button" className="btn-ghost" onClick={() => setEditing(false)} disabled={actionLoading === 'edit'}>Cancel</button>
          </div>
        </form>
      )}

      {canClaim && (
        <FormDraftStatus
          status={localDraft.status}
          error={localDraft.error}
          hasDraft={localDraft.hasDraft}
          hasConflict={Boolean(localDraft.conflict)}
          onDiscard={discardLocalClaim}
          onRestoreConflict={localDraft.restoreConflict}
          onKeepCurrent={localDraft.keepCurrent}
        />
      )}

      {canClaim && !showClaimForm && <button type="button" className="btn-primary w-full" onClick={() => setShowClaimForm(true)}>I Found It</button>}
      {!bounty.is_owner && bounty.caller_claim_status && <div className="rounded-lg bg-blue-50 px-4 py-3 text-sm text-blue-800">Your claim is {bounty.caller_claim_status}.</div>}

      {canClaim && showClaimForm && (
        <form onSubmit={handleClaimSubmit} className="card space-y-4 border-2 border-brand-300">
          <div><h2 className="font-bold text-gray-900">Submit your exact-store sighting</h2><p className="mt-1 text-xs text-gray-600">The bounty owner can review this claim. It does not become a public sighting.</p></div>
          <CatalogSearchSelect kind="store" label="Store" value={claimStore} onChange={setClaimStore} required disabled={Boolean(bounty.store_id)} />
          <div className="space-y-2">
            <label className="label">When did you see it?</label>
            <fieldset>
              <legend className="sr-only">When did you see it?</legend>
              <div className="grid grid-cols-3 gap-2">
                {whenSeenOptions.map((opt) => (
                  <label key={opt.value} className={`fiv-availability-btn ${whenSeen === opt.value ? 'border-brand-600 bg-brand-50 text-brand-700' : 'fiv-availability-btn-inactive'}`}>
                    <input className="sr-only" type="radio" name="claimWhenSeen" value={opt.value} checked={whenSeen === opt.value} onChange={() => setWhenSeen(opt.value)} />
                    {opt.label}
                  </label>
                ))}
              </div>
            </fieldset>
            {whenSeen === 'older' && (
              <div>
                <label className="label" htmlFor="claim-seen-date">Pick a date</label>
                <div className="relative">
                  <CalendarBlank size={18} weight="duotone" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    id="claim-seen-date"
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
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label className="label" htmlFor="claim-availability">Availability</label><select id="claim-availability" className="input" value={claimAvailability} onChange={(event) => setClaimAvailability(event.target.value as 'in_stock' | 'low_stock')}><option value="in_stock">In Stock</option><option value="low_stock">Low Stock</option></select></div>
            <div><label className="label" htmlFor="claim-quantity">Quantity (optional)</label><input id="claim-quantity" className="input" type="number" min="1" max="99" step="1" value={claimQuantity} onChange={(event) => setClaimQuantity(event.target.value)} /></div>
          </div>
          <div><label className="label" htmlFor="claim-notes">Notes (optional)</label><textarea id="claim-notes" className="input min-h-20" maxLength={2000} value={claimNotes} onChange={(event) => setClaimNotes(event.target.value)} /></div>
          {claimError && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{claimError}</div>}
          <div className="flex gap-2"><button type="submit" className="btn-primary" disabled={claimLoading}>{claimLoading ? 'Submitting…' : 'Submit Claim'}</button><button type="button" className="btn-ghost" onClick={() => setShowClaimForm(false)} disabled={claimLoading}>Cancel</button></div>
        </form>
      )}

      <section>
        <h2 className="mb-3 text-lg font-bold text-gray-900">Claims</h2>
        {claims.length > 0 ? (
          <div className="space-y-3">
            {claims.map((claim) => (
              <article key={claim.id} className="card">
                <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-bold text-gray-900">@{claim.finder_username}</h3><p className="mt-1 text-sm text-gray-600">{claim.store_name} · {claim.availability.toUpperCase()} availability{claim.quantity ? ` · about ${claim.quantity}` : ''}</p><p className="text-xs text-gray-500">Seen {new Date(claim.seen_at).toLocaleString()}</p></div><span className={`badge ${statusColor(claim.status)}`}>{statusLabel(claim.status)}</span></div>
                {claim.notes && <p className="mt-3 whitespace-pre-wrap text-sm text-gray-700">{claim.notes}</p>}
                {claim.contact_info && <p className="mt-3 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">Accepted finder contact: {claim.contact_info}</p>}
                {bounty.is_owner && claim.status === 'pending' && <div className="mt-4 flex gap-2 border-t border-gray-200 pt-3"><button type="button" className="btn-primary" disabled={actionLoading === claim.id} onClick={() => void handleClaimAction(claim.id, 'accepted')}>Accept</button><button type="button" className="btn-secondary" disabled={actionLoading === claim.id} onClick={() => void handleClaimAction(claim.id, 'rejected')}>Reject</button></div>}
              </article>
            ))}
          </div>
        ) : <EmptyState title="No claims yet" message="Claims will appear here for the bounty owner and each participating finder." />}
      </section>

      {!bounty.is_owner && bounty.owner_contact_info && <div className="rounded-lg bg-green-50 px-4 py-3 text-sm text-green-800">Accepted bounty owner contact: {bounty.owner_contact_info}</div>}
    </div>
  )
}
