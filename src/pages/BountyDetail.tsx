import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import type { Bounty, BountyClaim, ProfileContact } from '../types/database'
import { formatReward, timeAgo, statusColor, statusLabel } from '../lib/utils'
import { trackEvent } from '../lib/analytics'
import EmptyState from '../components/EmptyState'
import { activeMarket } from '../lib/market'

export default function BountyDetail() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const [bounty, setBounty] = useState<Bounty | null>(null)
  const [claims, setClaims] = useState<BountyClaim[]>([])
  const [claimContacts, setClaimContacts] = useState<Record<string, string | null>>({})
  const [ownerContact, setOwnerContact] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [showClaimForm, setShowClaimForm] = useState(false)
  const [claimStore, setClaimStore] = useState('')
  const [claimCity, setClaimCity] = useState('')
  const [claimState, setClaimState] = useState('')
  const [claimZip, setClaimZip] = useState('')
  const [claimStock, setClaimStock] = useState('in_stock')
  const [claimError, setClaimError] = useState<string | null>(null)
  const [claimLoading, setClaimLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const isOwner = user?.id === bounty?.user_id

  async function loadContacts(nextBounty: Bounty | null, nextClaims: BountyClaim[]) {
    setClaimContacts({})
    setOwnerContact(null)
    if (!user || !nextBounty) return

    const acceptedClaims = nextClaims.filter((claim) => claim.status === 'accepted')
    if (user.id === nextBounty.user_id) {
      const finderIds = Array.from(new Set(acceptedClaims.map((claim) => claim.finder_id)))
      if (finderIds.length === 0) return

      const { data } = await supabase
        .from('profile_contacts')
        .select('user_id, contact_info')
        .in('user_id', finderIds)

      const contacts = (data as Pick<ProfileContact, 'user_id' | 'contact_info'>[] | null) ?? []
      setClaimContacts(
        Object.fromEntries(contacts.map((contact) => [contact.user_id, contact.contact_info])),
      )
      return
    }

    const acceptedForCurrentUser = acceptedClaims.some((claim) => claim.finder_id === user.id)
    if (!acceptedForCurrentUser) return

    const { data } = await supabase
      .from('profile_contacts')
      .select('user_id, contact_info')
      .eq('user_id', nextBounty.user_id)
      .single()
    setOwnerContact((data as Pick<ProfileContact, 'user_id' | 'contact_info'> | null)?.contact_info ?? null)
  }

  async function reloadBountyAndClaims() {
    if (!id) return
    const { data: bountyData } = await supabase
      .from('bounties')
      .select('*, product(*), profile:profiles(id, username, karma, is_pro, created_at)')
      .eq('id', id)
      .single()
    const nextBounty = bountyData as Bounty | null
    setBounty(nextBounty)

    if (!nextBounty) {
      setClaims([])
      setClaimContacts({})
      setOwnerContact(null)
      return
    }

    const { data: claimsData } = await supabase
      .from('bounty_claims')
      .select('*, sighting:sightings(*), finder:profiles(id, username, karma, is_pro, created_at)')
      .eq('bounty_id', id)
      .order('created_at', { ascending: false })
    const nextClaims = claimsData as BountyClaim[] ?? []
    setClaims(nextClaims)
    await loadContacts(nextBounty, nextClaims)
  }

  useEffect(() => {
    if (!id) return
    async function load() {
      await reloadBountyAndClaims()
      setLoading(false)
    }
    load()
  }, [id, user?.id])

  async function handleClaimSubmit(e: React.FormEvent) {
    e.preventDefault()
    setClaimError(null)
    if (!user || !bounty) return
    if (!claimStore.trim()) {
      setClaimError('Store name is required.')
      return
    }

    setClaimLoading(true)
    const { error: claimError } = await supabase.rpc('submit_bounty_claim', {
      p_bounty_id: bounty.id,
      p_store_name: claimStore.trim(),
      p_city: claimCity.trim() || null,
      p_state: claimState.trim() || null,
      p_zip_code: claimZip.trim() || null,
      p_stock_level: claimStock,
    })

    setClaimLoading(false)
    if (claimError) {
      setClaimError(claimError.message)
      return
    }

    setShowClaimForm(false)
    setClaimStore('')
    setClaimCity('')
    setClaimState('')
    setClaimZip('')
    await reloadBountyAndClaims()
  }

  async function handleClaimAction(claimId: string, action: 'accepted' | 'rejected') {
    setActionError(null)
    setActionLoading(claimId)
    const { error } = await supabase.rpc(
      action === 'accepted' ? 'accept_bounty_claim' : 'reject_bounty_claim',
      { p_claim_id: claimId },
    )

    setActionLoading(null)
    if (error) {
      setActionError(error.message)
      return
    }
    if (action === 'accepted') trackEvent('accept_claim')
    await reloadBountyAndClaims()
  }

  async function handleClose() {
    if (!id) return
    setActionError(null)
    setActionLoading('close')
    const { error } = await supabase.rpc('close_bounty', { p_bounty_id: id })
    setActionLoading(null)
    if (error) {
      setActionError(error.message)
      return
    }
    await reloadBountyAndClaims()
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-200 border-t-brand-500" />
      </div>
    )
  }

  if (!bounty) {
    return (
      <EmptyState
        title="Bounty not found"
        message="This bounty may have been removed."
        action={<Link to="/bounties" className="btn-primary">View bounties</Link>}
      />
    )
  }

  const acceptedClaim = claims.find((c) => c.status === 'accepted')

  return (
    <div className="space-y-6">
      <div>
        <Link to="/bounties" className="text-sm text-gray-500 hover:text-gray-700">← Bounties</Link>
        <div className="mt-2 flex items-center gap-2">
          <span className="badge bg-brand-100 text-brand-800">
            {formatReward(bounty.reward_amount)}
          </span>
          <span className={`badge ${statusColor(bounty.status)}`}>
            {statusLabel(bounty.status)}
          </span>
        </div>
        <h1 className="mt-2 text-2xl font-bold text-gray-900">
          {bounty.product?.name ?? 'Unknown product'}
        </h1>
        <div className="mt-2 flex items-center gap-3 text-sm text-gray-500">
          <span>ZIP {bounty.zip_code}</span>
          <span>·</span>
          <span>{bounty.radius_miles}mi radius</span>
          <span>·</span>
          <span>{timeAgo(bounty.created_at)}</span>
        </div>
        {bounty.notes && (
          <p className="mt-3 rounded-lg bg-gray-50 p-3 text-sm text-gray-700">
            {bounty.notes}
          </p>
        )}
        <p className="mt-3 text-xs text-gray-400">
          {activeMarket.trustNotice}
        </p>
        <Link
          to={`/profile/${bounty.profile?.username ?? ''}`}
          className="mt-3 inline-block text-sm font-medium text-brand-600 hover:text-brand-700"
        >
          Posted by {bounty.profile?.username ?? 'Unknown'}
        </Link>
      </div>

      {isOwner && bounty.status !== 'closed' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">Claims ({claims.length})</h2>
            {bounty.status === 'open' && (
              <button onClick={handleClose} className="btn-ghost text-sm" disabled={actionLoading === 'close'}>
                {actionLoading === 'close' ? 'Closing...' : 'Close bounty'}
              </button>
            )}
          </div>
          {actionError && (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {actionError}
            </div>
          )}
          {claims.length > 0 ? (
            <div className="space-y-3">
              {claims.map((claim) => (
                <div key={claim.id} className="card">
                  <div className="flex items-center justify-between">
                    <Link
                      to={`/profile/${claim.finder?.username ?? ''}`}
                      className="font-medium text-brand-600 hover:text-brand-700"
                    >
                      {claim.finder?.username ?? 'Unknown'}
                    </Link>
                    <span className={`badge ${statusColor(claim.status)}`}>
                      {statusLabel(claim.status)}
                    </span>
                  </div>
                  {claim.sighting && (
                    <div className="mt-2 text-sm text-gray-600">
                      <p>{claim.sighting.store_name}</p>
                      {claim.sighting.city && claim.sighting.state && (
                        <p className="text-gray-500">{claim.sighting.city}, {claim.sighting.state}</p>
                      )}
                      {claim.sighting.zip_code && (
                        <p className="text-gray-500">ZIP {claim.sighting.zip_code}</p>
                      )}
                      <p className="mt-1 text-gray-500">
                        Stock: {claim.sighting.stock_level.replace('_', ' ')}
                      </p>
                    </div>
                  )}
                  {claim.status === 'pending' && (
                    <div className="mt-3 flex gap-2">
                      <button
                        onClick={() => handleClaimAction(claim.id, 'accepted')}
                        className="btn-primary text-sm"
                        disabled={actionLoading === claim.id}
                      >
                        {actionLoading === claim.id ? '...' : 'Accept'}
                      </button>
                      <button
                        onClick={() => handleClaimAction(claim.id, 'rejected')}
                        className="btn-secondary text-sm"
                        disabled={actionLoading === claim.id}
                      >
                        {actionLoading === claim.id ? '...' : 'Reject'}
                      </button>
                    </div>
                  )}
                  {claim.status === 'accepted' && claimContacts[claim.finder_id] && (
                    <div className="mt-3 rounded-lg bg-green-50 p-3 text-sm">
                      <p className="font-medium text-green-800">Contact info:</p>
                      <p className="mt-1 text-green-700">{claimContacts[claim.finder_id]}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500">No claims yet.</p>
          )}
        </div>
      )}

      {!isOwner && user && bounty.status === 'open' && !showClaimForm && (
        <button
          onClick={() => setShowClaimForm(true)}
          className="btn-primary w-full"
        >
          Claim this bounty
        </button>
      )}

      {!isOwner && user && bounty.status !== 'open' && (
        <p className="card text-sm text-gray-500">
          This bounty is {bounty.status}. <Link to="/bounties" className="text-brand-600 hover:text-brand-700 font-medium">Browse other bounties →</Link>
        </p>
      )}

      {!isOwner && user && bounty.status === 'open' && showClaimForm && (
        <form onSubmit={handleClaimSubmit} className="card space-y-4">
          <h2 className="text-lg font-semibold text-gray-900">Claim this bounty</h2>
          <p className="text-sm text-gray-500">
            Report where you found this product. The bounty poster will see your sighting and your contact info if they accept.
          </p>
          <p className="text-xs text-gray-400">
            Payment is arranged directly between you and the bounty poster.
          </p>
          <div>
            <label className="label" htmlFor="claimStore">Store name *</label>
            <input
              id="claimStore"
              className="input"
              value={claimStore}
              onChange={(e) => setClaimStore(e.target.value)}
              placeholder={activeMarket.storePlaceholder}
              maxLength={120}
              required
            />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="label" htmlFor="claimCity">City</label>
              <input
                id="claimCity"
                className="input"
                value={claimCity}
                onChange={(e) => setClaimCity(e.target.value)}
                maxLength={100}
              />
            </div>
            <div className="w-20">
              <label className="label" htmlFor="claimState">State</label>
              <input
                id="claimState"
                className="input"
                value={claimState}
                onChange={(e) => setClaimState(e.target.value.toUpperCase().slice(0, 2))}
                maxLength={2}
              />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="claimZip">ZIP code</label>
            <input
              id="claimZip"
              className="input"
              type="text"
              inputMode="numeric"
              maxLength={5}
              value={claimZip}
              onChange={(e) => setClaimZip(e.target.value.replace(/\D/g, ''))}
            />
          </div>
          <div>
            <label className="label" htmlFor="claimStock">Stock level</label>
            <select
              id="claimStock"
              className="input"
              value={claimStock}
              onChange={(e) => setClaimStock(e.target.value)}
            >
              <option value="in_stock">In Stock</option>
              <option value="low">Low Stock</option>
              <option value="none">Out of Stock</option>
            </select>
          </div>
          {claimError && (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {claimError}
            </div>
          )}
          <div className="flex gap-2">
            <button type="submit" className="btn-primary flex-1" disabled={claimLoading}>
              {claimLoading ? 'Submitting...' : 'Submit claim'}
            </button>
            <button type="button" onClick={() => setShowClaimForm(false)} className="btn-secondary">
              Cancel
            </button>
          </div>
        </form>
      )}

      {!user && bounty.status === 'open' && (
        <div className="card text-center">
          <p className="text-sm text-gray-600">Sign in to claim this bounty.</p>
          <Link to="/auth" className="btn-primary mt-3">Sign In</Link>
        </div>
      )}

      {acceptedClaim && !isOwner && user?.id === acceptedClaim.finder_id && (
        <div className="card">
          <h2 className="font-semibold text-green-800">Your claim was accepted!</h2>
          <p className="mt-1 text-sm text-gray-600">
            Contact the bounty poster to arrange payment:
          </p>
          <div className="mt-3 rounded-lg bg-green-50 p-3 text-sm">
            <p className="font-medium text-green-800">{bounty.profile?.username}'s contact info:</p>
            <p className="mt-1 text-green-700">{ownerContact || 'No contact info provided'}</p>
          </div>
        </div>
      )}
    </div>
  )
}
