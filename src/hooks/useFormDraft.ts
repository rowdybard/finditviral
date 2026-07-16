import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  formDraftKey,
  readFormDraft,
  removeFormDraft,
  writeFormDraft,
  type DraftParser,
  type FormDraftEnvelope,
  type FormDraftMetadata,
  type FormDraftScope,
} from '../lib/formDraftStore'

export type FormDraftStatus = 'idle' | 'restored' | 'saving' | 'saved' | 'error'

type RestoreReason = 'initial' | 'external'

type Options<T> = {
  scope: FormDraftScope | null
  value: T
  parse: DraftParser<T>
  isEmpty: (value: T) => boolean
  onRestore: (value: T, reason: RestoreReason) => void
  metadata?: FormDraftMetadata
  enabled?: boolean
  debounceMs?: number
}

export type UseFormDraftResult<T> = {
  status: FormDraftStatus
  error: string | null
  hasDraft: boolean
  conflict: FormDraftEnvelope<T> | null
  flush: () => boolean
  discard: () => boolean
  restoreConflict: () => void
  keepCurrent: () => void
}

export function useFormDraft<T>({
  scope,
  value,
  parse,
  isEmpty,
  onRestore,
  metadata,
  enabled = true,
  debounceMs = 500,
}: Options<T>): UseFormDraftResult<T> {
  const [status, setStatus] = useState<FormDraftStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [hasDraft, setHasDraft] = useState(false)
  const [conflict, setConflict] = useState<FormDraftEnvelope<T> | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const readyRef = useRef(false)
  const dirtyRef = useRef(false)
  const skipFirstValueRef = useRef(true)
  const restoredSerializedRef = useRef<string | null>(null)
  const latestValueRef = useRef(value)
  const parseRef = useRef(parse)
  const isEmptyRef = useRef(isEmpty)
  const onRestoreRef = useRef(onRestore)
  const metadataRef = useRef(metadata)
  const scopeRef = useRef(scope)
  const serializedValue = useMemo(() => JSON.stringify(value), [value])
  const serializedMetadata = useMemo(() => JSON.stringify(metadata ?? {}), [metadata])
  const scopeKey = scope ? formDraftKey(scope) : null

  latestValueRef.current = value
  parseRef.current = parse
  isEmptyRef.current = isEmpty
  onRestoreRef.current = onRestore
  metadataRef.current = metadata
  scopeRef.current = scope

  const cancelTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const persist = useCallback((): boolean => {
    cancelTimer()
    const currentScope = scopeRef.current
    if (!enabled || !currentScope) return false
    if (isEmptyRef.current(latestValueRef.current)) {
      // A pristine form should not create a draft, but clearing an existing
      // form is still user work. Only confirmed success or explicit discard
      // may remove an existing envelope.
      const existing = readFormDraft(currentScope, parseRef.current)
      if (!existing) {
        setHasDraft(false)
        setStatus('idle')
        setError(null)
        return true
      }
    }
    const result = writeFormDraft(currentScope, latestValueRef.current, {
      parsePayload: parseRef.current,
      metadata: metadataRef.current,
    })
    if (!result.ok) {
      setStatus('error')
      setError(result.error.message)
      return false
    }
    setHasDraft(true)
    setStatus('saved')
    setError(null)
    return true
  }, [cancelTimer, enabled])

  useEffect(() => {
    cancelTimer()
    readyRef.current = false
    dirtyRef.current = false
    skipFirstValueRef.current = true
    setConflict(null)
    setError(null)
    setStatus('idle')
    if (!enabled || !scope) {
      setHasDraft(false)
      return
    }
    const stored = readFormDraft(scope, parseRef.current)
    setHasDraft(Boolean(stored))
    if (stored) {
      restoredSerializedRef.current = JSON.stringify(stored.payload)
      onRestoreRef.current(stored.payload, 'initial')
      setStatus('restored')
    }
    readyRef.current = true
  }, [cancelTimer, enabled, scopeKey])

  useEffect(() => {
    if (!enabled || !scopeKey || !readyRef.current) return
    if (skipFirstValueRef.current) {
      skipFirstValueRef.current = false
      return
    }
    if (restoredSerializedRef.current === serializedValue) {
      restoredSerializedRef.current = null
      dirtyRef.current = false
      return
    }
    dirtyRef.current = true
    cancelTimer()
    setStatus('saving')
    timerRef.current = setTimeout(persist, debounceMs)
    return cancelTimer
  }, [cancelTimer, debounceMs, enabled, persist, scopeKey, serializedMetadata, serializedValue])

  useEffect(() => {
    if (!enabled || !scopeKey || typeof window === 'undefined') return
    const flushOnPageHide = () => { persist() }
    const flushWhenHidden = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') persist()
    }
    window.addEventListener('pagehide', flushOnPageHide)
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', flushWhenHidden)
    return () => {
      window.removeEventListener('pagehide', flushOnPageHide)
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', flushWhenHidden)
    }
  }, [enabled, persist, scopeKey])

  useEffect(() => {
    if (!enabled || !scope || typeof window === 'undefined') return
    const currentScope = scope
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== formDraftKey(currentScope)) return
      const external = readFormDraft(currentScope, parseRef.current)
      if (!external) {
        setHasDraft(false)
        return
      }
      setHasDraft(true)
      if (dirtyRef.current) {
        setConflict(external)
        return
      }
      restoredSerializedRef.current = JSON.stringify(external.payload)
      onRestoreRef.current(external.payload, 'external')
      setStatus('restored')
    }
    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [enabled, scopeKey])

  useEffect(() => cancelTimer, [cancelTimer])

  const discard = useCallback(() => {
    cancelTimer()
    const currentScope = scopeRef.current
    if (!currentScope) return false
    const removed = removeFormDraft(currentScope)
    if (removed) {
      dirtyRef.current = false
      setHasDraft(false)
      setConflict(null)
      setStatus('idle')
      setError(null)
    }
    return removed
  }, [cancelTimer])

  const restoreConflict = useCallback(() => {
    if (!conflict) return
    restoredSerializedRef.current = JSON.stringify(conflict.payload)
    onRestoreRef.current(conflict.payload, 'external')
    dirtyRef.current = false
    setConflict(null)
    setStatus('restored')
  }, [conflict])

  const keepCurrent = useCallback(() => {
    setConflict(null)
    dirtyRef.current = true
    setStatus('saving')
    persist()
  }, [persist])

  return { status, error, hasDraft, conflict, flush: persist, discard, restoreConflict, keepCurrent }
}
