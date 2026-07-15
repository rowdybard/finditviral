import { Crosshair, Eye, FileText, Trash } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import EmptyState from '../components/EmptyState'
import { discardContributionDraft, getMyContributionDrafts } from '../lib/launchApi'
import type { ContributionDraft, ContributionDraftState } from '../types/database'

const stateTheme: Record<ContributionDraftState, { rail: string; badge: string; label: string }> = {
  editing: { rail: 'bg-brand-500', badge: 'border-brand-500 text-brand-700', label: 'Editing' },
  waiting_for_approval: { rail: 'bg-amber-400', badge: 'border-amber-500 text-amber-800', label: 'Waiting' },
  ready: { rail: 'bg-green-600', badge: 'border-green-600 text-green-700', label: 'Ready' },
  needs_attention: { rail: 'bg-red-600', badge: 'border-red-500 text-red-700', label: 'Needs attention' },
}

function draftProductName(draft: ContributionDraft): string {
  const product = draft.payload.product
  if (product && typeof product === 'object' && 'label' in product && typeof product.label === 'string') {
    return product.label
  }
  return draft.draft_type === 'sighting' ? 'Sighting draft' : 'Bounty draft'
}

export default function Drafts() {
  const [drafts, setDrafts] = useState<ContributionDraft[]>([])
  const [loading, setLoading] = useState(true)
  const [discarding, setDiscarding] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    const result = await getMyContributionDrafts()
    setDrafts((result.data ?? []).sort((a, b) => b.updated_at.localeCompare(a.updated_at)))
    setError(result.error ? 'Your drafts could not be loaded.' : null)
    setLoading(false)
  }

  useEffect(() => { void load() }, [])

  async function discard(id: string) {
    setDiscarding(id)
    const result = await discardContributionDraft(id)
    setDiscarding(null)
    if (result.error) setError(result.error.message)
    else await load()
  }

  if (loading) return <div className="flex items-center justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-200 border-t-brand-500" /></div>

  return (
    <div className="space-y-4">
      <div>
        <Link to="/home" className="text-sm text-gray-500 hover:text-gray-700">← Home</Link>
        <h1 className="mt-2 text-2xl font-bold text-gray-900">Contribution Drafts</h1>
        <p className="mt-1 text-sm text-gray-500">Private to you · Suggestions never publish automatically. Return here after owner review, reopen the form, and confirm the final contribution.</p>
      </div>

      {error && <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {drafts.length > 0 ? (
        <div className="space-y-3">
          {drafts.map((draft) => {
            const theme = stateTheme[draft.state]
            const isSighting = draft.draft_type === 'sighting'
            return (
              <article
                key={draft.id}
                className="group mb-1.5 mr-1.5 grid min-w-0 grid-cols-[2.5rem_minmax(0,1fr)] overflow-hidden rounded-xl border-2 border-stone-950 bg-[#fffdf7] shadow-[6px_6px_0_0_#0c251d] transition-[transform,box-shadow] hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[3px_3px_0_0_#0c251d]"
              >
                <div className={`flex flex-col items-center justify-between py-3 text-white ${theme.rail}`}>
                  <span className="rotate-180 text-sm font-black tracking-[0.18em] [writing-mode:vertical-rl]">
                    {isSighting ? 'SIGHTING' : 'BOUNTY'}
                  </span>
                  {isSighting
                    ? <Eye aria-hidden="true" size={24} weight="bold" />
                    : <Crosshair aria-hidden="true" size={24} weight="bold" />}
                </div>

                <div className="min-w-0">
                  <div className="p-3 sm:p-4">
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex items-center rounded-md border-2 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wide ${theme.badge}`}>
                        {theme.label}
                      </span>
                    </div>
                    <h2 className="mt-2 truncate text-xl font-black leading-tight tracking-tight text-stone-950 sm:text-2xl">
                      {draftProductName(draft)}
                    </h2>
                    <p className="mt-1 text-xs text-stone-500">Updated {new Date(draft.updated_at).toLocaleString()}</p>
                  </div>

                  <footer className="flex min-h-12 items-center justify-between gap-2 border-t border-stone-300 px-3 sm:px-4">
                    <Link
                      to={isSighting ? '/sightings/new' : '/bounties/new'}
                      className="inline-flex min-h-11 items-center rounded-lg bg-brand-500 px-4 py-2 text-sm font-bold text-white transition hover:bg-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2"
                    >
                      Open draft
                    </Link>
                    <button
                      type="button"
                      className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-bold text-red-600 transition hover:bg-red-50"
                      aria-label="Discard draft"
                      disabled={discarding === draft.id}
                      onClick={() => void discard(draft.id)}
                    >
                      {discarding === draft.id ? 'Discarding…' : <><Trash size={16} weight="bold" aria-hidden="true" /> Discard</>}
                    </button>
                  </footer>
                </div>
              </article>
            )
          })}
        </div>
      ) : (
        <EmptyState
          icon={<FileText size={48} weight="duotone" />}
          title="No saved drafts"
          message="Start a sighting or bounty and save it when you need more time."
          action={
            <div className="flex gap-2">
              <Link to="/sightings/new" className="btn-primary">Report a sighting</Link>
              <Link to="/bounties/new" className="btn-secondary">Post a bounty</Link>
            </div>
          }
        />
      )}
    </div>
  )
}
