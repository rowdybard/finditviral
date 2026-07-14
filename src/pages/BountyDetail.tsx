import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import CatalogSearchSelect, { type CatalogSelection } from '../components/CatalogSearchSelect'
import EmptyState from '../components/EmptyState'
import { trackEvent } from '../lib/analytics'
import { mapContributionError } from '../lib/errorMap'
import { getBountyDetail, listMyBountyClaims, submitBountyClaim } from '../lib/launchApi'
import { supabase } from '../lib/supabase'
import type { BountyClaimView, BountyDetailView } from '../types/database'
import { formatReward, statusColor, statusLabel, timeAgo } from '../lib/utils'

function localDateTime(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

export default function BountyDetail() {
  const { id } = useParams<{ id: string }>()
  const [bounty, setBounty] = useState<BountyDetailView | null>(null)
  const [claims, setClaims] = useState<BountyClaimView[]>([])
  const [loading, setLoading] = useState(true)
  const [showClaimForm, setShowClaimForm] = useState(false)
  const [claimStore, setClaimStore] = useState<CatalogSelection | null>(null)
  const [claimSeenAt, setClaimSeenAt] = useState(() => localDateTime(new Date()))
  const [claimAvailability, setClaimAvailability] = useState<'in_stock' | 'low_stock' | 'sold_out' | 'unknown'>('in_stock')
  const [claimQuantity, setClaimQuantity] = useState('')
  const [claimNotes, setClaimNotes] = useState('')
  const [claimError, setClaimError] = useState<string | null>(null)
  const [claimLoading, setClaimLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

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
    setShowClaimForm(false)
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
        <button type="button" className="btn-secondary" onClick={() => void handleClose()} disabled={actionLoading === 'close'}>{actionLoading === 'close' ? 'Closing…' : 'Close Bounty'}</button>
      )}

      {canClaim && !showClaimForm && <button type="button" className="btn-primary w-full" onClick={() => setShowClaimForm(true)}>I Found It</button>}
      {!bounty.is_owner && bounty.caller_claim_status && <div className="rounded-lg bg-blue-50 px-4 py-3 text-sm text-blue-800">Your claim is {bounty.caller_claim_status}.</div>}

      {showClaimForm && (
        <form onSubmit={handleClaimSubmit} className="card space-y-4 border-2 border-brand-300">
          <div><h2 className="font-bold text-gray-900">Submit your exact-store sighting</h2><p className="mt-1 text-xs text-gray-600">The bounty owner can review this claim. It does not become a public sighting.</p></div>
          <CatalogSearchSelect kind="store" label="Store" value={claimStore} onChange={setClaimStore} required disabled={Boolean(bounty.store_id)} />
          <div><label className="label" htmlFor="claim-seen">When did you see it?</label><input id="claim-seen" className="input" type="datetime-local" min={localDateTime(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000))} max={localDateTime(new Date(Date.now() + 5 * 60 * 1000))} value={claimSeenAt} onChange={(event) => setClaimSeenAt(event.target.value)} required /></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label className="label" htmlFor="claim-availability">Availability</label><select id="claim-availability" className="input" value={claimAvailability} onChange={(event) => setClaimAvailability(event.target.value as 'in_stock' | 'low_stock' | 'sold_out' | 'unknown')}><option value="in_stock">In Stock</option><option value="low_stock">Low Stock</option><option value="sold_out">Sold Out</option><option value="unknown">Unknown</option></select></div>
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
