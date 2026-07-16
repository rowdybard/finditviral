import { FileText, Notepad, Trash } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import EmptyState from '../components/EmptyState'
import { deleteSightingPhotoPaths } from '../components/PhotoUpload'
import { discardContributionDraft, getMyContributionDrafts } from '../lib/launchApi'
import { useMascotToast } from '../contexts/MascotToastContext'
import { useAuth } from '../contexts/AuthContext'
import { listUserFormDrafts, removeFormDraft, type FormDraftEnvelope } from '../lib/formDraftStore'
import { trackEvent } from '../lib/analytics'
import type { ContributionDraft, ContributionDraftState } from '../types/database'

const stateBadge: Record<ContributionDraftState, { label: string; class: string }> = {
  editing: { label: 'Editing', class: 'bg-blue-100 text-blue-800' },
  waiting_for_approval: { label: 'Waiting for approval', class: 'bg-amber-100 text-amber-800' },
  ready: { label: 'Ready', class: 'bg-green-100 text-green-800' },
  needs_attention: { label: 'Needs attention', class: 'bg-red-100 text-red-800' },
}

const suggestionBadge: Record<'waiting_for_approval' | 'ready' | 'needs_attention', { label: string; class: string }> = {
  waiting_for_approval: { label: 'Suggestion pending', class: 'bg-amber-100 text-amber-800' },
  ready: { label: 'Suggestion approved', class: 'bg-green-100 text-green-800' },
  needs_attention: { label: 'Suggestion rejected', class: 'bg-red-100 text-red-800' },
}

const suggestionDescription: Record<'waiting_for_approval' | 'ready' | 'needs_attention', string> = {
  waiting_for_approval: 'is waiting for review.',
  ready: 'was approved. Open the draft to finish publishing.',
  needs_attention: 'could not be approved. Try searching the catalog again.',
}

function draftProductName(draft: ContributionDraft): string {
  const product = draft.payload.product
  if (product && typeof product === 'object' && 'label' in product && typeof product.label === 'string') {
    return product.label
  }
  return draft.draft_type === 'sighting' ? 'Sighting draft' : 'Bounty draft'
}

function draftSuggestionName(draft: ContributionDraft): string | null {
  const name = draft.payload.productSuggestionName ?? draft.payload.storeSuggestionName
  if (typeof name === 'string' && name.trim()) return name.trim()
  return null
}

function hasSuggestion(draft: ContributionDraft): boolean {
  return (draft.product_suggestion_id !== null || draft.store_suggestion_id !== null)
    && draft.state in suggestionBadge
}

const localDraftTypeLabel: Record<FormDraftEnvelope<unknown>['formType'], string> = {
  sighting: 'Sighting',
  bounty: 'Bounty',
  lead: 'Restock lead',
  'bounty-claim': 'Bounty claim',
  onboarding: 'Account setup',
}

function localDraftDestination(draft: FormDraftEnvelope<unknown>): string {
  if (draft.metadata.destination) return draft.metadata.destination
  if (draft.formType === 'sighting') return '/sightings/new'
  if (draft.formType === 'bounty') return '/bounties/new'
  if (draft.formType === 'lead') return '/leads/new'
  if (draft.formType === 'bounty-claim') return `/bounties/${encodeURIComponent(draft.entityId)}`
  return '/onboarding'
}

