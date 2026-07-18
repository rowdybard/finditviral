import type {
  CandidateProjectionRow,
  CandidateState,
  CurrentScoreRow,
  EngineMode,
  ScoreSignalInput,
  ScoreSnapshot,
  ResearchRunRow,
  ResearchRunDiagnostics,
  ResearchLane,
  ResearchLaneCheckpointRow,
  LaneProgressView,
  EvidenceClassification,
  ResearchTrigger,
  SignalType,
  SourceRow,
} from './domain'
import type { SourceCreateInput } from './validation'

interface AliasRow {
  candidate_id: string
}

interface ScoreSignalRow {
  source_id: string
  independence_key: string
  trust_weight: number
  signal_type: SignalType
  signal_value: number
  velocity: number | null
  rank_value: number | null
  previous_rank: number | null
  confidence: number
  observed_at: string
  expires_at: string
}

export interface ChangeLogRow {
  sequence_number: number
  event_type: 'viral_signal' | 'score_snapshot' | 'catalog_patch'
  entity_id: string
  occurred_at: string
  payload_json: string
}

export interface CandidateListFilters {
  state?: CandidateState
  reviewStatus?: 'pending' | 'approved' | 'rejected'
  limit: number
  offset: number
}

export async function getSource(db: D1Database, id: string): Promise<SourceRow | null> {
  return db.prepare('SELECT * FROM sources WHERE id = ?').bind(id).first<SourceRow>()
}

export async function listSources(db: D1Database): Promise<SourceRow[]> {
  const result = await db.prepare('SELECT * FROM sources ORDER BY name, id').all<SourceRow>()
  return result.results
}

export async function upsertSource(db: D1Database, input: SourceCreateInput, now: string): Promise<SourceRow> {
  const nextPollAt = input.kind === 'json_feed' ? now : null
  await db.prepare(`
    INSERT INTO sources (
      id, name, kind, endpoint_url, independence_key, catalog_host_allowlist_json,
      trust_weight, poll_interval_minutes,
      enabled, next_poll_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      kind = excluded.kind,
      endpoint_url = excluded.endpoint_url,
      independence_key = excluded.independence_key,
      catalog_host_allowlist_json = excluded.catalog_host_allowlist_json,
      trust_weight = excluded.trust_weight,
      poll_interval_minutes = excluded.poll_interval_minutes,
      enabled = excluded.enabled,
      next_poll_at = CASE
        WHEN excluded.kind = 'push' THEN NULL
        ELSE COALESCE(sources.next_poll_at, excluded.next_poll_at)
      END,
      lease_until = CASE WHEN excluded.kind = 'push' THEN NULL ELSE sources.lease_until END,
      updated_at = excluded.updated_at
  `).bind(
    input.id,
    input.name,
    input.kind,
    input.endpoint_url,
    input.independence_key,
    JSON.stringify(input.catalog_host_allowlist),
    input.trust_weight,
    input.poll_interval_minutes,
    input.enabled ? 1 : 0,
    nextPollAt,
    now,
    now,
  ).run()

  const source = await getSource(db, input.id)
  if (!source) throw new Error(`Source ${input.id} was not persisted`)
  return source
}

export async function getAliasCandidateId(db: D1Database, sourceId: string, externalId: string): Promise<string | null> {
  const row = await db.prepare(`
    SELECT candidate_id
    FROM candidate_aliases
    WHERE source_id = ? AND external_id = ?
  `).bind(sourceId, externalId).first<AliasRow>()
  return row?.candidate_id ?? null
}

export async function getCurrentScore(db: D1Database, candidateId: string): Promise<CurrentScoreRow | null> {
  return db.prepare('SELECT * FROM current_scores WHERE candidate_id = ?')
    .bind(candidateId)
    .first<CurrentScoreRow>()
}

export async function listScoreSignals(db: D1Database, candidateId: string, now: string): Promise<ScoreSignalInput[]> {
  const result = await db.prepare(`
    SELECT
      v.source_id,
      s.independence_key,
      s.trust_weight,
      v.signal_type,
      v.signal_value,
      v.velocity,
      v.rank_value,
      v.previous_rank,
      v.confidence,
      v.observed_at,
      v.expires_at
    FROM viral_signals v
    JOIN sources s ON s.id = v.source_id
    WHERE v.candidate_id = ?
      AND v.observed_at <= ?
      AND v.expires_at > ?
      AND s.enabled = 1
    ORDER BY v.observed_at DESC
    LIMIT 500
  `).bind(candidateId, now, now).all<ScoreSignalRow>()

  return result.results.map((row) => ({
    sourceId: row.source_id,
    independenceKey: row.independence_key,
    trustWeight: row.trust_weight,
    signalType: row.signal_type,
    value: row.signal_value,
    velocity: row.velocity,
    rank: row.rank_value,
    previousRank: row.previous_rank,
    confidence: row.confidence,
    observedAt: row.observed_at,
    expiresAt: row.expires_at,
  }))
}

