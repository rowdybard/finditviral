import type { ContributionDraft } from '../types/database'

type Props = {
  draft: ContributionDraft
  onDiscard: () => void
  discarding?: boolean
}

const messages: Record<ContributionDraft['state'], string> = {
  editing: 'Your private draft has been restored. Review it before publishing.',
  waiting_for_approval: 'This draft is waiting for a product or location to be reviewed. It cannot publish yet.',
  ready: 'Your suggestion was approved. Review this restored draft and confirm when you are ready to publish.',
  needs_attention: 'A suggestion in this draft could not be approved. Choose another catalog match or submit an updated suggestion.',
}

export default function ContributionDraftNotice({ draft, onDiscard, discarding = false }: Props) {
  const blocked = draft.state === 'waiting_for_approval' || draft.state === 'needs_attention'
  return (
    <aside className={`rounded-xl border px-4 py-3 ${blocked ? 'border-amber-300 bg-amber-50' : 'border-blue-200 bg-blue-50'}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-gray-900">
            {blocked ? 'Saved draft is not ready yet' : 'Saved draft restored'}
          </p>
          <p className="mt-1 text-sm text-gray-700">{messages[draft.state]}</p>
        </div>
        <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={onDiscard} disabled={discarding}>
          {discarding ? 'Discarding…' : 'Discard draft'}
        </button>
      </div>
    </aside>
  )
}
