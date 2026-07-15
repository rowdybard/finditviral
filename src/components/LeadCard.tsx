import { Link } from 'react-router-dom'
import { Megaphone, MapPin, CalendarBlank } from '@phosphor-icons/react'
import type { Lead } from '../types/database'
import ShareButton from './ShareButton'

const sourceTypeLabels: Record<string, string> = {
  employee_tip: 'Employee tip',
  social_media: 'Social media',
  press_release: 'Press release',
  restock_schedule: 'Restock schedule',
  other: 'Other',
}

const scopeLabels: Record<string, string> = {
  region: 'Region',
  stores: 'Store',
}

export default function LeadCard({ lead }: { lead: Lead }) {
  const isConfirmed = lead.status === 'confirmed'
  const isExpired = lead.expires_at && new Date(lead.expires_at) <= new Date()

  const scopeText = lead.scope_type === 'stores'
    ? lead.store_name ?? 'Store'
    : `${lead.zip_code ?? ''} (${lead.radius_miles ?? 0}mi)`

  return (
    <article className="rounded-xl border-2 border-brand-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b-2 border-brand-100 bg-brand-50 px-4 py-2">
        <div className="flex items-center gap-2">
          <Megaphone aria-hidden="true" size={16} weight="bold" className="text-brand-600" />
          <span className="text-xs font-bold uppercase tracking-wide text-brand-700">
            {isConfirmed ? 'Confirmed Lead' : isExpired ? 'Expired Lead' : 'Unconfirmed Lead'}
          </span>
        </div>
        <span className="text-xs font-medium text-stone-500">
          {scopeLabels[lead.scope_type] ?? lead.scope_type}
        </span>
      </div>

      <div className="px-4 py-3">
        <Link to={`/leads/${lead.slug}`}>
          <h3 className="text-lg font-bold text-stone-900 hover:text-brand-600">
            {lead.headline}
          </h3>
        </Link>
        {lead.product_name && (
          <p className="mt-1 text-sm font-medium text-stone-600">{lead.product_name}</p>
        )}

        {lead.details && (
          <p className="mt-2 line-clamp-2 text-sm text-stone-600">{lead.details}</p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-stone-500">
          {lead.expected_date && (
            <span className="inline-flex items-center gap-1">
              <CalendarBlank aria-hidden="true" size={14} weight="bold" />
              {new Date(lead.expected_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </span>
          )}
          <span className="inline-flex items-center gap-1">
            <MapPin aria-hidden="true" size={14} weight="bold" />
            {scopeText}
          </span>
          <span>{sourceTypeLabels[lead.source_type] ?? lead.source_type}</span>
          {lead.username && <span>by {lead.username}</span>}
        </div>

        <div className="mt-3 flex items-center gap-4 text-sm">
          <span className="font-bold text-brand-600">{lead.credible_count ?? 0} credible</span>
          <span className="font-bold text-stone-600">{lead.doubtful_count ?? 0} doubtful</span>
          <span className={`font-bold ${(lead.net_score ?? 0) > 0 ? 'text-brand-600' : (lead.net_score ?? 0) < 0 ? 'text-stone-600' : 'text-stone-400'}`}>
            Net {(lead.net_score ?? 0) > 0 ? `+${lead.net_score}` : lead.net_score ?? 0}
          </span>
        </div>

        <div className="mt-3 flex items-center justify-between gap-2">
          {!isConfirmed && !isExpired && (
            <Link
              to={`/sightings/new?lead=${lead.slug}`}
              className="inline-flex min-h-11 items-center rounded-lg bg-brand-500 px-4 py-2 text-sm font-bold text-white transition hover:bg-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2"
            >
              Confirm with a sighting
            </Link>
          )}
          {isConfirmed && (
            <span className="inline-flex min-h-11 items-center rounded-lg bg-green-50 px-4 py-2 text-sm font-bold text-green-700">
              Confirmed
            </span>
          )}
          {isExpired && !isConfirmed && (
            <span className="inline-flex min-h-11 items-center rounded-lg bg-stone-100 px-4 py-2 text-sm font-bold text-stone-500">
              Expired
            </span>
          )}
          <ShareButton
            title={`Lead: ${lead.headline}`}
            text={`Restock lead: ${lead.headline}`}
            path={`/leads/${lead.slug}`}
            accent="yellow"
          />
        </div>
      </div>
    </article>
  )
}
