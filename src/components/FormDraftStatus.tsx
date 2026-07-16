import type { FormDraftStatus as DraftStatus } from '../hooks/useFormDraft'

type Props = {
  status: DraftStatus
  error?: string | null
  hasDraft?: boolean
  hasConflict?: boolean
  onDiscard?: () => void
  onRestoreConflict?: () => void
  onKeepCurrent?: () => void
}

const statusText: Record<Exclude<DraftStatus, 'idle' | 'error'>, string> = {
  restored: 'Draft restored on this device.',
  saving: 'Saving draft…',
  saved: 'Draft saved on this device.',
}

export default function FormDraftStatus({
  status,
  error,
  hasDraft = false,
  hasConflict = false,
  onDiscard,
  onRestoreConflict,
  onKeepCurrent,
}: Props) {
  if (hasConflict) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900" role="status">
        <span className="font-semibold">This draft changed in another tab.</span>
        <button type="button" className="font-bold underline" onClick={onRestoreConflict}>Restore that version</button>
        <button type="button" className="font-bold underline" onClick={onKeepCurrent}>Keep this version</button>
      </div>
    )
  }

  if (status === 'idle' && !hasDraft) return null
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-stone-600" aria-live="polite">
      <span className={status === 'error' ? 'font-semibold text-red-700' : ''}>
        {status === 'error' ? (error || 'Draft could not be saved on this device.') : status === 'idle' ? 'Draft saved on this device.' : statusText[status]}
      </span>
      {hasDraft && onDiscard && (
        <button type="button" className="font-bold text-red-700 underline" onClick={onDiscard}>Discard device draft</button>
      )}
    </div>
  )
}
