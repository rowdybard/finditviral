import { ArrowsCounterClockwise, Check, Lightning, Plus, X } from '@phosphor-icons/react'
import { useCallback, useEffect, useState } from 'react'
import {
  cancelResearchRun,
  createSource,
  generatePatch,
  getEngineHealth,
  getEngineSettings,
  listCandidates,
  listChanges,
  listResearchRuns,
  listSources,
  recomputeCandidates,
  reviewCandidate,
  researchRunErrorMessage,
  startResearchRun,
  updateEngineSettings,
  type CandidateState,
  type EngineCandidate,
  type EngineChange,
  type EngineHealth,
  type EnginePatch,
  type EngineResearchRun,
  type EngineSettings,
  type EngineSource,
  type ReviewStatus,
  type SourceCreateInput,
  type SourceKind,
} from '../../lib/trendEngine'

type SubTab = 'sources' | 'research' | 'candidates' | 'patches' | 'changes' | 'settings'

const STATE_COLORS: Record<CandidateState, string> = {
  candidate: 'bg-stone-100 text-stone-700',
  emerging: 'bg-brand-100 text-brand-700',
  trending: 'bg-green-100 text-green-700',
  cooling: 'bg-amber-100 text-amber-700',
  archived: 'bg-stone-200 text-stone-600',
}

const REVIEW_COLORS: Record<ReviewStatus, string> = {
  pending: 'bg-amber-100 text-amber-800',
  approved: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-700',
}

function Spinner() {
  return <div className="h-6 w-6 animate-spin rounded-full border-4 border-brand-200 border-t-brand-500" />
}

function modeColor(mode: string): string {
  if (mode === 'autopilot') return 'bg-green-100 text-green-800 border-green-300'
  if (mode === 'review') return 'bg-brand-100 text-brand-800 border-brand-300'
  return 'bg-stone-100 text-stone-700 border-stone-300'
}

