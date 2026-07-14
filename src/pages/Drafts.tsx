import { FileText, Trash } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { discardContributionDraft, getMyContributionDrafts } from '../lib/launchApi'
import type { ContributionDraft } from '../types/database'

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
      <header>
        <p className="text-xs font-black uppercase tracking-[0.14em] text-brand-700">Private to you</p>
        <h1 className="mt-1 text-3xl font-black text-stone-950">Contribution Drafts</h1>
        <p className="mt-2 text-sm text-gray-600">Suggestions never publish automatically. Return here after owner review, reopen the form, and confirm the final contribution.</p>
      </header>
      {error && <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      <div className="space-y-3">
        {drafts.map((draft) => (
          <article key={draft.id} className="card flex flex-wrap items-center justify-between gap-3 border-2 border-stone-900">
            <div className="flex min-w-0 items-start gap-3">
              <span className="rounded-lg bg-brand-100 p-2 text-brand-700"><FileText size={21} weight="bold" aria-hidden="true" /></span>
              <div className="min-w-0"><p className="text-xs font-bold uppercase text-brand-700">{draft.draft_type} · {draft.state.replace(/_/g, ' ')}</p><h2 className="truncate font-black text-stone-950">{draftProductName(draft)}</h2><p className="text-xs text-gray-500">Updated {new Date(draft.updated_at).toLocaleString()}</p></div>
            </div>
            <div className="flex gap-2">
              <Link to={draft.draft_type === 'sighting' ? '/sightings/new' : '/bounties/new'} className="btn-primary">Open draft</Link>
              <button type="button" className="btn-ghost px-3 text-red-700" aria-label="Discard draft" disabled={discarding === draft.id} onClick={() => void discard(draft.id)}><Trash size={18} weight="bold" aria-hidden="true" /></button>
            </div>
          </article>
        ))}
        {drafts.length === 0 && <div className="card text-center"><p className="font-semibold text-gray-900">No saved drafts</p><p className="mt-1 text-sm text-gray-600">Start a sighting or bounty and save it when you need more time.</p></div>}
      </div>
    </div>
  )
}