export async function saveScore(
  db: D1Database,
  snapshotId: string,
  candidateId: string,
  snapshot: ScoreSnapshot,
): Promise<void> {
  const explanation = JSON.stringify(snapshot.explanation)
  await db.batch([
    db.prepare(`
      INSERT INTO score_snapshots (
        id, candidate_id, score, previous_score, momentum, confidence,
        source_count, signal_count, state, explanation_json, score_version, computed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      snapshotId,
      candidateId,
      snapshot.score,
      snapshot.previousScore,
      snapshot.momentum,
      snapshot.confidence,
      snapshot.sourceCount,
      snapshot.signalCount,
      snapshot.state,
      explanation,
      snapshot.scoreVersion,
      snapshot.computedAt,
    ),
    db.prepare(`
      INSERT INTO current_scores (
        candidate_id, score, previous_score, momentum, confidence,
        source_count, signal_count, state, explanation_json, score_version, computed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(candidate_id) DO UPDATE SET
        score = excluded.score,
        previous_score = excluded.previous_score,
        momentum = excluded.momentum,
        confidence = excluded.confidence,
        source_count = excluded.source_count,
        signal_count = excluded.signal_count,
        state = excluded.state,
        explanation_json = excluded.explanation_json,
        score_version = excluded.score_version,
        computed_at = excluded.computed_at
      WHERE excluded.computed_at >= current_scores.computed_at
    `).bind(
      candidateId,
      snapshot.score,
      snapshot.previousScore,
      snapshot.momentum,
      snapshot.confidence,
      snapshot.sourceCount,
      snapshot.signalCount,
      snapshot.state,
      explanation,
      snapshot.scoreVersion,
      snapshot.computedAt,
    ),
  ])
}

const CANDIDATE_PROJECTION = `
  SELECT
    c.id,
    c.identity_key,
    c.name,
    c.slug_suggestion,
    c.brand,
    c.gtin,
    c.category,
    c.topic_name,
    c.topic_slug,
    c.topic_description,
    c.product_url,
    c.product_url_verified,
    c.image_url,
    c.search_terms_json,
    c.availability_status,
    c.release_date,
    c.first_seen_at,
    c.last_seen_at,
    c.review_status,
    c.review_overrides_json,
    c.reviewed_at,
    s.score,
    s.previous_score,
    s.momentum,
    s.confidence AS score_confidence,
    s.source_count,
    s.signal_count,
    s.state,
    s.score_version,
    s.computed_at AS score_computed_at,
    re.explanation_json AS research_explanation_json
  FROM candidates c
  LEFT JOIN current_scores s ON s.candidate_id = c.id
  LEFT JOIN candidate_research_explanations re ON re.candidate_id = c.id
`

export async function getCandidate(db: D1Database, candidateId: string): Promise<CandidateProjectionRow | null> {
  return db.prepare(`${CANDIDATE_PROJECTION} WHERE c.id = ?`)
    .bind(candidateId)
    .first<CandidateProjectionRow>()
}

export async function listCandidates(db: D1Database, filters: CandidateListFilters): Promise<CandidateProjectionRow[]> {
  const clauses: string[] = []
  const values: Array<string | number> = []
  if (filters.state) {
    clauses.push('s.state = ?')
    values.push(filters.state)
  }
  if (filters.reviewStatus) {
    clauses.push('c.review_status = ?')
    values.push(filters.reviewStatus)
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
  const result = await db.prepare(`
    ${CANDIDATE_PROJECTION}
    ${where}
    ORDER BY COALESCE(s.score, -1) DESC, c.last_seen_at DESC, c.id
    LIMIT ? OFFSET ?
  `).bind(...values, filters.limit, filters.offset).all<CandidateProjectionRow>()
  return result.results
}

export async function listPatchCandidates(
  db: D1Database,
  options: {
    mode: EngineMode
    scoreFreshAfter: string
    evidenceActiveAt: string
    autopilotMinScore: number
    autopilotMinConfidence: number
    autopilotMinSources: number
    limit?: number
  },
): Promise<CandidateProjectionRow[]> {
  const modeClause = options.mode === 'review'
    ? `AND c.review_status = 'approved'`
    : options.mode === 'autopilot'
      ? `AND c.review_status <> 'rejected'
         AND (
           c.review_status = 'approved'
           OR (
             c.product_url_verified = 1
             AND s.score >= ? AND s.confidence >= ? AND s.source_count >= ?
           )
         )`
      : `AND c.review_status <> 'rejected' AND c.product_url_verified = 1`
  const modeBindings = options.mode === 'autopilot'
    ? [options.autopilotMinScore, options.autopilotMinConfidence, options.autopilotMinSources]
    : []
  const result = await db.prepare(`
    ${CANDIDATE_PROJECTION}
    WHERE s.state = 'trending'
      AND s.computed_at >= ?
      AND c.product_url IS NOT NULL
      AND c.availability_status IS NOT NULL
      AND c.availability_status <> 'retired'
      ${modeClause}
      AND EXISTS (
        SELECT 1
        FROM viral_signals v
        JOIN sources source ON source.id = v.source_id
        WHERE v.candidate_id = c.id AND v.expires_at > ? AND source.enabled = 1
      )
      AND NOT EXISTS (
        SELECT 1
        FROM patch_candidate_claims pc
        WHERE pc.candidate_id = c.id AND pc.action = 'add_product'
      )
    ORDER BY s.score DESC, s.confidence DESC, c.last_seen_at DESC, c.id
    LIMIT ?
  `).bind(
    options.scoreFreshAfter,
    ...modeBindings,
    options.evidenceActiveAt,
    options.limit ?? 50,
  ).all<CandidateProjectionRow>()
  return result.results
}

export async function listCandidateIds(db: D1Database, limit = 10): Promise<string[]> {
  const result = await db.prepare(`
    SELECT c.id
    FROM candidates c
    LEFT JOIN current_scores s ON s.candidate_id = c.id
    ORDER BY COALESCE(s.computed_at, ''), c.id
    LIMIT ?
  `)
    .bind(limit)
    .all<{ id: string }>()
  return result.results.map((row) => row.id)
}

export async function saveReviewDecision(
  db: D1Database,
  input: {
    id: string
    candidateId: string
    decision: 'approved' | 'rejected'
    note: string | null
    overridesJson: string | null
    decidedAt: string
  },
): Promise<boolean> {
  const candidate = await getCandidate(db, input.candidateId)
  if (!candidate) return false
  await db.batch([
    db.prepare(`
      INSERT INTO review_decisions (id, candidate_id, decision, note, overrides_json, decided_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(input.id, input.candidateId, input.decision, input.note, input.overridesJson, input.decidedAt),
    db.prepare(`
      UPDATE candidates
      SET review_status = ?, review_overrides_json = ?, reviewed_at = ?, updated_at = ?
      WHERE id = ?
    `).bind(input.decision, input.overridesJson, input.decidedAt, input.decidedAt, input.candidateId),
  ])
  return true
}

export async function listEvidenceUrls(
  db: D1Database,
  candidateId: string,
  now: string,
  limit = 10,
): Promise<string[]> {
  const result = await db.prepare(`
    SELECT v.evidence_url
    FROM viral_signals v
    JOIN sources s ON s.id = v.source_id
    WHERE v.candidate_id = ?
      AND v.expires_at > ?
      AND s.enabled = 1
    ORDER BY v.observed_at DESC
    LIMIT ?
  `).bind(candidateId, now, limit).all<{ evidence_url: string }>()
  return Array.from(new Set(result.results.map((row) => row.evidence_url)))
}

export async function claimDueSources(db: D1Database, now: Date, limit = 25): Promise<SourceRow[]> {
  const nowIso = now.toISOString()
  const due = await db.prepare(`
    SELECT *
    FROM sources
    WHERE enabled = 1
      AND kind = 'json_feed'
      AND next_poll_at <= ?
      AND (lease_until IS NULL OR lease_until <= ?)
    ORDER BY next_poll_at, id
    LIMIT ?
  `).bind(nowIso, nowIso, limit).all<SourceRow>()

  const claimed: SourceRow[] = []
  for (const source of due.results) {
    const leaseUntil = new Date(now.getTime() + 10 * 60 * 1000).toISOString()
    const nextPollAt = new Date(now.getTime() + source.poll_interval_minutes * 60 * 1000).toISOString()
    const result = await db.prepare(`
      UPDATE sources
      SET lease_until = ?, next_poll_at = ?, last_polled_at = ?, updated_at = ?
      WHERE id = ?
        AND enabled = 1
        AND next_poll_at <= ?
        AND (lease_until IS NULL OR lease_until <= ?)
    `).bind(leaseUntil, nextPollAt, nowIso, nowIso, source.id, nowIso, nowIso).run()
    if (result.meta.changes > 0) claimed.push({ ...source, lease_until: leaseUntil, next_poll_at: nextPollAt, last_polled_at: nowIso })
  }
  return claimed
}

export async function recordSourceSuccess(db: D1Database, sourceId: string, now: string): Promise<void> {
  await db.prepare(`
    UPDATE sources
    SET lease_until = NULL, last_success_at = ?, last_error_code = NULL,
        consecutive_failures = 0, updated_at = ?
    WHERE id = ?
  `).bind(now, now, sourceId).run()
}

export async function recordSourceFailure(
  db: D1Database,
  sourceId: string,
  errorCode: string,
  retryAt: string | null,
  now: string,
): Promise<void> {
  await db.prepare(`
    UPDATE sources
    SET lease_until = ?, last_error_code = ?,
        consecutive_failures = consecutive_failures + 1, updated_at = ?
    WHERE id = ?
  `).bind(retryAt, errorCode, now, sourceId).run()
}

export async function claimCronRun(
  db: D1Database,
  executionKey: string,
  cron: string,
  scheduledAt: string,
  claimedAt: string,
): Promise<boolean> {
  const result = await db.prepare(`
    INSERT OR IGNORE INTO cron_runs (execution_key, cron_expression, scheduled_at, claimed_at)
    VALUES (?, ?, ?, ?)
  `).bind(executionKey, cron, scheduledAt, claimedAt).run()
  return result.meta.changes > 0
}

export async function releaseCronRun(db: D1Database, executionKey: string): Promise<void> {
  await db.prepare('DELETE FROM cron_runs WHERE execution_key = ?').bind(executionKey).run()
}

export async function releaseSourceClaims(
  db: D1Database,
  sourceIds: string[],
  retryAt: string,
): Promise<void> {
  if (sourceIds.length === 0) return
  const placeholders = sourceIds.map(() => '?').join(', ')
  await db.prepare(`
    UPDATE sources
    SET lease_until = NULL, next_poll_at = MIN(next_poll_at, ?), updated_at = ?
    WHERE id IN (${placeholders})
  `).bind(retryAt, retryAt, ...sourceIds).run()
}

export type SourcePollJobClaim = 'claimed' | 'completed' | 'busy'

export async function claimSourcePollJob(
  db: D1Database,
  input: {
    jobKey: string
    sourceId: string
    executionKey: string
    now: string
    leaseUntil: string
  },
): Promise<SourcePollJobClaim> {
  const claimed = await db.prepare(`
    INSERT INTO source_poll_jobs (
      job_key, source_id, execution_key, status, lease_until, created_at, updated_at
    ) VALUES (?, ?, ?, 'processing', ?, ?, ?)
    ON CONFLICT(job_key) DO UPDATE SET
      status = 'processing',
      lease_until = excluded.lease_until,
      updated_at = excluded.updated_at
    WHERE source_poll_jobs.status = 'pending'
       OR (source_poll_jobs.status = 'processing' AND source_poll_jobs.lease_until <= ?)
    RETURNING job_key
  `).bind(
    input.jobKey,
    input.sourceId,
    input.executionKey,
    input.leaseUntil,
    input.now,
    input.now,
    input.now,
  ).first<{ job_key: string }>()
  if (claimed) return 'claimed'
  const existing = await db.prepare('SELECT status FROM source_poll_jobs WHERE job_key = ?')
    .bind(input.jobKey)
    .first<{ status: 'processing' | 'pending' | 'completed' }>()
  return existing?.status === 'completed' ? 'completed' : 'busy'
}

export async function completeSourcePollJob(db: D1Database, jobKey: string, now: string): Promise<void> {
  await db.prepare(`
    UPDATE source_poll_jobs
    SET status = 'completed', lease_until = NULL, completed_at = ?, updated_at = ?
    WHERE job_key = ? AND status = 'processing'
  `).bind(now, now, jobKey).run()
}

export async function releaseSourcePollJob(db: D1Database, jobKey: string, now: string): Promise<void> {
  await db.prepare(`
    UPDATE source_poll_jobs
    SET status = 'pending', lease_until = NULL, updated_at = ?
    WHERE job_key = ? AND status = 'processing'
  `).bind(now, jobKey).run()
}

export interface ResearchRunView extends ResearchRunRow {
  candidateIds: string[]
  evidence: Array<{ candidate_id: string; urls: string[] }>
  diagnostics: ResearchRunDiagnostics
  lanes: LaneProgressView[]
}

function parseJsonArray(value: string): unknown[] {
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function parseResearchDiagnostics(value: string): ResearchRunDiagnostics {
  const empty: ResearchRunDiagnostics = { source_urls: [], discovery_lanes: [], candidates: [], summary: null }
  try {
    const parsed: unknown = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return empty
    const record = parsed as Record<string, unknown>
    const sourceUrls = Array.isArray(record.source_urls)
      ? record.source_urls.filter((url): url is string => typeof url === 'string').slice(0, 40)
      : []
    const discoveryLanes = Array.isArray(record.discovery_lanes)
      ? record.discovery_lanes.filter((lane): lane is string => typeof lane === 'string').slice(0, 4)
      : []
    const candidates = Array.isArray(record.candidates) ? record.candidates.flatMap((value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return []
      const candidate = value as Record<string, unknown>
      const name = typeof candidate.name === 'string' ? candidate.name : null
      const productUrl = typeof candidate.product_url === 'string' ? candidate.product_url : null
      const evidenceUrls = Array.isArray(candidate.evidence_urls)
        ? candidate.evidence_urls.filter((url): url is string => typeof url === 'string').slice(0, 2)
        : []
      const matched = typeof candidate.matched_evidence_count === 'number' && Number.isInteger(candidate.matched_evidence_count)
        ? Math.max(0, Math.min(2, candidate.matched_evidence_count))
        : 0
      const reasons = Array.isArray(candidate.rejection_reasons)
        ? candidate.rejection_reasons.filter((reason): reason is string => typeof reason === 'string').slice(0, 8)
        : []
      const whyDiscovered = Array.isArray(candidate.why_discovered) ? candidate.why_discovered.filter((reason): reason is string => typeof reason === 'string').slice(0, 4) : []
      const missingValidation = Array.isArray(candidate.missing_validation) ? candidate.missing_validation.filter((reason): reason is string => typeof reason === 'string').slice(0, 4) : []
      const classifications = Array.isArray(candidate.evidence_classifications) ? candidate.evidence_classifications.filter((classification): classification is EvidenceClassification => typeof classification === 'string' && ['brand_owned', 'founder_owned', 'press_release', 'retailer_listing', 'independent_editorial', 'independent_social', 'consumer_activity'].includes(classification)).slice(0, 2) : []
      const maximumState: 'emerging' | null = candidate.maximum_state === 'emerging' ? 'emerging' : null
      const countFlag = typeof candidate.count_flag === 'string' ? candidate.count_flag : null
      return [{ name, product_url: productUrl, evidence_urls: evidenceUrls, matched_evidence_count: matched, rejection_reasons: reasons, why_discovered: whyDiscovered, missing_validation: missingValidation, evidence_classifications: classifications, maximum_state: maximumState, count_flag: countFlag }]
    }).slice(0, 12) : []
    return { source_urls: sourceUrls, discovery_lanes: discoveryLanes, candidates, summary: typeof record.summary === 'string' ? record.summary : null }
  } catch {
    return empty
  }
}

export function researchRunView(row: ResearchRunRow, laneCheckpoints?: ResearchLaneCheckpointRow[]): ResearchRunView {
  return {
    ...row,
    candidateIds: parseJsonArray(row.candidate_ids_json).filter((value): value is string => typeof value === 'string'),
    evidence: parseJsonArray(row.evidence_json).flatMap((value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return []
      const item = value as Record<string, unknown>
      if (typeof item.candidate_id !== 'string' || !Array.isArray(item.urls)) return []
      const urls = item.urls.filter((url): url is string => typeof url === 'string')
      return urls.length > 0 ? [{ candidate_id: item.candidate_id, urls }] : []
    }),
    diagnostics: parseResearchDiagnostics(row.diagnostics_json),
    lanes: (laneCheckpoints ?? []).map(laneCheckpointView),
  }
}

export function laneCheckpointView(row: ResearchLaneCheckpointRow): LaneProgressView {
  let rateLimitDiagnostics: Record<string, unknown> = {}
  try {
    const parsed: unknown = JSON.parse(row.rate_limit_diagnostics_json)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      rateLimitDiagnostics = parsed as Record<string, unknown>
    }
  } catch { /* empty */ }
  return {
    lane: row.lane,
    status: row.status,
    attempts: row.attempts,
    next_retry_at: row.next_retry_at,
    request_id: row.request_id,
    rate_limit_diagnostics: rateLimitDiagnostics,
  }
}

export async function getResearchRun(db: D1Database, id: string): Promise<ResearchRunRow | null> {
  return db.prepare('SELECT * FROM research_runs WHERE id = ?').bind(id).first<ResearchRunRow>()
}

export async function listResearchRuns(db: D1Database, limit = 20): Promise<ResearchRunRow[]> {
  const result = await db.prepare('SELECT * FROM research_runs ORDER BY created_at DESC LIMIT ?')
    .bind(limit)
    .all<ResearchRunRow>()
  return result.results
}

export async function createOrGetResearchRun(
  db: D1Database,
  input: { requestKey: string; trigger: ResearchTrigger; model: string; now: string },
): Promise<{ run: ResearchRunRow; created: boolean }> {
  const existing = await db.prepare(`
    SELECT * FROM research_runs
    WHERE status IN ('queued', 'running', 'paused_rate_limit', 'finalizing')
    ORDER BY created_at DESC LIMIT 1
  `).first<ResearchRunRow>()
  if (existing) return { run: existing, created: false }

  const id = `research_${crypto.randomUUID()}`
  const result = await db.prepare(`
    INSERT OR IGNORE INTO research_runs (
      id, request_key, trigger_type, status, model, prompt_version, created_at
    ) VALUES (?, ?, ?, 'queued', ?, 'consumer-products-v2', ?)
  `).bind(id, input.requestKey, input.trigger, input.model, input.now).run()
  if (result.meta.changes > 0) {
    const run = await getResearchRun(db, id)
    if (run) return { run, created: true }
  }
  const fallback = await db.prepare(`
    SELECT * FROM research_runs
    WHERE request_key = ? OR status IN ('queued', 'running', 'paused_rate_limit', 'finalizing')
    ORDER BY created_at DESC LIMIT 1
  `).bind(input.requestKey).first<ResearchRunRow>()
  if (!fallback) throw new Error('Research run was not persisted')
  return { run: fallback, created: false }
}

export type ResearchRunClaim = 'claimed' | 'completed' | 'busy'

export async function claimResearchRun(db: D1Database, id: string, now: string, leaseUntil: string): Promise<ResearchRunClaim> {
  const claimed = await db.prepare(`
    UPDATE research_runs
    SET status = 'running', started_at = COALESCE(started_at, ?), lease_until = ?
    WHERE id = ?
      AND (status = 'queued' OR (status = 'running' AND lease_until <= ?) OR status = 'paused_rate_limit')
    RETURNING id
  `).bind(now, leaseUntil, id, now).first<{ id: string }>()
  if (claimed) return 'claimed'
  const existing = await getResearchRun(db, id)
  return existing?.status === 'succeeded' || existing?.status === 'failed' ? 'completed' : 'busy'
}

export async function completeResearchRun(
  db: D1Database,
  id: string,
  input: {
    now: string
    received: number
    accepted: number
    duplicates: number
    rejected: number
    candidateIds: string[]
    evidence: Array<{ candidate_id: string; urls: string[] }>
    diagnostics: ResearchRunDiagnostics
  },
): Promise<void> {
  await db.prepare(`
    UPDATE research_runs
    SET status = 'succeeded', completed_at = ?, lease_until = NULL,
        received_count = ?, accepted_count = ?, duplicate_count = ?, rejected_count = ?,
        candidate_ids_json = ?, evidence_json = ?, diagnostics_json = ?, error_code = NULL
    WHERE id = ? AND status IN ('running', 'finalizing')
  `).bind(
    input.now,
    input.received,
    input.accepted,
    input.duplicates,
    input.rejected,
    JSON.stringify(input.candidateIds),
    JSON.stringify(input.evidence),
    JSON.stringify(input.diagnostics),
    id,
  ).run()
}

export async function failResearchRun(db: D1Database, id: string, errorCode: string, now: string, retryable: boolean): Promise<void> {
  await db.prepare(`
    UPDATE research_runs
    SET status = ?, completed_at = CASE WHEN ? THEN completed_at ELSE ? END,
        lease_until = CASE WHEN ? THEN NULL ELSE ? END, error_code = ?
    WHERE id = ? AND status IN ('queued', 'running', 'paused_rate_limit', 'finalizing')
  `).bind(retryable ? 'queued' : 'failed', retryable ? 1 : 0, now, retryable ? 1 : 0, retryable ? null : null, errorCode, id).run()
}

/** Marks an active run terminal. A queue delivery already in flight will observe this before ingestion. */
export async function cancelResearchRun(db: D1Database, id: string, now: string): Promise<ResearchRunRow | null> {
  const cancelled = await db.prepare(`
    UPDATE research_runs
    SET status = 'failed', completed_at = ?, lease_until = NULL, error_code = 'RESEARCH_RUN_CANCELLED'
    WHERE id = ? AND status IN ('queued', 'running', 'paused_rate_limit', 'finalizing')
    RETURNING *
  `).bind(now, id).first<ResearchRunRow>()
  return cancelled ?? null
}

export async function deleteQueuedResearchRun(db: D1Database, id: string): Promise<void> {
  await db.prepare("DELETE FROM research_runs WHERE id = ? AND status = 'queued'").bind(id).run()
}

export async function cleanupRetention(
  db: D1Database,
  evidenceBefore: string,
  changeLogBefore: string,
  candidateBefore: string,
  activeAt: string,
): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM viral_signals WHERE expires_at < ?').bind(evidenceBefore),
    db.prepare('DELETE FROM score_snapshots WHERE computed_at < ?').bind(evidenceBefore),
    db.prepare(`DELETE FROM source_runs WHERE completed_at IS NOT NULL AND completed_at < ?`).bind(evidenceBefore),
    db.prepare('DELETE FROM source_poll_jobs WHERE updated_at < ?').bind(evidenceBefore),
    db.prepare("DELETE FROM research_runs WHERE completed_at IS NOT NULL AND completed_at < ?").bind(evidenceBefore),
    db.prepare('DELETE FROM change_log WHERE occurred_at < ?').bind(changeLogBefore),
    db.prepare(`
      DELETE FROM candidates
      WHERE last_seen_at < ?
        AND id NOT IN (SELECT candidate_id FROM catalog_links)
        AND id NOT IN (SELECT candidate_id FROM patch_operations)
        AND NOT EXISTS (
          SELECT 1 FROM viral_signals v
          WHERE v.candidate_id = candidates.id AND v.expires_at > ?
        )
    `).bind(candidateBefore, activeAt),
  ])
}

