const explanations: Record<string, string> = {
  pending: 'Waiting for automated or owner review.',
  hidden: 'Not visible publicly.',
  expired: 'The expected-date window passed.',
  rejected: 'This post was not approved for public visibility.',
  claimed: 'A finder submitted evidence.',
  possibly_gone: 'Recent members reported it missing.',
}

export default function StatusExplanation({ status, isOwner }: { status: string | null | undefined; isOwner?: boolean }) {
  const text = status ? explanations[status] : null
  if (!isOwner || !text) return null
  return <details className="text-xs text-stone-600"><summary className="cursor-pointer font-semibold text-brand-700">What does this mean?</summary><p className="mt-1">{text}</p></details>
}
