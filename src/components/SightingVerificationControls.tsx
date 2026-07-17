import { CheckCircle, MagnifyingGlass } from '@phosphor-icons/react'
import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { trackEvent } from '../lib/analytics'
import { buildAuthPath, locationReturnPath } from '../lib/authReturn'
import { mapContributionError } from '../lib/errorMap'
import {
  removeSightingVerification,
  setSightingVerification,
} from '../lib/launchApi'
import { timeAgo } from '../lib/utils'
import type {
  Sighting,
  SightingCommunityState,
  SightingVerificationResponse,
  SightingVerificationSummary,
} from '../types/database'

const SUMMARY_EVENT = 'finditviral:sighting-verification-updated'
const summaryCache = new Map<string, SightingVerificationSummary>()

type SummaryEventDetail = {
  cacheKey: string
  summary: SightingVerificationSummary
}

const stateLabels: Record<SightingCommunityState, string> = {
  unverified: 'No independent reports yet',
  community_verified: 'Community verified',
  disputed: 'Availability disputed',
  not_found_reported: 'Not found reported',
  possibly_gone: 'Possibly gone',
}

function summaryFromSighting(sighting: Sighting): SightingVerificationSummary {
  return {
    sighting_id: sighting.id,
    verified_count: sighting.verified_count ?? 0,
    not_found_count: sighting.not_found_count ?? 0,
    last_verified_at: sighting.last_verified_at ?? null,
    last_not_found_at: sighting.last_not_found_at ?? null,
    viewer_response: sighting.viewer_response ?? null,
    community_state: sighting.community_state ?? 'unverified',
    is_owner: sighting.is_owner ?? false,
  }
}

function cacheKey(sightingId: string, userId?: string): string {
  return `${userId ?? 'anonymous'}:${sightingId}`
}

function dispatchSummary(key: string, summary: SightingVerificationSummary) {
  summaryCache.set(key, summary)
  window.dispatchEvent(new CustomEvent<SummaryEventDetail>(SUMMARY_EVENT, {
    detail: { cacheKey: key, summary },
  }))
}

export default function SightingVerificationControls({ sighting }: { sighting: Sighting }) {
  const { user } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const key = cacheKey(sighting.id, user?.id)
  const [summary, setSummary] = useState(() => summaryCache.get(key) ?? summaryFromSighting(sighting))
  const [pending, setPending] = useState<SightingVerificationResponse | 'remove' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<string | null>(null)

  useEffect(() => {
    const next = summaryCache.get(key) ?? summaryFromSighting(sighting)
    summaryCache.set(key, next)
    setSummary(next)
  }, [key, sighting])

  useEffect(() => {
    const update = (event: Event) => {
      const detail = (event as CustomEvent<SummaryEventDetail>).detail
      if (detail?.cacheKey === key) setSummary(detail.summary)
    }
    window.addEventListener(SUMMARY_EVENT, update)
    return () => window.removeEventListener(SUMMARY_EVENT, update)
  }, [key])

  const isOwner = summary.is_owner || Boolean(user && sighting.user_id === user.id)
  const eligible = sighting.moderation_status !== 'pending'
    && sighting.moderation_status !== 'rejected'
    && sighting.moderation_status !== 'hidden'
    && sighting.is_public !== false
    && sighting.freshness_status !== 'expired'
    && !sighting.bounty_id

  const latestText = useMemo(() => {
    if (summary.community_state === 'community_verified' && summary.last_verified_at) {
      return `Last verified ${timeAgo(summary.last_verified_at)}`
    }
    if (
      (summary.community_state === 'possibly_gone'
        || summary.community_state === 'disputed'
        || summary.community_state === 'not_found_reported')
      && summary.last_not_found_at
    ) {
      return `Last not found ${timeAgo(summary.last_not_found_at)}`
    }
    return null
  }, [summary])

  async function respond(response: SightingVerificationResponse) {
    if (!user) {
      const returnTo = locationReturnPath({
        pathname: location.pathname,
        search: location.search,
        hash: `#sighting-${sighting.id}`,
      })
      navigate(buildAuthPath(returnTo))
      return
    }
    if (!eligible || isOwner || pending) return

    const removing = summary.viewer_response === response
    setPending(removing ? 'remove' : response)
    setError(null)
    const result = removing
      ? await removeSightingVerification(sighting.id)
      : await setSightingVerification(sighting.id, response)
    setPending(null)

    if (result.error || !result.data) {
      const message = result.error
        ? mapContributionError(result.error)
        : 'Your response could not be saved. Please try again.'
      setError(message)
      console.error(JSON.stringify({
        event: 'sighting_verification_mutation_failed',
        code: result.error?.code ?? 'empty_response',
        action: removing ? 'remove' : 'set',
      }))
      return
    }

    setSummary(result.data)
    if (!removing && response === 'not_found') setConfirmation('Marked as not found. Thanks for keeping this current.')
    dispatchSummary(key, result.data)
    trackEvent('sighting_response', {
      action: removing ? 'remove' : summary.viewer_response ? 'change' : 'set',
      response,
    })
  }

  return (
    <section className="border-t border-stone-300 px-3 py-3 sm:px-4" aria-label="Community availability reports">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-black text-stone-900">{stateLabels[summary.community_state]}</p>
          <p className="mt-0.5 text-xs font-semibold text-stone-600">
            {summary.verified_count} verified · {summary.not_found_count} not found
            {latestText ? ` · ${latestText}` : ''}
          </p>
        </div>
        {isOwner && <p className="max-w-56 text-xs text-stone-500">Your original sighting is already the first report.</p>}
      </div>

      {eligible && !isOwner && (
        <div className="mt-3 grid grid-cols-2 gap-3">
          <button
            type="button"
            className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border-2 px-3 py-2 text-sm font-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 ${summary.viewer_response === 'verified' ? 'border-green-700 bg-green-100 text-green-900' : 'border-stone-400 bg-white text-stone-800 hover:bg-green-50'}`}
            aria-pressed={summary.viewer_response === 'verified'}
            disabled={pending !== null}
            onClick={() => void respond('verified')}
          >
            <CheckCircle size={20} weight={summary.viewer_response === 'verified' ? 'fill' : 'bold'} aria-hidden="true" />
            {pending === 'verified' || (pending === 'remove' && summary.viewer_response === 'verified') ? 'Saving…' : 'Verify'}
          </button>
          <button
            type="button"
            className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border-2 px-3 py-2 text-sm font-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 ${summary.viewer_response === 'not_found' ? 'border-amber-700 bg-amber-100 text-amber-950' : 'border-stone-400 bg-white text-stone-800 hover:bg-amber-50'}`}
            aria-pressed={summary.viewer_response === 'not_found'}
            disabled={pending !== null}
            onClick={() => void respond('not_found')}
          >
            <MagnifyingGlass size={20} weight={summary.viewer_response === 'not_found' ? 'fill' : 'bold'} aria-hidden="true" />
            {pending === 'not_found' || (pending === 'remove' && summary.viewer_response === 'not_found') ? 'Saving…' : 'No longer there'}
          </button>
        </div>
      )}

      {error && <p className="mt-2 text-sm font-semibold text-red-700" role="alert">{error}</p>}
      {confirmation && <p className="mt-2 text-sm font-semibold text-green-700" role="status">{confirmation}</p>}
      <span className="sr-only" aria-live="polite">
        {pending ? 'Saving community response' : error ?? ''}
      </span>
    </section>
  )
}