export async function cleanupCronRuns(db: D1Database, before: string): Promise<void> {
  await db.prepare('DELETE FROM cron_runs WHERE claimed_at < ?').bind(before).run()
}

export async function listChanges(db: D1Database, after: number, limit: number): Promise<ChangeLogRow[]> {
  const result = await db.prepare(`
    SELECT sequence_number, event_type, entity_id, occurred_at, payload_json
    FROM change_log
    WHERE sequence_number > ?
    ORDER BY sequence_number
    LIMIT ?
  `).bind(after, limit).all<ChangeLogRow>()
  return result.results
}

// ---------------------------------------------------------------------------
// Lane checkpoint APIs
// ---------------------------------------------------------------------------

const RESEARCH_LANES: ResearchLane[] = ['social', 'search_demand', 'commerce', 'trend_media']

export async function createLaneCheckpoints(db: D1Database, runId: string, now: string): Promise<void> {
  await db.batch(
    RESEARCH_LANES.map((lane) =>
      db.prepare(`
        INSERT OR IGNORE INTO research_lane_checkpoints (run_id, lane, status, attempts, updated_at)
        VALUES (?, ?, 'pending', 0, ?)
      `).bind(runId, lane, now),
    ),
  )
}

export async function getLaneCheckpoint(
  db: D1Database,
  runId: string,
  lane: ResearchLane,
): Promise<ResearchLaneCheckpointRow | null> {
  return db.prepare('SELECT * FROM research_lane_checkpoints WHERE run_id = ? AND lane = ?')
    .bind(runId, lane).first<ResearchLaneCheckpointRow>()
}

