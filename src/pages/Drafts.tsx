import { FileText, Notepad, Trash } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import EmptyState from '../components/EmptyState'
import { discardContributionDraft, getMyContributionDrafts } from '../lib/launchApi'
import type { ContributionDraft, ContributionDraftState } from '../types/database'

const stateBadge: Record<ContributionDraftState, { label: string; class: string }> = {
  editing: { label: 'Editing', class: 'bg-blue-100 text-blue-800' },
  waiting_for_approval: { label: 'Waiting for approval', class: 'bg-amber-100 text-amber-800' },
  ready: { label: 'Ready', class: 'bg-green-100 text-green-800' },
  needs_attention: { label: 'Needs attention', class: 'bg-red-100 text-red-800' },
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
    <div className="space-y-6">
      <div>
        <Link to="/home" className="text-sm text-gray-500 hover:text-gray-700">← Home</Link>
        <div className="mt-3 flex items-center gap-4">
          <div className="fiv-step-badge text-lg"><Notepad size={16} weight="bold" aria-hidden="true" /></div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Contribution Drafts</h1>
            <p className="mt-0.5 text-sm text-gray-500">Private to you · Suggestions never publish automatically. Return here after owner review, reopen the form, and confirm the final contribution.</p>
          </div>
          <div className="ml-auto hidden h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-100 to-brand-200 sm:flex">
            <Notepad size={32} weight="duotone" className="text-brand-600" />
          </div>
        </div>
      </div>

      {error && <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {drafts.length > 0 ? (
        <div className="space-y-4">
          {drafts.map((draft) => {
            const badge = stateBadge[draft.state]
            return (
              <article key={draft.id} className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border-2 border-stone-900 bg-[#fffdf7] p-5 shadow-[5px_5px_0_0_#0c251d]">
                <div className="flex min-w-0 items-start gap-4">
                  <span className="shrink-0 rounded-xl bg-brand-100 p-3 text-brand-700"><FileText size={24} weight="bold" aria-hidden="true" /></span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-black uppercase tracking-wide text-brand-700">{draft.draft_type}</span>
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wide ${badge.class}`}>{badge.label}</span>
                    </div>
                    <h2 className="mt-1 truncate text-lg font-black text-stone-950">{draftProductName(draft)}</h2>
                    <p className="mt-0.5 text-xs text-gray-500">Updated {new Date(draft.updated_at).toLocaleString()}</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Link to={draft.draft_type === 'sighting' ? '/sightings/new' : '/bounties/new'} className="btn-primary">Open draft</Link>
                  <button type="button" className="btn-ghost px-3 text-red-700" aria-label="Discard draft" disabled={discarding === draft.id} onClick={() => void discard(draft.id)}>
                    {discarding === draft.id ? 'Discarding…' : <Trash size={18} weight="bold" aria-hidden="true" />}
                  </button>
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
