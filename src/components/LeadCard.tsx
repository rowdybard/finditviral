import {
  CalendarBlank,
  Megaphone,
  MapPin,
  NavigationArrow,
  ThumbsUp,
  ThumbsDown,
  UserCircle,
  Clock,
} from '@phosphor-icons/react'
import { Link } from 'react-router-dom'
import type { Lead } from '../types/database'
import { timeAgo } from '../lib/utils'
import { formatDistance } from '../lib/distance'
import { activeMarket } from '../lib/market'
import ShareButton from './ShareButton'
import { useViewerLocation } from '../contexts/ViewerLocationContext'

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
  const viewerLocation = useViewerLocation()
  const isConfirmed = lead.status === 'confirmed'
  const isExpired = lead.expires_at && new Date(lead.expires_at) <= new Date()

  const scopeText = lead.scope_type === 'stores'
    ? lead.store_name ?? 'Store'
    : `${lead.zip_code ?? ''} (${lead.radius_miles ?? 0}mi)`

  const statusLabel = isConfirmed ? 'CONFIRMED' : isExpired ? 'EXPIRED' : 'UNCONFIRMED'
  const statusColor = isConfirmed ? 'text-green-700' : isExpired ? 'text-stone-500' : 'text-blue-700'
  const productName = lead.product_name ?? 'Unknown product'
  const productPath = `/products/${lead.product_slug ?? ''}`
  const shareText = `Restock lead: ${lead.headline}`

  return (
    <article
      className="group mb-1.5 mr-1.5 grid min-w-0 grid-cols-[2.5rem_minmax(0,1fr)] overflow-hidden rounded-xl border-2 border-stone-950 bg-[#fffdf7] shadow-[6px_6px_0_0_#0c251d] transition-[transform,box-shadow] hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[3px_3px_0_0_#0c251d]"
      data-testid="lead-card"
    >
      <div className="flex flex-col items-center justify-between bg-blue-600 py-3 text-white">
        <span className="rotate-180 text-sm font-black tracking-[0.18em] [writing-mode:vertical-rl]">
          LEAD
        </span>
        <Megaphone aria-hidden="true" size={24} weight="bold" />
      </div>

      <div className="min-w-0">
        <Link
          to={`/leads/${lead.slug}`}
          className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600"
          aria-label={`View lead: ${lead.headline}`}
        >
          <div className="grid min-w-0 gap-4 p-3 sm:grid-cols-[8.5rem_minmax(0,1fr)] sm:p-4">
            <div className="rounded-lg border border-stone-300 bg-white px-3 py-3 text-center shadow-[2px_2px_0_0_#d6d3d1]">
              <p className="text-[11px] font-black uppercase tracking-[0.1em] text-stone-700">Status</p>
              <p className={`mt-2 font-black leading-none tracking-tight text-lg sm:text-xl ${statusColor}`}>
                {statusLabel}
              </p>
              <div className="mt-4 flex flex-col items-center gap-1.5" aria-hidden="true">
                <span className="inline-flex items-center gap-1 text-xs font-black text-green-700">
                  <ThumbsUp size={14} weight="fill" /> {lead.credible_count ?? 0}
                </span>
                <span className="inline-flex items-center gap-1 text-xs font-black text-stone-500">
                  <ThumbsDown size={14} weight="fill" /> {lead.doubtful_count ?? 0}
                </span>
                <span className={`mt-0.5 text-sm font-black ${(lead.net_score ?? 0) > 0 ? 'text-green-700' : (lead.net_score ?? 0) < 0 ? 'text-stone-600' : 'text-stone-400'}`}>
                  Net {(lead.net_score ?? 0) > 0 ? `+${lead.net_score}` : lead.net_score ?? 0}
                </span>
              </div>
            </div>

            <div className="min-w-0 py-0.5">
              <h3 className="text-xl font-black leading-tight tracking-tight text-stone-950 sm:text-2xl">
                {lead.headline}
              </h3>
              <Link
                to={productPath}
                className="mt-0.5 inline-block text-sm font-semibold text-stone-600 hover:text-blue-600"
              >
                {productName}
              </Link>
              {lead.details && (
                <p className="mt-2 line-clamp-2 text-sm font-medium leading-snug text-stone-700">
                  {lead.details}
                </p>
              )}
              <p className="mt-2 text-xs font-medium text-stone-500">
                {sourceTypeLabels[lead.source_type] ?? lead.source_type}
                {lead.source_url && (
                  <a href={lead.source_url} target="_blank" rel="noopener noreferrer" className="ml-1 text-blue-600 underline">source</a>
                )}
              </p>
            </div>
          </div>

          <dl className="grid border-t border-stone-300 text-sm font-bold text-stone-800 sm:grid-cols-3">
            <div className="min-w-0 px-3 py-2.5 sm:border-r sm:border-stone-300">
              <dt className="flex min-w-0 items-center gap-2 font-black text-blue-700">
                <MapPin className="shrink-0" aria-hidden="true" size={20} weight="fill" />
                <span className="truncate">{scopeText}</span>
              </dt>
              <dd className="truncate pl-7 text-[11px] text-stone-600">
                {scopeLabels[lead.scope_type] ?? lead.scope_type}
              </dd>
            </div>
            {lead.distance_miles != null && (
              <div className="border-t border-stone-300 px-3 py-2.5 sm:border-r sm:border-t-0">
                <dt className="flex items-center gap-2 font-black text-blue-700">
                  <NavigationArrow className="shrink-0" aria-hidden="true" size={20} weight="fill" />
                  {formatDistance(lead.distance_miles)}
                </dt>
                <dd className="pl-7 text-[10px] font-bold uppercase text-stone-600">
                  {viewerLocation.source === 'profile' ? 'Approx. from your ZIP' : `Approx. from ${activeMarket.name}`}
                </dd>
              </div>
            )}
            <div className={`border-t border-stone-300 px-3 py-2.5 ${lead.distance_miles === undefined ? 'sm:border-r sm:border-t-0' : 'sm:border-t-0'}`}>
              <dt className="flex items-center gap-2 font-black text-blue-700">
                {lead.expected_date ? (
                  <>
                    <CalendarBlank className="shrink-0" aria-hidden="true" size={20} weight="fill" />
                    {new Date(lead.expected_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </>
                ) : (
                  <>
                    <Clock className="shrink-0" aria-hidden="true" size={20} weight="bold" />
                    {timeAgo(lead.created_at)}
                  </>
                )}
              </dt>
              <dd className="pl-7 text-[10px] font-bold uppercase text-stone-600">
                {lead.expected_date ? 'Expected' : 'Posted'}
              </dd>
            </div>
          </dl>
        </Link>

        <footer className="flex min-h-12 items-center justify-between gap-2 border-t border-stone-300 px-3 sm:px-4">
          <div className="flex min-w-0 items-center gap-2 text-sm font-bold text-stone-900">
            {lead.username ? (
              <>
                <UserCircle aria-hidden="true" size={22} weight="fill" />
                <span className="truncate">@{lead.username}</span>
              </>
            ) : (
              <>
                <Megaphone aria-hidden="true" size={20} weight="bold" />
                <span>Anonymous tip</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            {!isConfirmed && !isExpired && (
              <Link
                to={`/sightings/new?lead=${lead.slug}`}
                className="inline-flex min-h-11 items-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
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
              text={shareText}
              path={`/leads/${lead.slug}`}
              accent="yellow"
            />
          </div>
        </footer>
      </div>
    </article>
  )
}