export async function getLaneCheckpoints(db: D1Database, runId: string): Promise<ResearchLaneCheckpointRow[]> {
  const result = await db.prepare('SELECT * FROM research_lane_checkpoints WHERE run_id = ? ORDER BY lane')
    .bind(runId).all<ResearchLaneCheckpointRow>()
  return result.results
}

export type LaneClaimResult = 'claimed' | 'completed' | 'busy'

export async function claimLaneCheckpoint(
  db: D1Database,
  runId: string,
  lane: ResearchLane,
  now: string,
  leaseUntil: string,
): Promise<LaneClaimResult> {
  const claimed = await db.prepare(`
    UPDATE research_lane_checkpoints
    SET status = 'running', lease_until = ?, updated_at = ?
    WHERE run_id = ? AND lane = ?
      AND (status = 'pending' OR (status = 'retry_wait' AND (next_retry_at IS NULL OR next_retry_at <= ?)))
      AND NOT EXISTS (
        SELECT 1 FROM research_lane_checkpoints
        WHERE run_id = ? AND status = 'running'
      )
    RETURNING run_id
  `).bind(leaseUntil, now, runId, lane, now, runId).first<{ run_id: string }>()
  if (claimed) return 'claimed'
  const existing = await getLaneCheckpoint(db, runId, lane)
  return existing?.status === 'succeeded' || existing?.status === 'failed' ? 'completed' : 'busy'
}

