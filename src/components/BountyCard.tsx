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
import StatusExplanation from './StatusExplanation'
import { feedReturnState } from '../lib/feedContext'

function cardReward(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

export default function BountyCard({ bounty, onDelete }: { bounty: Bounty; onDelete?: (id: string) => void }) {
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
  const shareText = `Help find ${productName} near ${locationLabel} for a ${cardReward(rewardAmount)} reward.`

  return (
    <article
      id={`bounty-${bounty.id}`}
      className="group mb-1.5 mr-1.5 grid min-w-0 grid-cols-[2.5rem_minmax(0,1fr)] overflow-hidden rounded-xl border-2 border-stone-950 bg-[#fffdf7] shadow-[6px_6px_0_0_#1c1917] transition-[transform,box-shadow] hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[3px_3px_0_0_#1c1917]"
      data-testid="bounty-card"
    >
      <div className="flex flex-col items-center justify-between bg-brand-600 py-3 text-white">
        <span className="rotate-180 text-sm font-black tracking-[0.18em] [writing-mode:vertical-rl]">
          BOUNTY
        </span>
        <Crosshair aria-hidden="true" size={24} weight="bold" />
      </div>

      <div className="min-w-0">
        <Link
          to={`/bounties/${bounty.id}`}
          state={feedReturnState(`bounty-${bounty.id}`)}
          className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-600"
          aria-label={`View bounty for ${productName}`}
        >
          <div className="grid min-w-0 gap-4 p-3 sm:grid-cols-[7.25rem_minmax(0,1fr)] sm:p-4">
            <div className="rounded-lg border border-stone-300 bg-white px-3 py-3 text-center shadow-[2px_2px_0_0_#d6d3d1]">
              <p className="text-[11px] font-black uppercase tracking-[0.1em] text-stone-700">
                Reward
              </p>
              <p className="mt-1 text-4xl font-black leading-none tracking-tight text-brand-600 sm:text-5xl">
                {cardReward(rewardAmount)}
              </p>
              <span className="mt-3 inline-flex items-center rounded-md border-2 border-brand-500 px-3 py-0.5 text-xs font-black uppercase text-brand-600">
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
                  <span className="mt-2 inline-flex rounded border border-brand-400 bg-brand-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-stone-900">
                    Trend: {bounty.product.trend.name}
                  </span>
                </>
              )}
              <p className="mt-3 line-clamp-3 text-sm font-medium leading-snug text-stone-700">
                {bounty.requirements || bounty.notes || 'No additional requirements yet. Tap through for the full bounty.'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-stone-300 px-3 py-1.5 text-xs font-bold text-stone-600 sm:px-4">
            <span className="inline-flex items-center gap-1">
              <MapPin aria-hidden="true" size={14} weight="fill" className="text-brand-600" />
              <span className="truncate">{locationLabel}</span>
            </span>
            {bounty.distance_miles !== undefined && (
              <>
                <span className="text-stone-300" aria-hidden="true">·</span>
                <span className="inline-flex items-center gap-1">
                  <NavigationArrow aria-hidden="true" size={14} weight="fill" className="text-brand-600" />
                  {formatDistance(bounty.distance_miles)}
                </span>
              </>
            )}
            <span className="text-stone-300" aria-hidden="true">·</span>
            <span className="inline-flex items-center gap-1">
              <Clock aria-hidden="true" size={14} weight="bold" className="text-brand-600" />
              {timeAgo(bounty.created_at)}
            </span>
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
              path={`/bounties/${bounty.id}#bounty-${bounty.id}`}
              accent="brand"
            />
          </div>
        </footer>
        <div className="px-3 pb-2 sm:px-4"><StatusExplanation status={bounty.status} isOwner={bounty.is_owner} /></div>
      </div>
    </article>
  )
}