export default function TrendEnginePanel() {
  const [subTab, setSubTab] = useState<SubTab>('sources')
  const [health, setHealth] = useState<EngineHealth | null>(null)
  const [healthError, setHealthError] = useState<string | null>(null)
  const [healthLoading, setHealthLoading] = useState(true)

  const refreshHealth = useCallback(async () => {
    setHealthLoading(true)
    setHealthError(null)
    try {
      const h = await getEngineHealth()
      setHealth(h)
    } catch (err) {
      setHealthError(err instanceof Error ? err.message : 'Failed to reach engine')
    } finally {
      setHealthLoading(false)
    }
  }, [])

  useEffect(() => { void refreshHealth() }, [refreshHealth])

  const subTabs: { id: SubTab; label: string }[] = [
    { id: 'sources', label: 'Sources' },
    { id: 'research', label: 'Research' },
    { id: 'candidates', label: 'Candidates' },
    { id: 'patches', label: 'Patches' },
    { id: 'changes', label: 'Changes' },
    { id: 'settings', label: 'Settings' },
  ]

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-xl font-black text-stone-950">Trend Engine</h2>
        <p className="mt-1 text-sm text-stone-600">Autonomous catalog researcher — discovers, scores, and prepares viral product patches.</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {healthLoading ? (
          <Spinner />
        ) : health ? (
          <div className="flex items-center gap-3">
            <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-black uppercase tracking-wide ${modeColor(health.mode)}`}>
              {health.mode}
            </span>
            <span className="text-sm font-semibold text-green-700">● {health.status}</span>
            <button type="button" className="btn-ghost text-xs" onClick={() => void refreshHealth()}>Refresh</button>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <span className="rounded-lg bg-red-50 px-3 py-1 text-sm font-semibold text-red-700">{healthError ?? 'Engine unreachable'}</span>
            <button type="button" className="btn-ghost text-xs" onClick={() => void refreshHealth()}>Retry</button>
          </div>
        )}
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-stone-200 pb-2">
        {subTabs.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`min-h-11 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 ${subTab === item.id ? 'bg-brand-100 text-brand-800' : 'text-stone-600 hover:bg-stone-100'}`}
            onClick={() => setSubTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {subTab === 'sources' && <SourcesTab />}
      {subTab === 'research' && <ResearchTab onCandidates={() => setSubTab('candidates')} />}
      {subTab === 'candidates' && <CandidatesTab />}
      {subTab === 'patches' && <PatchesTab />}
      {subTab === 'changes' && <ChangesTab />}
      {subTab === 'settings' && <SettingsTab />}
    </section>
  )
}

function ResearchTab({ onCandidates }: { onCandidates: () => void }) {
  const [runs, setRuns] = useState<EngineResearchRun[]>([])
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState(false)
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (background = false) => {
    if (!background) setLoading(true)
    try { setRuns(await listResearchRuns()) } catch (err) { setError(err instanceof Error ? err.message : 'Failed to load research runs') } finally { if (!background) setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (!runs.some((run) => run.status === 'queued' || run.status === 'running')) return
    const timer = window.setInterval(() => { void load(true) }, 3000)
    return () => window.clearInterval(timer)
  }, [load, runs])

  async function start() {
    setStarting(true); setError(null)
    try { await startResearchRun(); await load() } catch (err) { setError(err instanceof Error ? err.message : 'Research could not be started') } finally { setStarting(false) }
  }

  async function cancel(run: EngineResearchRun) {
    if (!window.confirm(`Force-cancel this ${run.status} research run? Any OpenAI request already in flight will finish, but no further candidates will be ingested.`)) return
    setCancellingId(run.id); setError(null)
    try { await cancelResearchRun(run.id); await load() } catch (err) { setError(err instanceof Error ? err.message : 'Research run could not be cancelled') } finally { setCancellingId(null) }
  }

  const activeRuns = runs.filter((run) => run.status === 'queued' || run.status === 'running')
  const completedRuns = runs.filter((run) => run.status === 'succeeded' || run.status === 'failed')

  return <div className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><h3 className="text-lg font-bold text-stone-900">OpenAI research</h3><p className="text-sm text-stone-600">Evidence-backed discoveries enter the normal review queue; nothing publishes automatically.</p></div>
      <button type="button" className="btn-primary" disabled={starting || activeRuns.length > 0} onClick={() => void start()}>
        <Lightning size={17} aria-hidden="true" /> {starting ? 'Queueing…' : 'Research now'}
      </button>
    </div>
    {error && <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{error}</div>}
    {loading ? <div className="flex justify-center py-8"><Spinner /></div> : runs.length === 0 ? <p className="card text-sm text-stone-600">No research runs yet. Scheduled research runs every four hours.</p> : <div className="space-y-2">
      {activeRuns.map((run) => <article key={run.id} className="card space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-bold text-stone-900">{run.trigger_type === 'manual' ? 'Manual' : 'Scheduled'} research</p><p className="text-xs text-stone-500">{new Date(run.created_at).toLocaleString()} · {run.model}</p></div><span className="rounded bg-stone-100 px-2 py-0.5 text-xs font-bold text-stone-700">{run.status}</span></div>
        {run.status === 'succeeded' && <p className="text-sm text-stone-700">{run.accepted_count} accepted · {run.duplicate_count} duplicate · {run.rejected_count} rejected</p>}
        {run.status === 'succeeded' && run.accepted_count === 0 && <p className="text-sm text-amber-800">{run.diagnostics.summary ?? 'No candidates passed validation. Open the research log for the reason.'}</p>}
        {run.error_code && <p className="text-sm text-red-700">{researchRunErrorMessage(run.error_code)}</p>}
        {run.evidence.map((item) => <p key={item.candidate_id} className="break-words text-xs text-stone-600">Evidence: {item.urls.map((url, index) => <a key={url} href={url} target="_blank" rel="noreferrer" className="text-brand-700 underline">{index ? ' · ' : ''}{new URL(url).hostname}</a>)}</p>)}
        {(run.diagnostics.source_urls.length > 0 || run.diagnostics.candidates.length > 0 || run.diagnostics.summary) && <details className="rounded border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-stone-700" open={run.accepted_count === 0 || run.status === 'failed'}>
          <summary className="cursor-pointer font-bold text-stone-800">Research log</summary>
          {run.diagnostics.summary && <p className="mt-2">{run.diagnostics.summary}</p>}
          {run.diagnostics.source_urls.length > 0 && <p className="mt-2 break-words">Web sources: {run.diagnostics.source_urls.map((url, index) => <a key={url} href={url} target="_blank" rel="noreferrer" className="text-brand-700 underline">{index ? ' · ' : ''}{new URL(url).hostname}</a>)}</p>}
          {run.diagnostics.candidates.filter((candidate) => candidate.rejection_reasons.length > 0).map((candidate, index) => <p key={`${candidate.name ?? 'candidate'}-${index}`} className="mt-1 break-words">{candidate.name ?? 'Unnamed candidate'}: {candidate.rejection_reasons.join(', ')} ({candidate.matched_evidence_count}/2 returned sources matched)</p>)}
        </details>}
        {run.candidateIds.length > 0 && <button type="button" className="btn-secondary text-xs" onClick={onCandidates}>Review {run.candidateIds.length} candidate{run.candidateIds.length === 1 ? '' : 's'}</button>}
        <button type="button" className="btn-secondary text-xs text-red-700" disabled={cancellingId === run.id} onClick={() => void cancel(run)}>{cancellingId === run.id ? 'Cancelling…' : 'Force cancel run'}</button>
      </article>)}
      {completedRuns.length > 0 && <section className="space-y-2"><div className="flex items-center justify-between"><h4 className="text-sm font-bold text-stone-800">Completed research</h4><span className="text-xs text-stone-500">Open a run for details</span></div>
        <div className="overflow-hidden rounded-xl border border-stone-200 bg-white divide-y divide-stone-100">{completedRuns.map((run) => <details key={run.id} className="group px-3 py-2"><summary className="flex cursor-pointer list-none items-center justify-between gap-3"><span className="min-w-0"><span className="block font-semibold text-stone-900">{run.trigger_type === 'manual' ? 'Manual' : 'Scheduled'} research</span><span className="block truncate text-xs text-stone-500">{new Date(run.completed_at ?? run.created_at).toLocaleString()} · {run.model}</span></span><span className={`shrink-0 rounded px-2 py-0.5 text-xs font-bold ${run.status === 'succeeded' ? 'bg-green-100 text-green-700' : 'bg-red-50 text-red-700'}`}>{run.status === 'succeeded' ? `${run.accepted_count} accepted` : 'Needs attention'}</span></summary>
          <div className="mt-3 space-y-2 border-t border-stone-100 pt-2 text-sm text-stone-700">{run.status === 'succeeded' && <p>{run.accepted_count} accepted · {run.duplicate_count} duplicate · {run.rejected_count} rejected</p>}{run.error_code && <p className="text-red-700">{researchRunErrorMessage(run.error_code)}</p>}{run.diagnostics.discovery_lanes.length > 0 && <p className="text-xs"><span className="font-semibold">Coverage:</span> {run.diagnostics.discovery_lanes.join(' · ')}</p>}{run.diagnostics.summary && <p className="text-amber-800">{run.diagnostics.summary}</p>}{run.diagnostics.source_urls.length > 0 && <p className="break-words text-xs">Web sources: {run.diagnostics.source_urls.map((url, index) => <a key={url} href={url} target="_blank" rel="noreferrer" className="text-brand-700 underline">{index ? ' · ' : ''}{new URL(url).hostname}</a>)}</p>}{run.diagnostics.candidates.filter((candidate) => candidate.rejection_reasons.length > 0).map((candidate, index) => <p key={`${candidate.name ?? 'candidate'}-${index}`} className="text-xs">{candidate.name ?? 'Unnamed candidate'}: {candidate.rejection_reasons.join(', ')} ({candidate.matched_evidence_count}/2 sources matched)</p>)}{run.diagnostics.source_urls.length === 0 && run.diagnostics.candidates.length === 0 && !run.diagnostics.summary && <p className="text-xs text-stone-500">Detailed audit logs are available for research runs completed after this update.</p>}{run.candidateIds.length > 0 && <button type="button" className="btn-secondary text-xs" onClick={onCandidates}>Review {run.candidateIds.length} candidate{run.candidateIds.length === 1 ? '' : 's'}</button>}</div>
        </details>)}</div>
      </section>}
    </div>}
  </div>
}

function SourcesTab() {
  const [sources, setSources] = useState<EngineSource[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setSources(await listSources())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sources')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold text-stone-900">Registered sources</h3>
        <button type="button" className="btn-primary" onClick={() => setShowForm((v) => !v)}>
          <Plus size={17} aria-hidden="true" /> {showForm ? 'Cancel' : 'Add source'}
        </button>
      </div>

      {error && <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{error}</div>}

      {showForm && <SourceForm onCreated={() => { setShowForm(false); void load() }} />}

      {loading ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : sources.length === 0 ? (
        <p className="card text-sm text-stone-600">No sources registered yet.</p>
      ) : (
        <div className="space-y-2">
          {sources.map((src) => (
            <article key={src.id} className="card space-y-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-bold text-stone-900">{src.name}</p>
                  <p className="text-xs font-mono text-stone-500">{src.id}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded px-2 py-0.5 text-xs font-bold ${src.enabled ? 'bg-green-100 text-green-700' : 'bg-stone-200 text-stone-600'}`}>
                    {src.enabled ? 'Enabled' : 'Disabled'}
                  </span>
                  <span className="rounded bg-stone-100 px-2 py-0.5 text-xs font-bold text-stone-700">{src.kind}</span>
                </div>
              </div>
              <dl className="grid gap-2 text-xs sm:grid-cols-2">
                <div><dt className="font-bold text-stone-600">Independence key</dt><dd className="text-stone-800">{src.independence_key}</dd></div>
                <div><dt className="font-bold text-stone-600">Trust weight</dt><dd className="text-stone-800">{src.trust_weight}</dd></div>
                <div><dt className="font-bold text-stone-600">Poll interval</dt><dd className="text-stone-800">{src.poll_interval_minutes} min</dd></div>
                <div><dt className="font-bold text-stone-600">Failures</dt><dd className="text-stone-800">{src.consecutive_failures}</dd></div>
                {src.endpoint_url && <div className="sm:col-span-2"><dt className="font-bold text-stone-600">Endpoint</dt><dd className="break-all text-stone-800">{src.endpoint_url}</dd></div>}
                {src.catalog_host_allowlist.length > 0 && <div className="sm:col-span-2"><dt className="font-bold text-stone-600">Catalog allowlist</dt><dd className="text-stone-800">{src.catalog_host_allowlist.join(', ')}</dd></div>}
                {src.last_error_code && <div className="sm:col-span-2"><dt className="font-bold text-red-600">Last error</dt><dd className="text-red-700">{src.last_error_code}</dd></div>}
              </dl>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}

function SourceForm({ onCreated }: { onCreated: () => void }) {
  const [form, setForm] = useState<SourceCreateInput>({
    id: '',
    name: '',
    kind: 'json_feed',
    endpoint_url: null,
    independence_key: '',
    catalog_host_allowlist: [],
    trust_weight: 0.8,
    poll_interval_minutes: 30,
    enabled: true,
  })
  const [allowlistText, setAllowlistText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const hosts = allowlistText.split(',').map((s) => s.trim()).filter(Boolean)
      await createSource({
        ...form,
        catalog_host_allowlist: hosts,
        endpoint_url: form.endpoint_url || null,
      })
      onCreated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create source')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="card space-y-3">
      <h4 className="font-bold text-stone-900">Register new source</h4>
      {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="text-xs font-bold text-stone-600">Source ID (lowercase, hyphens)</span>
          <input className="input min-h-11" value={form.id} onChange={(e) => setForm((f) => ({ ...f, id: e.target.value }))} required pattern="[a-z0-9][a-z0-9_-]{1,63}" placeholder="market-rank-feed" />
        </label>
        <label className="space-y-1">
          <span className="text-xs font-bold text-stone-600">Name</span>
          <input className="input min-h-11" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required maxLength={100} placeholder="Market rank feed" />
        </label>
        <label className="space-y-1">
          <span className="text-xs font-bold text-stone-600">Kind</span>
          <select className="input min-h-11" value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as SourceKind }))}>
            <option value="json_feed">JSON feed</option>
            <option value="push">Push</option>
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-xs font-bold text-stone-600">Independence key</span>
          <input className="input min-h-11" value={form.independence_key} onChange={(e) => setForm((f) => ({ ...f, independence_key: e.target.value }))} required placeholder="market-rank-provider" />
        </label>
        <label className="space-y-1 sm:col-span-2">
          <span className="text-xs font-bold text-stone-600">Endpoint URL (HTTPS only)</span>
          <input className="input min-h-11" value={form.endpoint_url ?? ''} onChange={(e) => setForm((f) => ({ ...f, endpoint_url: e.target.value }))} placeholder="https://feeds.example.com/viral.json" />
        </label>
        <label className="space-y-1 sm:col-span-2">
          <span className="text-xs font-bold text-stone-600">Catalog host allowlist (comma-separated)</span>
          <input className="input min-h-11" value={allowlistText} onChange={(e) => setAllowlistText(e.target.value)} placeholder="brand.example, *.official-store.example" />
        </label>
        <label className="space-y-1">
          <span className="text-xs font-bold text-stone-600">Trust weight (0–1)</span>
          <input type="number" className="input min-h-11" value={form.trust_weight} min={0} max={1} step={0.05} onChange={(e) => setForm((f) => ({ ...f, trust_weight: Number(e.target.value) }))} />
        </label>
        <label className="space-y-1">
          <span className="text-xs font-bold text-stone-600">Poll interval (minutes)</span>
          <input type="number" className="input min-h-11" value={form.poll_interval_minutes} min={1} onChange={(e) => setForm((f) => ({ ...f, poll_interval_minutes: Number(e.target.value) }))} />
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={form.enabled} onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))} />
          <span className="text-sm font-bold text-stone-700">Enabled</span>
        </label>
      </div>
      <button type="submit" className="btn-primary" disabled={submitting}>
        {submitting ? 'Creating…' : 'Create source'}
      </button>
    </form>
  )
}