export async function completeLaneCheckpoint(
  db: D1Database,
  runId: string,
  lane: ResearchLane,
  input: {
    candidatesJson: string
    evidenceJson: string
    diagnosticsJson: string
    requestId: string | null
    usageJson: string
    rateLimitDiagnosticsJson: string
    now: string
  },
): Promise<void> {
  await db.prepare(`
    UPDATE research_lane_checkpoints
    SET status = 'succeeded', candidates_json = ?, evidence_json = ?, diagnostics_json = ?,
        request_id = ?, usage_json = ?, rate_limit_diagnostics_json = ?,
        lease_until = NULL, next_retry_at = NULL, completed_at = ?, updated_at = ?
    WHERE run_id = ? AND lane = ? AND status = 'running'
  `).bind(
    input.candidatesJson,
    input.evidenceJson,
    input.diagnosticsJson,
    input.requestId,
    input.usageJson,
    input.rateLimitDiagnosticsJson,
    input.now,
    input.now,
    runId,
    lane,
  ).run()
}

export async function setLaneRetryWait(
  db: D1Database,
  runId: string,
  lane: ResearchLane,
  nextRetryAt: string,
  rateLimitDiagnosticsJson: string,
  now: string,
): Promise<void> {
  await db.prepare(`
    UPDATE research_lane_checkpoints
    SET status = 'retry_wait', next_retry_at = ?, rate_limit_diagnostics_json = ?,
        lease_until = NULL, attempts = attempts + 1, updated_at = ?
    WHERE run_id = ? AND lane = ? AND status = 'running'
  `).bind(nextRetryAt, rateLimitDiagnosticsJson, now, runId, lane).run()
}

