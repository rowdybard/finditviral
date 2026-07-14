import { Check, ClockCounterClockwise, EyeSlash, LinkSimple, ShieldCheck, X } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import CatalogSearchSelect, { type CatalogSelection } from '../components/CatalogSearchSelect'
import {
  adminListInterestEvents,
  adminListMemberRestrictions,
  adminListModerationHistory,
  adminListProductSuggestions,
  adminListRecentContributions,
  adminListStoreSuggestions,
  adminResolveProductSuggestion,
  adminResolveStoreSuggestion,
  adminSetContributionModeration,
  adminSetMemberRestriction,
  isAppOwner,
} from '../lib/launchApi'
import type {
  AdminContribution,
  CatalogSuggestion,
  InterestEvent,
  MemberRestriction,
  ModerationEvent,
} from '../types/database'

type Tab = 'suggestions' | 'contributions' | 'interests' | 'members' | 'history'
type NewProductAvailability = 'available' | 'backorder' | 'preorder' | 'announced' | 'limited'

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
      setError(result.error.message)
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
          {kind === 'product' && suggestion.brand && <p className="mt-1 text-sm text-gray-600">Brand: {suggestion.brand}</p>}
          {kind === 'store' && (
            <>
              <p className="mt-1 text-sm text-gray-600">
                {[suggestion.address_line1, suggestion.city, suggestion.state, suggestion.zip_code].filter(Boolean).join(', ')}
              </p>
              {suggestion.phone && <p className="text-sm text-gray-600">{suggestion.phone}</p>}
            </>
          )}
          {suggestion.source_url && <a className="mt-1 block text-sm font-semibold text-brand-700" href={suggestion.source_url} target="_blank" rel="noreferrer">Review source ↗</a>}
          <p className="mt-2 text-xs text-gray-500">Submitted {new Date(suggestion.created_at).toLocaleString()}</p>
        </div>
        <span className="badge bg-amber-100 text-amber-800">{suggestion.status}</span>
      </div>

      {mode === 'duplicate' && (
        <div className="mt-4 space-y-3 rounded-lg border border-gray-200 bg-stone-50 p-3">
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
        <div className="mt-4 space-y-3 border-t border-gray-200 pt-4">
          {kind === 'product' && (
            <div className="grid gap-3 rounded-lg border border-gray-200 bg-stone-50 p-3 sm:grid-cols-2">
              <label className="text-sm font-semibold text-gray-800">
                Availability
                <select className="input mt-1" value={availabilityStatus} onChange={(event) => setAvailabilityStatus(event.target.value as NewProductAvailability)}>
                  <option value="available">Available now</option>
                  <option value="backorder">Backorder</option>
                  <option value="preorder">Preorder</option>
                  <option value="announced">Announced</option>
                  <option value="limited">Limited release</option>
                </select>
              </label>
              <label className="text-sm font-semibold text-gray-800">
                Release date
                <input className="input mt-1" type="date" value={releaseDate} onChange={(event) => setReleaseDate(event.target.value)} />
                <span className="mt-1 block text-xs font-normal text-gray-500">Leave blank only when the official date is unknown.</span>
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

export default function Admin() {
  const [owner, setOwner] = useState<boolean | null>(null)
  const [tab, setTab] = useState<Tab>('suggestions')
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

  async function loadAdminData() {
    setLoading(true)
    const results = await Promise.all([
      adminListProductSuggestions(),
      adminListStoreSuggestions(),
      adminListRecentContributions(),
      adminListInterestEvents(),
      adminListMemberRestrictions(),
      adminListModerationHistory(),
    ])
    setProducts(results[0].data ?? [])
    setStores(results[1].data ?? [])
    setContributions(results[2].data ?? [])
    setInterests(results[3].data ?? [])
    setRestrictions(results[4].data ?? [])
    setHistory(results[5].data ?? [])
    setError(results.some((result) => result.error) ? 'Some owner data could not be loaded.' : null)
    setLoading(false)
  }

  useEffect(() => {
    async function initialize() {
      const result = await isAppOwner()
      const isOwner = result.error ? false : result.data === true
      setOwner(isOwner)
      if (isOwner) await loadAdminData()
      else setLoading(false)
    }
    void initialize()
  }, [])

  async function moderate(contribution: AdminContribution, action: 'hide' | 'restore' | 'reject') {
    setActionId(contribution.contribution_id)
    const result = await adminSetContributionModeration({ kind: contribution.contribution_type, id: contribution.contribution_id, action, reason: null })
    setActionId(null)
    if (result.error) setError(result.error.message)
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
    if (result.error) setError(result.error.message)
    else {
      setMemberId('')
      setMemberReason('')
      setMemberExpiry('')
      await loadAdminData()
    }
  }

  async function clearRestriction(userId: string) {
    const result = await adminSetMemberRestriction({ userId, status: null, reason: null, expiresAt: null })
    if (result.error) setError(result.error.message)
    else await loadAdminData()
  }

  if (owner === false) return <Navigate to="/home" replace />
  if (owner === null || loading) return <div className="flex items-center justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-200 border-t-brand-500" /></div>

  const tabs: { id: Tab; label: string }[] = [
    { id: 'suggestions', label: `Suggestions (${products.filter((item) => item.status === 'pending').length + stores.filter((item) => item.status === 'pending').length})` },
    { id: 'contributions', label: 'Contributions' },
    { id: 'interests', label: 'Interest inbox' },
    { id: 'members', label: 'Members' },
    { id: 'history', label: 'History' },
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

      {error && <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <div className="flex gap-1 overflow-x-auto border-b border-gray-200 pb-2" role="tablist">
        {tabs.map((item) => <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold ${tab === item.id ? 'bg-brand-100 text-brand-800' : 'text-gray-600 hover:bg-gray-100'}`} onClick={() => setTab(item.id)}>{item.label}</button>)}
      </div>

      {tab === 'suggestions' && (
        <div className="space-y-4">
          {[...products.map((item) => ({ item, kind: 'product' as const })), ...stores.map((item) => ({ item, kind: 'store' as const }))]
            .filter(({ item }) => item.status === 'pending')
            .map(({ item, kind }) => <SuggestionReviewCard key={`${kind}-${item.id}`} kind={kind} suggestion={item} onResolved={loadAdminData} />)}
          {products.every((item) => item.status !== 'pending') && stores.every((item) => item.status !== 'pending') && <p className="card text-sm text-gray-600">No suggestions are waiting for review.</p>}
        </div>
      )}

      {tab === 'contributions' && (
        <div className="space-y-3">
          {contributions.map((item) => (
            <article key={`${item.contribution_type}-${item.contribution_id}`} className="card flex flex-wrap items-center justify-between gap-3">
              <div><p className="text-xs font-bold uppercase text-gray-500">{item.contribution_type} · {item.moderation_status}</p><h3 className="font-bold text-gray-900">{item.product_name}</h3><p className="text-sm text-gray-600">{item.username ? `@${item.username}` : 'Member'} · {new Date(item.occurred_at).toLocaleString()}</p></div>
              <div className="flex gap-2">
                {item.moderation_status === 'hidden'
                  ? <button type="button" className="btn-secondary" disabled={actionId === item.contribution_id} onClick={() => void moderate(item, 'restore')}><ClockCounterClockwise size={17} aria-hidden="true" /> Restore</button>
                  : <button type="button" className="btn-secondary" disabled={actionId === item.contribution_id} onClick={() => void moderate(item, 'hide')}><EyeSlash size={17} aria-hidden="true" /> Hide</button>}
              </div>
            </article>
          ))}
          {contributions.length === 0 && <p className="card text-sm text-gray-600">No contributions yet.</p>}
        </div>
      )}

      {tab === 'interests' && (
        <div className="space-y-3">
          {interests.map((item) => <article key={item.id} className="card"><div className="flex flex-wrap justify-between gap-2"><p className="text-xs font-bold uppercase text-brand-700">{item.source} · {item.digest_status ?? 'unassigned'}</p><time className="text-xs text-gray-500">{new Date(item.created_at).toLocaleString()}</time></div>{item.email && <p className="mt-2 text-sm font-semibold text-gray-900">{item.email}{item.username ? ` · @${item.username}` : ''}</p>}<p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">{item.reason ?? item.looking_for ?? 'No details supplied.'}</p></article>)}
          {interests.length === 0 && <p className="card text-sm text-gray-600">No interest submissions yet.</p>}
        </div>
      )}

      {tab === 'members' && (
        <div className="space-y-5">
          <form onSubmit={restrictMember} className="card space-y-3">
            <h2 className="font-bold text-gray-900">Restrict a member</h2>
            <input className="input" value={memberId} onChange={(event) => setMemberId(event.target.value)} placeholder="Member UUID" required />
            <div className="grid gap-3 sm:grid-cols-2"><select className="input" value={memberStatus} onChange={(event) => setMemberStatus(event.target.value as 'suspended' | 'disabled')}><option value="suspended">Suspended</option><option value="disabled">Disabled</option></select><input className="input" type="datetime-local" value={memberExpiry} onChange={(event) => setMemberExpiry(event.target.value)} aria-label="Optional restriction expiry" disabled={memberStatus === 'disabled'} /></div>
            <textarea className="input min-h-20" value={memberReason} onChange={(event) => setMemberReason(event.target.value)} maxLength={500} placeholder="Reason (private)" required />
            <button type="submit" className="btn-primary">Apply restriction</button>
          </form>
          {restrictions.map((item) => <article key={item.user_id} className="card flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-bold text-gray-900">{item.username ? `@${item.username}` : item.user_id}</h3><p className="text-sm text-gray-600">{item.status}{item.expires_at ? ` until ${new Date(item.expires_at).toLocaleString()}` : ''}</p>{item.reason && <p className="mt-1 text-sm text-gray-600">{item.reason}</p>}</div><button type="button" className="btn-secondary" onClick={() => void clearRestriction(item.user_id)}>Restore access</button></article>)}
        </div>
      )}

      {tab === 'history' && (
        <div className="space-y-3">
          {history.map((item) => <article key={item.id} className="card"><div className="flex flex-wrap justify-between gap-2"><p className="text-sm font-bold text-gray-900">{item.contribution_type}: {item.previous_status ?? 'new'} → {item.new_status}</p><time className="text-xs text-gray-500">{new Date(item.created_at).toLocaleString()}</time></div><p className="mt-1 break-all text-xs text-gray-500">{item.contribution_id}</p>{item.reason && <p className="mt-2 text-sm text-gray-700">{item.reason}</p>}</article>)}
          {history.length === 0 && <p className="card text-sm text-gray-600">No moderation history yet.</p>}
        </div>
      )}
    </div>
  )
}
