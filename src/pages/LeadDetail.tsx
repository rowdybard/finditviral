import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Megaphone, MapPin, CalendarBlank, Link as LinkIcon, ArrowLeft, PencilSimple, Trash } from '@phosphor-icons/react'
import LeadVoteButtons from '../components/LeadVoteButtons'
import ShareButton from '../components/ShareButton'
import EmptyState from '../components/EmptyState'
import { deleteLead, getLeadDetail, updateLead } from '../lib/launchApi'
import { applyPageMetadata, getPageMetadataForLead } from '../lib/pageMetadata'
import { timeAgo } from '../lib/utils'
import type { LeadDetailView } from '../types/database'
import { useMascotToast } from '../contexts/MascotToastContext'

const sourceTypeLabels: Record<string, string> = {
  employee_tip: 'Employee tip',
  social_media: 'Social media',
  press_release: 'Press release',
  restock_schedule: 'Restock schedule',
  other: 'Other',
}

export default function LeadDetail() {
  const { slug } = useParams<{ slug: string }>()
  const navigate = useNavigate()
  const toast = useMascotToast()
  const [lead, setLead] = useState<LeadDetailView | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [form, setForm] = useState({ headline: '', details: '', expectedDate: '', sourceType: 'other' as LeadDetailView['source_type'], sourceUrl: '' })

  async function reload() {
    if (!slug) return
    const { data, error: rpcError } = await getLeadDetail(slug)
    if (rpcError) {
      setError('This lead could not be loaded.')
      setLead(null)
    } else {
      setLead(data)
      setError(null)
    }
  }

  useEffect(() => {
    async function load() {
      await reload()
      setLoading(false)
    }
    void load()
  }, [slug])

  useEffect(() => {
    if (lead) {
      applyPageMetadata(document, getPageMetadataForLead(window.location.pathname, lead))
    }
  }, [lead])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-200 border-t-brand-500" />
      </div>
    )
  }

  if (error || !lead) {
    return (
      <div className="mx-auto max-w-xl">
        <EmptyState
          title="Lead not found"
          message="This lead may have been removed or is no longer available."
          action={<Link to="/sightings" className="btn-primary">Back to sightings</Link>}
        />
      </div>
    )
  }

  const isConfirmed = lead.status === 'confirmed'
  const isExpired = lead.expires_at && new Date(lead.expires_at) <= new Date()
  const isPending = lead.status === 'pending'
  const isHidden = lead.status === 'hidden'
  const canVote = lead.status === 'active'
  const canEdit = lead.is_owner && (lead.status === 'active' || lead.status === 'pending')

  function openEdit() {
    setForm({ headline: lead!.headline, details: lead!.details ?? '', expectedDate: lead!.expected_date ?? '', sourceType: lead!.source_type, sourceUrl: lead!.source_url ?? '' })
    setActionError(null)
    setEditing(true)
    toast('Editing resets credibility votes', 'Heads up! Editing your lead will reset all credibility votes.')
  }

  async function saveEdit() {
    setSaving(true)
    setActionError(null)
    const { error: rpcError } = await updateLead({ leadId: lead!.id, headline: form.headline.trim(), details: form.details.trim() || null, expectedDate: form.expectedDate || null, sourceType: form.sourceType, sourceUrl: form.sourceUrl.trim() || null })
    if (rpcError) { setActionError(rpcError.message); setSaving(false); return }
    setEditing(false)
    setSaving(false)
    await reload()
  }

  async function removeLead() {
    if (!window.confirm('Delete this lead? This cannot be undone.')) return
    setSaving(true)
    const { error: rpcError } = await deleteLead(lead!.id)
    if (rpcError) { setActionError(rpcError.message); setSaving(false); return }
    navigate('/sightings', { replace: true })
  }

  const scopeText = lead.scope_type === 'stores'
    ? [lead.store_name, lead.store_city, lead.store_state].filter(Boolean).join(', ')
    : `${lead.zip_code} (${lead.radius_miles}mi radius)`

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <Link to="/sightings" className="inline-flex items-center gap-1 text-sm font-bold text-stone-600 hover:text-stone-900">
        <ArrowLeft aria-hidden="true" size={16} weight="bold" />
        Sightings
      </Link>

      <article className="overflow-hidden rounded-xl border-2 border-stone-950 bg-[#fffdf7] shadow-[6px_6px_0_0_#1c1917]">
        <div className="flex items-center justify-between border-b-2 border-stone-950 bg-brand-600 px-4 py-3 text-white">
          <div className="flex items-center gap-2">
            <Megaphone aria-hidden="true" size={20} weight="fill" />
            <span className="text-sm font-black uppercase tracking-wide">
              {isConfirmed ? 'Confirmed Lead' : isExpired ? 'Expired Lead' : isPending ? 'Pending Review' : isHidden ? 'Hidden' : 'Unconfirmed Lead'}
            </span>
          </div>
          <ShareButton
            title={`Lead: ${lead.headline}`}
            text={`Restock lead: ${lead.headline}`}
            path={`/leads/${lead.slug}`}
            accent="brand"
          />
        </div>

        <div className="px-4 py-4 space-y-4">
          <div>
            <Link to={`/products/${lead.product_slug}`}>
              <h2 className="text-sm font-bold text-brand-600 hover:text-brand-700">{lead.product_name}</h2>
            </Link>
            <h1 className="mt-1 text-xl font-black tracking-tight text-stone-950 sm:text-2xl">{lead.headline}</h1>
          </div>

          {canEdit && !editing && <div className="flex gap-2"><button type="button" className="btn-secondary text-sm" onClick={openEdit}><PencilSimple size={16} aria-hidden="true" /> Edit</button><button type="button" className="btn-ghost text-red-700" disabled={saving} onClick={() => void removeLead()}><Trash size={16} aria-hidden="true" /> Delete</button></div>}

          {editing && (
            <div className="space-y-3 border-2 border-stone-950 bg-stone-50 p-3 shadow-[3px_3px_0_0_#1c1917]">
              <label className="label">Headline<input className="input mt-1" value={form.headline} maxLength={140} onChange={(event) => setForm({ ...form, headline: event.target.value })} /></label>
              <label className="label">Details<textarea className="input mt-1 min-h-24" value={form.details} maxLength={2000} onChange={(event) => setForm({ ...form, details: event.target.value })} /></label>
              <div className="grid gap-3 sm:grid-cols-2"><label className="label">Expected date<input type="date" className="input mt-1" value={form.expectedDate} onChange={(event) => setForm({ ...form, expectedDate: event.target.value })} /></label><label className="label">Source type<select className="input mt-1" value={form.sourceType} onChange={(event) => setForm({ ...form, sourceType: event.target.value as LeadDetailView['source_type'] })}>{Object.entries(sourceTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
              <label className="label">Source URL<input type="url" className="input mt-1" value={form.sourceUrl} maxLength={2000} onChange={(event) => setForm({ ...form, sourceUrl: event.target.value })} /></label>
              {actionError && <p className="text-sm font-bold text-red-700">{actionError}</p>}
              <div className="flex gap-2"><button type="button" className="btn-primary text-sm" disabled={saving} onClick={() => void saveEdit()}>{saving ? 'Saving…' : 'Save changes'}</button><button type="button" className="btn-secondary text-sm" disabled={saving} onClick={() => setEditing(false)}>Cancel</button></div>
            </div>
          )}

          {lead.details && (
            <p className="text-sm font-medium text-stone-700">{lead.details}</p>
          )}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs font-bold text-stone-600">
            {lead.expected_date && (
              <span className="inline-flex items-center gap-1">
                <CalendarBlank aria-hidden="true" size={14} weight="fill" className="text-brand-700" />
                Expected {new Date(lead.expected_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </span>
            )}
            <span className="inline-flex items-center gap-1">
              <MapPin aria-hidden="true" size={14} weight="fill" className="text-brand-700" />
              {scopeText}
            </span>
            <span className="inline-flex items-center gap-1">
              <Megaphone aria-hidden="true" size={14} weight="fill" className="text-brand-700" />
              {sourceTypeLabels[lead.source_type] ?? lead.source_type}
            </span>
            {lead.source_url && (
              <a
                href={lead.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-brand-600 hover:text-brand-700"
              >
                <LinkIcon aria-hidden="true" size={14} weight="bold" />
                Source
              </a>
            )}
          </div>

          <div className="text-xs font-bold text-stone-500">
            Posted {timeAgo(lead.created_at)}{lead.username ? ` by @${lead.username}` : ''}
            {lead.edited_at ? ` · Edited ${timeAgo(lead.edited_at)}` : ''}
          </div>

          {isConfirmed && lead.confirmed_sighting_id && (
            <div className="rounded-lg border-2 border-green-700 bg-green-50 px-4 py-3 shadow-[3px_3px_0_0_#1c1917]">
              <h3 className="text-sm font-black text-green-800">Confirmed by sighting</h3>
              <p className="mt-1 text-sm font-medium text-green-700">
                {lead.confirmed_store_name && <>at {lead.confirmed_store_name}</>}
                {lead.confirmed_seen_at && <> on {new Date(lead.confirmed_seen_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</>}
              </p>
              <Link
                to={`/sightings?product=${lead.product_id}`}
                className="mt-2 inline-flex text-sm font-black text-green-700 hover:text-green-800"
              >
                View {lead.product_name} sightings →
              </Link>
            </div>
          )}

          {canVote && (
            <div className="border-t-2 border-stone-300 pt-4">
              <h3 className="mb-2 text-sm font-black text-stone-700">Rate this lead</h3>
              <LeadVoteButtons
                leadId={lead.id}
                callerVote={lead.caller_vote}
                credibleCount={lead.credible_count}
                doubtfulCount={lead.doubtful_count}
                netScore={lead.net_score}
                onVoteChanged={reload}
              />
            </div>
          )}

          {canVote && (
            <Link
              to={`/sightings/new?lead=${lead.slug}`}
              className="block w-full rounded-lg border-2 border-stone-950 bg-brand-600 px-4 py-3 text-center text-sm font-black text-white shadow-[4px_4px_0_0_#1c1917] transition hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0_0_#1c1917] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2"
            >
              Confirm with a sighting
            </Link>
          )}
        </div>
      </article>
    </div>
  )
}