export async function failLaneCheckpoint(
  db: D1Database,
  runId: string,
  lane: ResearchLane,
  errorCode: string,
  now: string,
): Promise<void> {
  await db.prepare(`
    UPDATE research_lane_checkpoints
    SET status = 'failed', lease_until = NULL, next_retry_at = NULL,
        diagnostics_json = json_set(diagnostics_json, '$.error_code', ?), updated_at = ?
    WHERE run_id = ? AND lane = ? AND status NOT IN ('succeeded', 'failed')
  `).bind(errorCode, now, runId, lane).run()
}

export async function getIncompleteLanes(db: D1Database, runId: string): Promise<ResearchLaneCheckpointRow[]> {
  const result = await db.prepare(`
    SELECT * FROM research_lane_checkpoints
    WHERE run_id = ? AND status != 'succeeded'
    ORDER BY CASE lane
      WHEN 'social' THEN 0
      WHEN 'search_demand' THEN 1
      WHEN 'commerce' THEN 2
      WHEN 'trend_media' THEN 3
    END
  `).bind(runId).all<ResearchLaneCheckpointRow>()
  return result.results
}

export async function getNextLaneToRun(db: D1Database, runId: string, now: string): Promise<ResearchLane | null> {
  const row = await db.prepare(`
    SELECT lane FROM research_lane_checkpoints
    WHERE run_id = ?
      AND (status = 'pending' OR (status = 'retry_wait' AND (next_retry_at IS NULL OR next_retry_at <= ?)))
    ORDER BY CASE lane
      WHEN 'social' THEN 0
      WHEN 'search_demand' THEN 1
      WHEN 'commerce' THEN 2
      WHEN 'trend_media' THEN 3
    END
    LIMIT 1
  `).bind(runId, now).first<{ lane: ResearchLane }>()
  return row?.lane ?? null
}