export default function Drafts() {
  const { user } = useAuth()
  const [drafts, setDrafts] = useState<ContributionDraft[]>([])
  const [localDrafts, setLocalDrafts] = useState<FormDraftEnvelope<unknown>[]>([])
  const [loading, setLoading] = useState(true)
  const [discarding, setDiscarding] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const toast = useMascotToast()

  function loadLocalDrafts() {
    if (!user) {
      setLocalDrafts([])
      return
    }
    setLocalDrafts(listUserFormDrafts(user.id).filter((draft) => draft.formType !== 'onboarding'))
  }

  async function load() {
    const result = await getMyContributionDrafts()
    setDrafts((result.data ?? []).sort((a, b) => b.updated_at.localeCompare(a.updated_at)))
    setError(result.error ? 'Your drafts could not be loaded.' : null)
    setLoading(false)
  }

  useEffect(() => {
    void load()
    loadLocalDrafts()
    const refresh = () => loadLocalDrafts()
    window.addEventListener('storage', refresh)
    return () => window.removeEventListener('storage', refresh)
  }, [user?.id])

  async function discard(id: string) {
    setDiscarding(id)
    const result = await discardContributionDraft(id)
    setDiscarding(null)
    if (result.error) setError(result.error.message)
    else {
      const linkedLocal = localDrafts.find((draft) => draft.metadata.serverDraftId === id)
      if (linkedLocal) {
        if (linkedLocal.formType === 'sighting' && linkedLocal.metadata.mediaPaths?.length) {
          await deleteSightingPhotoPaths(linkedLocal.metadata.mediaPaths)
        }
        removeFormDraft({ userId: linkedLocal.userId, formType: linkedLocal.formType, entityId: linkedLocal.entityId })
        loadLocalDrafts()
      }
      toast('Draft discarded', 'Scout cleaned that up.')
      await load()
    }
  }

  async function discardLocal(draft: FormDraftEnvelope<unknown>) {
    setDiscarding(`local:${draft.formType}:${draft.entityId}`)
    if (draft.formType === 'sighting' && draft.metadata.mediaPaths?.length) {
      await deleteSightingPhotoPaths(draft.metadata.mediaPaths)
    }
    removeFormDraft({ userId: draft.userId, formType: draft.formType, entityId: draft.entityId })
    setDiscarding(null)
    loadLocalDrafts()
    trackEvent('draft_discarded', { form: draft.formType, source: 'my_drafts' })
    toast('Draft discarded', 'Scout cleaned that up.')
  }

  const serverDraftIds = new Set(drafts.map((draft) => draft.id))
  const unlinkedLocalDrafts = localDrafts.filter((draft) => !draft.metadata.serverDraftId || !serverDraftIds.has(draft.metadata.serverDraftId))
  const localDraftByServerId = new Map(
    localDrafts
      .filter((draft) => draft.metadata.serverDraftId && serverDraftIds.has(draft.metadata.serverDraftId))
      .map((draft) => [draft.metadata.serverDraftId as string, draft]),
  )

  if (loading) return <div className="flex items-center justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-200 border-t-brand-500" /></div>

  return (
    <div className="space-y-6">
      <div>
        <Link to="/home" className="text-sm text-gray-500 hover:text-gray-700">← Home</Link>
        <div className="mt-3 flex items-center gap-4">
          <div className="fiv-step-badge text-lg"><Notepad size={16} weight="bold" aria-hidden="true" /></div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">My Drafts</h1>
            <p className="mt-0.5 text-sm text-gray-500">Private to you · Suggestions never publish automatically. Return here after owner review, reopen the form, and confirm the final contribution.</p>
          </div>
          <div className="ml-auto hidden h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-100 to-brand-200 sm:flex">
            <Notepad size={32} weight="duotone" className="text-brand-600" />
          </div>
        </div>
      </div>

      {error && <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {drafts.length > 0 || unlinkedLocalDrafts.length > 0 ? (
        <div className="space-y-4">
          {unlinkedLocalDrafts.map((draft) => {
            const discardKey = `local:${draft.formType}:${draft.entityId}`
            return (
              <article key={discardKey} className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border-2 border-stone-900 bg-white p-5 shadow-[5px_5px_0_0_#0c251d]">
                <div className="flex min-w-0 items-start gap-4">
                  <span className="shrink-0 rounded-xl bg-blue-100 p-3 text-blue-700"><Notepad size={24} weight="bold" aria-hidden="true" /></span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-black uppercase tracking-wide text-brand-700">{localDraftTypeLabel[draft.formType]}</span>
                      <span className="inline-flex items-center rounded-full bg-blue-100 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wide text-blue-800">On this device</span>
                    </div>
                    <h2 className="mt-1 truncate text-lg font-black text-stone-950">{draft.metadata.title || `${localDraftTypeLabel[draft.formType]} draft`}</h2>
                    <p className="mt-0.5 text-xs text-gray-500">Updated {new Date(draft.updatedAt).toLocaleString()}</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Link to={localDraftDestination(draft)} className="btn-primary">Resume</Link>
                  <button type="button" className="btn-ghost px-3 text-red-700" aria-label={`Discard ${localDraftTypeLabel[draft.formType]} device draft`} disabled={discarding === discardKey} onClick={() => void discardLocal(draft)}>
                    {discarding === discardKey ? 'Discarding…' : <Trash size={18} weight="bold" aria-hidden="true" />}
                  </button>
                </div>
              </article>
            )
          })}
          {drafts.map((draft) => {
            const linkedLocalDraft = localDraftByServerId.get(draft.id)
            const badge = stateBadge[draft.state]
            const showSuggestion = hasSuggestion(draft)
            const sBadge = showSuggestion ? suggestionBadge[draft.state as 'waiting_for_approval' | 'ready' | 'needs_attention'] : null
            const sName = showSuggestion ? draftSuggestionName(draft) : null
            const sDesc = showSuggestion ? suggestionDescription[draft.state as 'waiting_for_approval' | 'ready' | 'needs_attention'] : null
            return (
              <article key={draft.id} className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border-2 border-stone-900 bg-[#fffdf7] p-5 shadow-[5px_5px_0_0_#0c251d]">
                <div className="flex min-w-0 items-start gap-4">
                  <span className="shrink-0 rounded-xl bg-brand-100 p-3 text-brand-700"><FileText size={24} weight="bold" aria-hidden="true" /></span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-black uppercase tracking-wide text-brand-700">{draft.draft_type}</span>
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wide ${badge.class}`}>{badge.label}</span>
                      {sBadge && (
                        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wide ${sBadge.class}`}>{sBadge.label}</span>
                      )}
                    </div>
                    <h2 className="mt-1 truncate text-lg font-black text-stone-950">{linkedLocalDraft?.metadata.title || draftProductName(draft)}</h2>
                    {showSuggestion && sName && sDesc && (
                      <p className="mt-0.5 text-xs text-gray-600">
                        Your suggestion <strong className="text-gray-800">{sName}</strong> {sDesc}
                      </p>
                    )}
                    <p className="mt-0.5 text-xs text-gray-500">Updated {new Date(Math.max(new Date(draft.updated_at).getTime(), linkedLocalDraft?.updatedAt ?? 0)).toLocaleString()}</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Link to={`${draft.draft_type === 'sighting' ? '/sightings/new' : '/bounties/new'}?draft=${encodeURIComponent(draft.id)}`} className="btn-primary">Open draft</Link>
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
