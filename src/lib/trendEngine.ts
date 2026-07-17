import { supabase } from './supabase'

const ENGINE_PROXY_URL = '/api/trend-engine'

export type EngineMode = 'shadow' | 'review' | 'autopilot'
export type CandidateState = 'candidate' | 'emerging' | 'trending' | 'cooling' | 'archived'
export type ReviewStatus = 'pending' | 'approved' | 'rejected'
export type SourceKind = 'push' | 'json_feed'

export interface EngineHealth {
  service: string
  status: string
  mode: EngineMode
  time: string
}

export interface EngineSource {
  id: string
  name: string
  kind: SourceKind
  endpoint_url: string | null
  independence_key: string
  catalog_host_allowlist: string[]
  trust_weight: number
  poll_interval_minutes: number
  enabled: boolean
  next_poll_at: string | null
  last_polled_at: string | null
  last_success_at: string | null
  last_error_code: string | null
  consecutive_failures: number
}

export interface EngineScore {
  value: number
  previous: number | null
  momentum: number
  confidence: number
  source_count: number
  signal_count: number
  state: CandidateState
  version: string
  computed_at: string
}

export interface EngineCandidate {
  id: string
  identity_key: string
  name: string
  suggested_slug: string
  brand: string | null
  gtin: string | null
  category: string | null
  topic: {
    name: string
    slug: string | null
    description: string | null
  }
  product_url: string | null
  product_url_verified: boolean
  image_candidate_url: string | null
  search_terms: string[]
  availability_status: string | null
  release_date: string | null
  first_seen_at: string
  last_seen_at: string
  review_status: ReviewStatus
  reviewed_at: string | null
  score: EngineScore | null
}

export interface CatalogPatchOperation {
  operation_id: string
  sequence: number
  action: 'ensure_trend' | 'add_product'
  candidate_id: string
  idempotency_key: string
  depends_on: string[]
  before: Record<string, unknown> | null
  after: Record<string, unknown>
  reason: {
    score: number
    confidence: number
    state: CandidateState
    policy_version: string
    evidence_urls: string[]
  }
  reversible: boolean
}

export interface EnginePatch {
  schema_version: number
  patch_id: string
  generated_at: string
  target: string
  mode: EngineMode
  score_version: string
  checksum: string
  operations: CatalogPatchOperation[]
}

export interface EngineChange {
  sequence: number
  event_type: string
  entity_id: string
  occurred_at: string
  payload: unknown
}

export interface SourceCreateInput {
  id: string
  name: string
  kind: SourceKind
  endpoint_url: string | null
  independence_key: string
  catalog_host_allowlist: string[]
  trust_weight: number
  poll_interval_minutes: number
  enabled: boolean
}

export interface ReviewInput {
  decision: 'approved' | 'rejected'
  note?: string
  overrides?: {
    trend_name?: string
    trend_slug?: string
    trend_description?: string | null
    product_name?: string
    product_slug?: string
    brand?: string | null
    category?: string | null
    search_terms?: string[]
    availability_status?: string
    release_date?: string | null
    source_url?: string
  }
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Sign in as an app owner to use Trend Engine controls.')
  return {
    'Authorization': `Bearer ${session.access_token}`,
    'Content-Type': 'application/json',
  }
}

async function engineFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${ENGINE_PROXY_URL}${path}`, {
    ...init,
    headers: { ...(await authHeaders()), ...(init?.headers ?? {}) },
  })
  if (res.status === 204) return undefined as T
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    const msg = body && typeof body === 'object' && 'error' in body
      ? (body.error as { message?: string }).message ?? `HTTP ${res.status}`
      : `HTTP ${res.status}`
    throw new Error(msg)
  }
  return body as T
}

export async function getEngineHealth(): Promise<EngineHealth> {
  const res = await fetch(`${ENGINE_PROXY_URL}/health`)
  if (!res.ok) throw new Error(`Health check failed: HTTP ${res.status}`)
  return res.json()
}

export async function listSources(): Promise<EngineSource[]> {
  const data = await engineFetch<{ sources: EngineSource[] }>('/v1/sources')
  return data.sources
}

export async function createSource(input: SourceCreateInput): Promise<EngineSource> {
  const data = await engineFetch<{ source: EngineSource }>('/v1/sources', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return data.source
}

export async function listCandidates(params?: {
  state?: CandidateState
  review_status?: ReviewStatus
  limit?: number
  offset?: number
}): Promise<{ candidates: EngineCandidate[]; pagination: { limit: number; offset: number; count: number } }> {
  const qs = new URLSearchParams()
  if (params?.state) qs.set('state', params.state)
  if (params?.review_status) qs.set('review_status', params.review_status)
  if (params?.limit) qs.set('limit', String(params.limit))
  if (params?.offset) qs.set('offset', String(params.offset))
  return engineFetch(`/v1/candidates?${qs.toString()}`)
}

export async function getCandidate(id: string): Promise<EngineCandidate> {
  const data = await engineFetch<{ candidate: EngineCandidate }>(`/v1/candidates/${encodeURIComponent(id)}`)
  return data.candidate
}

export async function reviewCandidate(id: string, input: ReviewInput): Promise<{ candidate_id: string; review_status: string; reviewed_at: string }> {
  return engineFetch(`/v1/candidates/${encodeURIComponent(id)}/review`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export async function recomputeCandidates(): Promise<{ recomputed: number }> {
  return engineFetch('/v1/recompute', { method: 'POST' })
}

export async function generatePatch(): Promise<{ patch: EnginePatch | null; mode: EngineMode; reason?: string }> {
  return engineFetch('/v1/patches', { method: 'POST', body: JSON.stringify({}) })
}

export async function listChanges(after?: number, limit?: number): Promise<{ changes: EngineChange[]; next_cursor: number }> {
  const qs = new URLSearchParams()
  if (after !== undefined) qs.set('after', String(after))
  if (limit !== undefined) qs.set('limit', String(limit))
  return engineFetch(`/v1/changes?${qs.toString()}`)
}