export async function releaseStaleLaneLeases(db: D1Database, now: string): Promise<void> {
  await db.prepare(`
    UPDATE research_lane_checkpoints
    SET status = CASE
      WHEN next_retry_at IS NOT NULL AND next_retry_at > ? THEN 'retry_wait'
      ELSE 'pending'
    END,
    lease_until = NULL,
    updated_at = ?
    WHERE status = 'running' AND lease_until IS NOT NULL AND lease_until < ?
  `).bind(now, now, now).run()
}

export async function pauseResearchRun(db: D1Database, runId: string): Promise<void> {
  await db.prepare(`
    UPDATE research_runs
    SET status = 'paused_rate_limit', lease_until = NULL
    WHERE id = ? AND status IN ('running', 'queued')
  `).bind(runId).run()
}

export async function resumeResearchRun(db: D1Database, runId: string): Promise<ResearchRunRow | null> {
  const resumed = await db.prepare(`
    UPDATE research_runs
    SET status = 'queued', lease_until = NULL
    WHERE id = ? AND status = 'paused_rate_limit'
    RETURNING *
  `).bind(runId).first<ResearchRunRow>()
  return resumed ?? null
}

export async function claimFinalize(db: D1Database, runId: string): Promise<boolean> {
  const claimed = await db.prepare(`
    UPDATE research_runs
    SET status = 'finalizing'
    WHERE id = ?
      AND status IN ('running', 'queued', 'paused_rate_limit')
      AND NOT EXISTS (
        SELECT 1 FROM research_lane_checkpoints
        WHERE run_id = ? AND status != 'succeeded'
      )
    RETURNING id
  `).bind(runId, runId).first<{ id: string }>()
  return !!claimed
}

