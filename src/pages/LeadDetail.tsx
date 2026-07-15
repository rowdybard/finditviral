import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Megaphone, MapPin, CalendarBlank, Link as LinkIcon, ArrowLeft } from '@phosphor-icons/react'
import LeadVoteButtons from '../components/LeadVoteButtons'
import ShareButton from '../components/ShareButton'
import EmptyState from '../components/EmptyState'
import { getLeadDetail } from '../lib/launchApi'
import { applyPageMetadata, getPageMetadataForLead } from '../lib/pageMetadata'
import { timeAgo } from '../lib/utils'
import type { LeadDetailView } from '../types/database'

const sourceTypeLabels: Record<string, string> = {
  employee_tip: 'Employee tip',
  social_media: 'Social media',
  press_release: 'Press release',
  restock_schedule: 'Restock schedule',
  other: 'Other',
}

export default function LeadDetail() {
  const { slug } = useParams<{ slug: string }>()
  const [lead, setLead] = useState<LeadDetailView | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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

  const scopeText = lead.scope_type === 'stores'
    ? [lead.store_name, lead.store_city, lead.store_state].filter(Boolean).join(', ')
    : `${lead.zip_code} (${lead.radius_miles}mi radius)`

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <Link to="/sightings" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
        <ArrowLeft aria-hidden="true" size={14} weight="bold" />
        Sightings
      </Link>

      <article className="rounded-xl border-2 border-brand-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b-2 border-brand-100 bg-brand-50 px-4 py-3">
          <div className="flex items-center gap-2">
            <Megaphone aria-hidden="true" size={18} weight="bold" className="text-brand-600" />
            <span className="text-sm font-bold uppercase tracking-wide text-brand-700">
              {isConfirmed ? 'Confirmed Lead' : isExpired ? 'Expired Lead' : isPending ? 'Pending Review' : isHidden ? 'Hidden' : 'Unconfirmed Lead'}
            </span>
          </div>
          <ShareButton
            title={`Lead: ${lead.headline}`}
            text={`Restock lead: ${lead.headline}`}
            path={`/leads/${lead.slug}`}
            accent="yellow"
          />
        </div>

        <div className="px-4 py-4 space-y-4">
          <div>
            <Link to={`/products/${lead.product_slug}`}>
              <h2 className="text-sm font-bold text-brand-600 hover:text-brand-700">{lead.product_name}</h2>
            </Link>
            <h1 className="mt-1 text-xl font-bold text-stone-900">{lead.headline}</h1>
          </div>

          {lead.details && (
            <p className="text-sm text-stone-600">{lead.details}</p>
          )}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-stone-500">
            {lead.expected_date && (
              <span className="inline-flex items-center gap-1">
                <CalendarBlank aria-hidden="true" size={16} weight="bold" />
                Expected {new Date(lead.expected_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </span>
            )}
            <span className="inline-flex items-center gap-1">
              <MapPin aria-hidden="true" size={16} weight="bold" />
              {scopeText}
            </span>
            <span>{sourceTypeLabels[lead.source_type] ?? lead.source_type}</span>
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

          <div className="text-xs text-stone-400">
            Posted {timeAgo(lead.created_at)}{lead.username ? ` by ${lead.username}` : ''}
          </div>

          {isConfirmed && lead.confirmed_sighting_id && (
            <div className="rounded-lg border-2 border-green-300 bg-green-50 px-4 py-3">
              <h3 className="text-sm font-bold text-green-800">Confirmed by sighting</h3>
              <p className="mt-1 text-sm text-green-700">
                {lead.confirmed_store_name && <>at {lead.confirmed_store_name}</>}
                {lead.confirmed_seen_at && <> on {new Date(lead.confirmed_seen_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</>}
              </p>
              <Link
                to={`/sightings?product=${lead.product_id}`}
                className="mt-2 inline-flex text-sm font-bold text-green-700 hover:text-green-800"
              >
                View {lead.product_name} sightings →
              </Link>
            </div>
          )}

          {canVote && (
            <div className="border-t border-stone-100 pt-4">
              <h3 className="mb-2 text-sm font-bold text-stone-700">Rate this lead</h3>
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
              className="block w-full rounded-lg bg-brand-500 px-4 py-3 text-center text-sm font-bold text-white transition hover:bg-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2"
            >
              Confirm with a sighting
            </Link>
          )}
        </div>
      </article>
    </div>
  )
}
