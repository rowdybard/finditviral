import { useState } from 'react'
import { ThumbsUp, ThumbsDown, Check } from '@phosphor-icons/react'
import { voteOnLead, removeLeadVote } from '../lib/launchApi'

type LeadVoteButtonsProps = {
  leadId: string
  callerVote: 'credible' | 'doubtful' | null
  credibleCount: number
  doubtfulCount: number
  netScore: number
  disabled?: boolean
  onVoteChanged?: () => void
}

export default function LeadVoteButtons({
  leadId,
  callerVote,
  credibleCount,
  doubtfulCount,
  netScore,
  disabled = false,
  onVoteChanged,
}: LeadVoteButtonsProps) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleVote(vote: 'credible' | 'doubtful') {
    if (submitting || disabled) return
    setSubmitting(true)
    setError(null)
    try {
      if (callerVote === vote) {
        const { error: rpcError } = await removeLeadVote(leadId)
        if (rpcError) throw rpcError
      } else {
        const { error: rpcError } = await voteOnLead(leadId, vote)
        if (rpcError) throw rpcError
      }
      onVoteChanged?.()
    } catch {
      setError('Could not update vote. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const netLabel = netScore > 0 ? `+${netScore}` : `${netScore}`

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => handleVote('credible')}
          disabled={submitting || disabled}
          aria-pressed={callerVote === 'credible'}
          className={`inline-flex min-h-11 items-center gap-2 rounded-lg border-2 px-3 py-2 text-sm font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
            callerVote === 'credible'
              ? 'border-brand-500 bg-brand-50 text-brand-700'
              : 'border-stone-200 text-stone-700 hover:border-brand-300 hover:bg-brand-50'
          }`}
        >
          {callerVote === 'credible' ? <Check aria-hidden="true" size={18} weight="bold" /> : <ThumbsUp aria-hidden="true" size={18} weight="bold" />}
          Credible
        </button>
        <button
          type="button"
          onClick={() => handleVote('doubtful')}
          disabled={submitting || disabled}
          aria-pressed={callerVote === 'doubtful'}
          className={`inline-flex min-h-11 items-center gap-2 rounded-lg border-2 px-3 py-2 text-sm font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
            callerVote === 'doubtful'
              ? 'border-stone-700 bg-stone-100 text-stone-800'
              : 'border-stone-200 text-stone-700 hover:border-stone-400 hover:bg-stone-100'
          }`}
        >
          {callerVote === 'doubtful' ? <Check aria-hidden="true" size={18} weight="bold" /> : <ThumbsDown aria-hidden="true" size={18} weight="bold" />}
          Doubtful
        </button>
      </div>

      <div className="flex items-center gap-4 text-sm">
        <span className="font-bold text-brand-600">{credibleCount} credible</span>
        <span className="font-bold text-stone-600">{doubtfulCount} doubtful</span>
        <span className={`font-bold ${netScore > 0 ? 'text-brand-600' : netScore < 0 ? 'text-stone-600' : 'text-stone-400'}`}>
          Net {netLabel}
        </span>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  )
}