export async function resumeResearchRunToRunning(db: D1Database, runId: string, now: string, leaseUntil: string): Promise<void> {
  await db.prepare(`
    UPDATE research_runs
    SET status = 'running', started_at = COALESCE(started_at, ?), lease_until = ?
    WHERE id = ? AND status IN ('queued', 'running', 'paused_rate_limit')
  `).bind(now, leaseUntil, runId).run()
}

export async function getPausedRunForResume(db: D1Database, now: string): Promise<ResearchRunRow | null> {
  return db.prepare(`
    SELECT r.* FROM research_runs r
    WHERE r.status = 'paused_rate_limit'
      AND EXISTS (
        SELECT 1 FROM research_lane_checkpoints c
        WHERE c.run_id = r.id
          AND c.status = 'retry_wait'
          AND (c.next_retry_at IS NULL OR c.next_retry_at <= ?)
      )
      AND r.created_at > datetime(?, '-6 hours')
    ORDER BY r.created_at ASC
    LIMIT 1
  `).bind(now, now).first<ResearchRunRow>()
}

export async function getOldestPausedRun(db: D1Database): Promise<ResearchRunRow | null> {
  return db.prepare(`
    SELECT * FROM research_runs
    WHERE status = 'paused_rate_limit'
    ORDER BY created_at ASC
    LIMIT 1
  `).first<ResearchRunRow>()
}

export async function reconcileStaleResearchRuns(db: D1Database, now: string): Promise<Array<{ runId: string; lane: ResearchLane }>> {
  const stale = await db.prepare(`
    SELECT * FROM research_runs
    WHERE status IN ('running', 'paused_rate_limit', 'finalizing')
      AND lease_until IS NOT NULL AND lease_until < ?
    ORDER BY created_at ASC
  `).bind(now).all<ResearchRunRow>()

  const reEnqueued: Array<{ runId: string; lane: ResearchLane }> = []
  for (const run of stale.results) {
    const deadline = new Date(run.created_at)
    deadline.setHours(deadline.getHours() + 6)
    if (new Date(now) > deadline) {
      await db.prepare(`
        UPDATE research_runs
        SET status = 'failed', completed_at = ?, lease_until = NULL,
            error_code = 'RESEARCH_DEADLINE_EXCEEDED'
        WHERE id = ?
      `).bind(now, run.id).run()
      continue
    }
    await db.prepare(`
      UPDATE research_runs
      SET status = 'queued', lease_until = NULL
      WHERE id = ?
    `).bind(run.id).run()
    const nextLane = await getNextLaneToRun(db, run.id, now)
    if (nextLane) {
      reEnqueued.push({ runId: run.id, lane: nextLane })
    }
  }
  return reEnqueued
}

export interface EngineSettingsRow {
  max_output_tokens: number
  max_candidates_per_lane: number
  search_context_size: string
  reasoning_effort: string
  model: string
  updated_at: string
}

export async function getEngineSettings(db: D1Database): Promise<EngineSettingsRow> {
  const row = await db.prepare('SELECT max_output_tokens, max_candidates_per_lane, search_context_size, reasoning_effort, model, updated_at FROM engine_settings WHERE id = 1').first<EngineSettingsRow>()
  if (!row) {
    return { max_output_tokens: 3000, max_candidates_per_lane: 2, search_context_size: 'low', reasoning_effort: 'medium', model: 'gpt-5-mini', updated_at: '1970-01-01T00:00:00.000Z' }
  }
  return row
}

export async function updateEngineSettings(db: D1Database, input: { max_output_tokens: number; max_candidates_per_lane: number; search_context_size: string; reasoning_effort: string; model: string }, now: string): Promise<EngineSettingsRow> {
  await db.prepare(`
    UPDATE engine_settings
    SET max_output_tokens = ?, max_candidates_per_lane = ?, search_context_size = ?, reasoning_effort = ?, model = ?, updated_at = ?
    WHERE id = 1
  `).bind(
    input.max_output_tokens,
    input.max_candidates_per_lane,
    input.search_context_size,
    input.reasoning_effort,
    input.model,
    now,
  ).run()
  return getEngineSettings(db)
}
