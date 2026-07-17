export const ENGINE_SERVICE = 'finditviral-trend-engine'
export const SIGNAL_SCHEMA_VERSION = 1 as const
export const PATCH_SCHEMA_VERSION = 1 as const
export const SCORE_VERSION = 'viral-score-2026-07-v1'
export const PATCH_POLICY_VERSION = 'catalog-policy-2026-07-v1'

export const SIGNAL_TYPES = [
  'search_interest',
  'social_velocity',
  'marketplace_rank',
  'editorial_mentions',
  'fiv_demand',
  'manual',
] as const

export const AVAILABILITY_STATUSES = [
  'available',
  'backorder',
  'preorder',
  'announced',
  'limited',
  'retired',
] as const

export const CANDIDATE_STATES = [
  'candidate',
  'emerging',
  'trending',
  'cooling',
  'archived',
] as const

export const ENGINE_MODES = ['shadow', 'review', 'autopilot'] as const
export const PATCH_ACTIONS = ['ensure_trend', 'add_product'] as const

export type SignalType = typeof SIGNAL_TYPES[number]
export type AvailabilityStatus = typeof AVAILABILITY_STATUSES[number]
export type CandidateState = typeof CANDIDATE_STATES[number]
export type EngineMode = typeof ENGINE_MODES[number]
export type ReviewStatus = 'pending' | 'approved' | 'rejected'

export interface ViralCandidateInput {
  external_id: string
  name: string
  brand?: string
  gtin?: string
  category?: string
  topic: {
    name: string
    slug?: string
    description?: string
  }
  product_url?: string
  image_url?: string
  search_terms?: string[]
  availability_status?: AvailabilityStatus
  release_date?: string
}

export interface ViralSignalV1 {
  schema_version: 1
  kind: 'viral_signal'
  source: string
  external_observation_id: string
  source_run_id: string
  observed_at: string
  expires_at: string
  candidate: ViralCandidateInput
  signal: {
    type: SignalType
    value: number
    velocity?: number
    rank?: number
    previous_rank?: number
    sample_size?: number
  }
  confidence: number
  evidence_url: string
  evidence_hash?: string
}

export interface ViralSignalBatchV1 {
  schema_version: 1
  records: ViralSignalV1[]
}

export interface SourceRow {
  id: string
  name: string
  kind: 'push' | 'json_feed'
  endpoint_url: string | null
  independence_key: string
  catalog_host_allowlist_json: string
  trust_weight: number
  poll_interval_minutes: number
  enabled: number
  next_poll_at: string | null
  lease_until: string | null
  last_polled_at: string | null
  last_success_at: string | null
  last_error_code: string | null
  consecutive_failures: number
  created_at: string
  updated_at: string
}

export interface ScoreSignalInput {
  sourceId: string
  independenceKey: string
  trustWeight: number
  signalType: SignalType
  value: number
  velocity: number | null
  rank: number | null
  previousRank: number | null
  confidence: number
  observedAt: string
  expiresAt: string
}

export interface ScoreSnapshot {
  score: number
  previousScore: number | null
  momentum: number
  confidence: number
  sourceCount: number
  signalCount: number
  state: CandidateState
  explanation: {
    policy_version: string
    weighted_signal: number
    recency_weight: number
    source_breadth: number
    momentum_adjustment: number
    active_signal_count: number
    distinct_source_count: number
  }
  scoreVersion: string
  computedAt: string
}

export interface CurrentScoreRow {
  candidate_id: string
  score: number
  previous_score: number | null
  momentum: number
  confidence: number
  source_count: number
  signal_count: number
  state: CandidateState
  explanation_json: string
  score_version: string
  computed_at: string
}

export interface CandidateProjectionRow {
  id: string
  identity_key: string
  name: string
  slug_suggestion: string
  brand: string | null
  gtin: string | null
  category: string | null
  topic_name: string
  topic_slug: string
  topic_description: string | null
  product_url: string | null
  product_url_verified: number
  image_url: string | null
  search_terms_json: string
  availability_status: AvailabilityStatus | null
  release_date: string | null
  first_seen_at: string
  last_seen_at: string
  review_status: ReviewStatus
  review_overrides_json: string | null
  reviewed_at: string | null
  score: number | null
  previous_score: number | null
  momentum: number | null
  score_confidence: number | null
  source_count: number | null
  signal_count: number | null
  state: CandidateState | null
  score_version: string | null
  score_computed_at: string | null
}

export interface CatalogOverrides {
  trend_name?: string
  trend_slug?: string
  trend_description?: string | null
  product_name?: string
  product_slug?: string
  brand?: string | null
  category?: string | null
  search_terms?: string[]
  availability_status?: AvailabilityStatus
  release_date?: string | null
  source_url?: string
}

export type PatchAction = typeof PATCH_ACTIONS[number]

export interface CatalogPatchOperationV1 {
  operation_id: string
  sequence: number
  action: PatchAction
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

export interface CatalogPatchV1 {
  schema_version: 1
  patch_id: string
  generated_at: string
  target: 'finditviral'
  mode: EngineMode
  score_version: string
  checksum: string
  operations: CatalogPatchOperationV1[]
}

export interface PollSourceMessage {
  kind: 'poll_source'
  source_id: string
  scheduled_at: string
  execution_key: string
}

export interface OpenAiResearchMessage {
  kind: 'openai_research'
  run_id: string
}

export type TrendEngineQueueMessage = PollSourceMessage | OpenAiResearchMessage
export type ResearchTrigger = 'scheduled' | 'manual'
export type ResearchRunStatus = 'queued' | 'running' | 'succeeded' | 'failed'

export interface ResearchRunRow {
  id: string
  request_key: string
  trigger_type: ResearchTrigger
  status: ResearchRunStatus
  model: string
  prompt_version: string
  created_at: string
  started_at: string | null
  completed_at: string | null
  lease_until: string | null
  received_count: number
  accepted_count: number
  duplicate_count: number
  rejected_count: number
  candidate_ids_json: string
  evidence_json: string
  error_code: string | null
}

export interface PatchPolicyDecision {
  eligible: boolean
  ready: boolean
  reasons: string[]
}
