import {
  Clock,
  Crosshair,
  MapPin,
  NavigationArrow,
  Target,
  Trash,
  UserCircle,
} from '@phosphor-icons/react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { Bounty } from '../types/database'
import { timeAgo, statusLabel } from '../lib/utils'
import { formatDistance } from '../lib/distance'
import { activeMarket } from '../lib/market'
import ShareButton from './ShareButton'
import { useViewerLocation } from '../contexts/ViewerLocationContext'

function cardReward(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

export default function BountyCard({ bounty, onDelete }: { bounty: Bounty; onDelete?: (id: string) => void }) {
  const viewerLocation = useViewerLocation()
  const [deleting, setDeleting] = useState(false)
  const productName = bounty.product?.name ?? bounty.product_name ?? 'Unknown product'
  const rewardAmount = bounty.reward_cents !== undefined
    ? bounty.reward_cents / 100
    : bounty.reward_amount ?? 0
  const exactStore = bounty.store?.store_name ?? bounty.store_name
  const scopeType = bounty.scope_type ?? (exactStore ? 'stores' : 'region')
  const locationLabel = scopeType === 'retailers'
    ? (bounty.retailer_names?.length ? bounty.retailer_names.join(', ') : 'Selected retailers')
    : scopeType === 'stores' && !exactStore
    ? (bounty.store_names?.length ? bounty.store_names.join(', ') : 'Selected stores')
    : exactStore
    ? `${exactStore}${bounty.store?.city ? ` in ${bounty.store.city}` : ''}`
    : `ZIP ${bounty.zip_code ?? activeMarket.defaultZip}`
  const scopeDetail = scopeType === 'retailers'
    ? `Within ${bounty.radius_miles ?? 50} mi of ${bounty.zip_code ?? activeMarket.defaultZip}`
    : scopeType === 'stores' && !exactStore
    ? 'Multi-store'
    : exactStore
    ? 'Exact store'
    : `${bounty.radius_miles ?? 50} mi radius`
  const shareText = `Help find ${productName} near ${locationLabel} for a ${cardReward(rewardAmount)} reward.`

  return (
    <article
      className="group mb-1.5 mr-1.5 grid min-w-0 grid-cols-[2.5rem_minmax(0,1fr)] overflow-hidden rounded-xl border-2 border-stone-950 bg-[#fffdf7] shadow-[6px_6px_0_0_#0c251d] transition-[transform,box-shadow] hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[3px_3px_0_0_#0c251d]"
      data-testid="bounty-card"
    >
      <div className="flex flex-col items-center justify-between bg-red-600 py-3 text-white">
        <span className="rotate-180 text-sm font-black tracking-[0.18em] [writing-mode:vertical-rl]">
          BOUNTY
        </span>
        <Crosshair aria-hidden="true" size={24} weight="bold" />
      </div>

      <div className="min-w-0">
        <Link
          to={`/bounties/${bounty.id}`}
          className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-red-600"
          aria-label={`View bounty for ${productName}`}
        >
          <div className="grid min-w-0 gap-4 p-3 sm:grid-cols-[7.25rem_minmax(0,1fr)_8.5rem] sm:p-4">
            <div className="rounded-lg border border-stone-300 bg-white px-3 py-3 text-center shadow-[2px_2px_0_0_#d6d3d1]">
              <p className="text-[11px] font-black uppercase tracking-[0.1em] text-stone-700">
                Reward
              </p>
              <p className="mt-1 text-4xl font-black leading-none tracking-tight text-red-600 sm:text-5xl">
                {cardReward(rewardAmount)}
              </p>
              <span className="mt-3 inline-flex items-center rounded-md border-2 border-red-500 px-3 py-0.5 text-xs font-black uppercase text-red-600">
                {statusLabel(bounty.status)}
              </span>
            </div>

            <div className="min-w-0 py-0.5">
              <h3 className="text-xl font-black leading-tight tracking-tight text-stone-950 sm:text-2xl">
                {productName}
              </h3>
              {bounty.product?.trend && (
                <>
                  <p className="mt-0.5 text-sm font-semibold text-stone-600">
                    {bounty.product.trend.name}
                  </p>
                  <span className="mt-2 inline-flex rounded border border-amber-400 bg-amber-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-stone-900">
                    Trend: {bounty.product.trend.name}
                  </span>
                </>
              )}
              <p className="mt-3 line-clamp-3 text-sm font-medium leading-snug text-stone-700">
                {bounty.requirements || bounty.notes || 'No additional requirements yet. Tap through for the full bounty.'}
              </p>
            </div>

            <dl className="grid grid-cols-3 gap-2 border-t border-stone-200 pt-3 text-stone-800 sm:grid-cols-1 sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0">
              <div className="min-w-0">
                <dt className="sr-only">ZIP and radius</dt>
                <dd className="flex items-start gap-2">
                  <MapPin className="mt-0.5 shrink-0 text-red-600" aria-hidden="true" size={20} weight="fill" />
                  <span>
                    <strong className="block text-sm font-black text-red-600">{exactStore ?? bounty.zip_code ?? 'Local'}</strong>
                    <span className="block text-[10px] font-bold uppercase leading-tight text-stone-600">
                      {scopeDetail}
                    </span>
                  </span>
                </dd>
              </div>
              {bounty.distance_miles !== undefined && (
                <div className="min-w-0">
                  <dt className="sr-only">Distance</dt>
                  <dd className="flex items-start gap-2">
                    <NavigationArrow className="mt-0.5 shrink-0 text-red-600" aria-hidden="true" size={20} weight="fill" />
                    <span>
                      <strong className="block text-sm font-black text-red-600">
                        {formatDistance(bounty.distance_miles)}
                      </strong>
                      <span className="block text-[10px] font-bold uppercase text-stone-600">
                        {viewerLocation.source === 'profile' ? 'Approx. from your ZIP' : 'Approx. from Greater Lansing'}
                      </span>
                    </span>
                  </dd>
                </div>
              )}
              <div className="min-w-0">
                <dt className="sr-only">Posted</dt>
                <dd className="flex items-start gap-2">
                  <Clock className="mt-0.5 shrink-0 text-red-600" aria-hidden="true" size={20} weight="bold" />
                  <span>
                    <strong className="block text-sm font-black text-red-600">{timeAgo(bounty.created_at)}</strong>
                    <span className="block text-[10px] font-bold uppercase text-stone-600">Posted</span>
                  </span>
                </dd>
              </div>
            </dl>
          </div>
        </Link>

        <footer className="flex min-h-12 items-center justify-between gap-2 border-t border-stone-300 px-3 sm:px-4">
          <div className="flex min-w-0 items-center gap-2 text-sm font-bold text-stone-900">
            {bounty.profile ? (
              <>
                <UserCircle aria-hidden="true" size={22} weight="fill" />
                <span className="truncate">@{bounty.profile.username}</span>
              </>
            ) : (
              <>
                <Target aria-hidden="true" size={20} weight="bold" />
                <span>Local hunter</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            {onDelete && (
              <button
                type="button"
                className="btn-ghost text-red-700"
                title="Delete bounty"
                disabled={deleting}
                onClick={() => {
                  if (window.confirm('Delete this bounty? This cannot be undone.')) {
                    setDeleting(true)
                    onDelete(bounty.id)
                  }
                }}
              >
                <Trash size={17} aria-hidden="true" />
              </button>
            )}
            <ShareButton
              title={`Bounty: ${productName}`}
              text={shareText}
              path={`/bounties/${bounty.id}`}
              accent="red"
            />
          </div>
        </footer>
      </div>
    </article>
  )
}