function CandidatesTab() {
  const [candidates, setCandidates] = useState<EngineCandidate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [stateFilter, setStateFilter] = useState<CandidateState | ''>('')
  const [reviewFilter, setReviewFilter] = useState<ReviewStatus | ''>('')
  const [recomputing, setRecomputing] = useState(false)
  const [actionId, setActionId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await listCandidates({
        state: stateFilter || undefined,
        review_status: reviewFilter || undefined,
        limit: 50,
      })
      setCandidates(data.candidates)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load candidates')
    } finally {
      setLoading(false)
    }
  }, [stateFilter, reviewFilter])

  useEffect(() => { void load() }, [load])

  async function handleReview(id: string, decision: 'approved' | 'rejected') {
    setActionId(id)
    try {
      await reviewCandidate(id, { decision })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Review failed')
    } finally {
      setActionId(null)
    }
  }

  async function handleRecompute() {
    setRecomputing(true)
    setError(null)
    try {
      await recomputeCandidates()
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Recompute failed')
    } finally {
      setRecomputing(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg font-bold text-stone-900">Candidates</h3>
        <button type="button" className="btn-secondary" disabled={recomputing} onClick={() => void handleRecompute()}>
          <ArrowsCounterClockwise size={17} aria-hidden="true" /> {recomputing ? 'Recomputing…' : 'Recompute scores'}
        </button>
      </div>

      {error && <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{error}</div>}

      <div className="flex flex-wrap gap-2">
        <select className="input min-h-11" value={stateFilter} onChange={(e) => setStateFilter(e.target.value as CandidateState | '')}>
          <option value="">All states</option>
          <option value="candidate">Candidate</option>
          <option value="emerging">Emerging</option>
          <option value="trending">Trending</option>
          <option value="cooling">Cooling</option>
          <option value="archived">Archived</option>
        </select>
        <select className="input min-h-11" value={reviewFilter} onChange={(e) => setReviewFilter(e.target.value as ReviewStatus | '')}>
          <option value="">All review statuses</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : candidates.length === 0 ? (
        <p className="card text-sm text-stone-600">No candidates found.</p>
      ) : (
        <div className="space-y-2">
          {candidates.map((c) => (
            <article key={c.id} className="card space-y-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h4 className="font-bold text-stone-900">{c.name}</h4>
                  <p className="text-xs text-stone-500">{c.brand ?? 'No brand'} · {c.category ?? 'No category'}</p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {c.score && (
                    <span className={`rounded px-2 py-0.5 text-xs font-black ${STATE_COLORS[c.score.state]}`}>
                      {c.score.state} · {c.score.value.toFixed(0)}
                    </span>
                  )}
                  <span className={`rounded px-2 py-0.5 text-xs font-bold ${REVIEW_COLORS[c.review_status]}`}>
                    {c.review_status}
                  </span>
                </div>
              </div>

              <dl className="grid gap-1 text-xs sm:grid-cols-3">
                <div><dt className="font-bold text-stone-600">Topic</dt><dd className="text-stone-800">{c.topic.name}</dd></div>
                <div><dt className="font-bold text-stone-600">Sources</dt><dd className="text-stone-800">{c.score?.source_count ?? 0} sources, {c.score?.signal_count ?? 0} signals</dd></div>
                <div><dt className="font-bold text-stone-600">Confidence</dt><dd className="text-stone-800">{c.score ? c.score.confidence.toFixed(2) : '—'}</dd></div>
                {c.product_url && <div className="sm:col-span-3"><dt className="font-bold text-stone-600">Product URL</dt><dd className="break-all text-stone-800">{c.product_url}{!c.product_url_verified && ' (unverified)'}</dd></div>}
              </dl>

              {c.research_explanation && <div className="rounded-lg border border-stone-200 bg-stone-50 p-3 text-xs text-stone-700">
                <p className="font-bold text-stone-900">Why discovered</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">{c.research_explanation.why_discovered.map((reason) => <li key={reason}>{reason}</li>)}</ul>
                <p className="mt-2 font-bold text-stone-900">Missing validation</p>
                {c.research_explanation.missing_validation.length > 0 ? <ul className="mt-1 list-disc space-y-0.5 pl-4">{c.research_explanation.missing_validation.map((reason) => <li key={reason}>{reason}</li>)}</ul> : <p className="mt-1">No gaps were returned; verify the cited evidence before approval.</p>}
                <p className="mt-2 text-stone-600">Evidence: {c.research_explanation.evidence_classifications.join(' · ')}{c.research_explanation.maximum_state && ` · promotion capped at ${c.research_explanation.maximum_state}`}</p>
              </div>}

              {c.review_status === 'pending' && (
                <div className="flex gap-2">
                  <button type="button" className="btn-primary" disabled={actionId === c.id} onClick={() => void handleReview(c.id, 'approved')}>
                    <Check size={16} aria-hidden="true" /> Approve
                  </button>
                  <button type="button" className="btn-secondary text-red-700" disabled={actionId === c.id} onClick={() => void handleReview(c.id, 'rejected')}>
                    <X size={16} aria-hidden="true" /> Reject
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  )
}

function PatchesTab() {
  const [patch, setPatch] = useState<EnginePatch | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)

  async function handleGenerate() {
    setGenerating(true)
    setError(null)
    try {
      const result = await generatePatch()
      setPatch(result.patch)
      if (!result.patch) setError(result.reason ?? 'No patch generated. Approval does not promote a candidate: it must be trending with current evidence. Shadow mode would create a draft for an eligible candidate; it never publishes one.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate patch')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold text-stone-900">Catalog patches</h3>
        <button type="button" className="btn-primary" disabled={generating} onClick={() => void handleGenerate()}>
          <Lightning size={17} aria-hidden="true" /> {generating ? 'Generating…' : 'Generate patch'}
        </button>
      </div>

      {error && <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{error}</div>}

      {patch ? (
        <article className="card space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="font-bold text-stone-900">Patch {patch.patch_id}</p>
              <p className="text-xs text-stone-500">Mode: {patch.mode} · Generated: {new Date(patch.generated_at).toLocaleString()}</p>
            </div>
            <span className="rounded bg-stone-100 px-2 py-0.5 text-xs font-mono text-stone-600">{patch.checksum.slice(0, 20)}…</span>
          </div>
          <div className="space-y-2">
            {patch.operations.map((op) => (
              <div key={op.operation_id} className="rounded-lg border border-stone-200 p-3">
                <div className="flex items-center gap-2">
                  <span className={`rounded px-2 py-0.5 text-xs font-bold ${op.action === 'ensure_trend' ? 'bg-brand-100 text-brand-700' : 'bg-green-100 text-green-700'}`}>
                    {op.action}
                  </span>
                  <span className="text-xs font-mono text-stone-500">{op.candidate_id}</span>
                </div>
                <dl className="mt-2 grid gap-1 text-xs sm:grid-cols-3">
                  <div><dt className="font-bold text-stone-600">Score</dt><dd className="text-stone-800">{op.reason.score.toFixed(0)}</dd></div>
                  <div><dt className="font-bold text-stone-600">Confidence</dt><dd className="text-stone-800">{op.reason.confidence.toFixed(2)}</dd></div>
                  <div><dt className="font-bold text-stone-600">State</dt><dd className="text-stone-800">{op.reason.state}</dd></div>
                </dl>
                {op.reason.evidence_urls.length > 0 && (
                  <div className="mt-1 text-xs">
                    <span className="font-bold text-stone-600">Evidence: </span>
                    {op.reason.evidence_urls.map((url, i) => (
                      <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="text-brand-600 underline">{i > 0 ? ', ' : ''}{url}</a>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </article>
      ) : (
        <p className="card text-sm text-stone-600">No patch generated yet. Click "Generate patch" to create one in the current engine mode.</p>
      )}
    </div>
  )
}

function ChangesTab() {
  const [changes, setChanges] = useState<EngineChange[]>([])
  const [cursor, setCursor] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)

  const load = useCallback(async (after: number) => {
    setLoading(true)
    setError(null)
    try {
      const data = await listChanges(after, 50)
      setChanges((prev) => after === 0 ? data.changes : [...prev, ...data.changes])
      setCursor(data.next_cursor)
      setHasMore(data.changes.length === 50)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load changes')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load(0) }, [load])

  return (
    <div className="space-y-3">
      <h3 className="text-lg font-bold text-stone-900">Change log</h3>

      {error && <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{error}</div>}

      {loading && changes.length === 0 ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : changes.length === 0 ? (
        <p className="card text-sm text-stone-600">No changes recorded yet.</p>
      ) : (
        <div className="space-y-1.5">
          {changes.map((ch) => (
            <article key={ch.sequence} className="card flex flex-wrap items-center justify-between gap-2 py-2">
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono text-stone-400">#{ch.sequence}</span>
                <span className="rounded bg-stone-100 px-2 py-0.5 text-xs font-bold text-stone-700">{ch.event_type}</span>
                <span className="text-xs text-stone-500">{ch.entity_id}</span>
              </div>
              <time className="text-xs text-stone-400">{new Date(ch.occurred_at).toLocaleString()}</time>
            </article>
          ))}
          {hasMore && !loading && (
            <button type="button" className="btn-secondary w-full" onClick={() => void load(cursor)}>Load more</button>
          )}
          {loading && <div className="flex justify-center py-4"><Spinner /></div>}
        </div>
      )}
    </div>
  )
}

function SettingsTab() {
  const [settings, setSettings] = useState<EngineSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setSettings(await getEngineSettings())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load settings')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  async function handleSave() {
    if (!settings) return
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const updated = await updateEngineSettings({
        max_output_tokens: settings.max_output_tokens,
        max_candidates_per_lane: settings.max_candidates_per_lane,
        search_context_size: settings.search_context_size,
        reasoning_effort: settings.reasoning_effort,
        model: settings.model,
      })
      setSettings(updated)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="flex justify-center py-8"><Spinner /></div>
  if (!settings) return <p className="card text-sm text-stone-600">Failed to load settings.</p>

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold text-stone-900">Engine settings</h3>
        <button type="button" className="btn-primary" disabled={saving} onClick={() => void handleSave()}>
          {saving ? 'Saving…' : saved ? 'Saved!' : 'Save settings'}
        </button>
      </div>
      {error && <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{error}</div>}
      <div className="card space-y-4">
        <div>
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-stone-700">Max output tokens</span>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={settings.max_output_tokens === 0}
                onChange={(e) => setSettings((s) => s ? { ...s, max_output_tokens: e.target.checked ? 0 : 3000 } : s)}
                className="accent-brand-600"
              />
              <span className="text-xs text-stone-600">No limit</span>
            </label>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={800}
              max={50000}
              step={100}
              value={settings.max_output_tokens === 0 ? 50000 : settings.max_output_tokens}
              disabled={settings.max_output_tokens === 0}
              onChange={(e) => setSettings((s) => s ? { ...s, max_output_tokens: Number(e.target.value) } : s)}
              className="w-full accent-brand-600 disabled:opacity-40"
            />
            <input
              type="number"
              min={0}
              max={50000}
              step={100}
              value={settings.max_output_tokens}
              disabled={settings.max_output_tokens === 0}
              onChange={(e) => setSettings((s) => s ? { ...s, max_output_tokens: Math.min(50000, Math.max(0, Number(e.target.value) || 0)) } : s)}
              className="w-24 rounded-lg border border-stone-300 px-2 py-1 text-sm font-mono text-stone-700 disabled:opacity-40"
            />
          </div>
          <p className="text-xs text-stone-500">Token budget for each OpenAI response. 0 = no limit (let the model decide). Too low and the model runs out before producing structured JSON output.</p>
        </div>
        <div>
          <label className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-stone-700">Max candidates per lane</span>
              <span className="text-sm font-mono text-stone-500">{settings.max_candidates_per_lane}</span>
            </div>
            <input
              type="range"
              min={1}
              max={5}
              step={1}
              value={settings.max_candidates_per_lane}
              onChange={(e) => setSettings((s) => s ? { ...s, max_candidates_per_lane: Number(e.target.value) } : s)}
              className="w-full accent-brand-600"
            />
            <p className="text-xs text-stone-500">Number of product candidates the model returns per research lane. 4 lanes × this value = total candidates per run.</p>
          </label>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1">
            <span className="text-sm font-bold text-stone-700">Search context size</span>
            <select
              className="input min-h-11"
              value={settings.search_context_size}
              onChange={(e) => setSettings((s) => s ? { ...s, search_context_size: e.target.value as 'low' | 'medium' | 'high' } : s)}
            >
              <option value="low">Low (fewer input tokens)</option>
              <option value="medium">Medium</option>
              <option value="high">High (more context, more tokens)</option>
            </select>
            <p className="text-xs text-stone-500">Controls how much web search context is supplied to the model. Lower = fewer tokens.</p>
          </label>
          <label className="space-y-1">
            <span className="text-sm font-bold text-stone-700">Reasoning effort</span>
            <select
              className="input min-h-11"
              value={settings.reasoning_effort}
              onChange={(e) => setSettings((s) => s ? { ...s, reasoning_effort: e.target.value as 'low' | 'medium' | 'high' } : s)}
            >
              <option value="low">Low (fewer output tokens)</option>
              <option value="medium">Medium</option>
              <option value="high">High (deeper reasoning, more tokens)</option>
            </select>
            <p className="text-xs text-stone-500">Controls how much reasoning the model does before producing output. Lower = fewer tokens.</p>
          </label>
          <label className="space-y-1">
            <span className="text-sm font-bold text-stone-700">Model</span>
            <select
              className="input min-h-11"
              value={settings.model}
              onChange={(e) => setSettings((s) => s ? { ...s, model: e.target.value } : s)}
            >
              <option value="gpt-5-mini">GPT-5 Mini</option>
              <option value="gpt-5.6-luna">GPT-5.6 Luna</option>
              <option value="o4-mini">o4 Mini</option>
            </select>
            <p className="text-xs text-stone-500">OpenAI model used for research. GPT-5 Mini is the fastest and cheapest.</p>
          </label>
        </div>
        <p className="text-xs text-stone-400">Last updated: {new Date(settings.updated_at).toLocaleString()}</p>
      </div>
    </div>
  )
}
