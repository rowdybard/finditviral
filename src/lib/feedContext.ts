export type FeedReturnState = { path: string; anchor: string; scrollY: number }

export function feedReturnState(anchor: string): { feedReturn: FeedReturnState } {
  return { feedReturn: { path: `${window.location.pathname}${window.location.search}`, anchor, scrollY: window.scrollY } }
}

export function restoreFeedContext(state: unknown) {
  const candidate = state as { feedReturn?: FeedReturnState } | null
  const value = candidate?.feedReturn
  if (!value || typeof value.path !== 'string' || typeof value.anchor !== 'string') return null
  return value
}

export function focusFeedCard(anchor: string, scrollY = 0) {
  window.setTimeout(() => {
    window.scrollTo({ top: scrollY, behavior: 'auto' })
    const card = document.getElementById(anchor)
    if (!card) return
    card.classList.add('ring-4', 'ring-brand-400', 'ring-offset-2')
    card.focus({ preventScroll: true })
    window.setTimeout(() => card.classList.remove('ring-4', 'ring-brand-400', 'ring-offset-2'), 1800)
  }, 0)
}
