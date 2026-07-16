import {
  type SourceRow,
  type ViralSignalBatchV1,
  type ViralSignalV1,
} from './domain'
import { EngineError, errorCode } from './errors'
import { canonicalJson, candidateIdentityKey, normalizeGtin, sha256Hex, slugify, stableId } from './identity'
import {
  getAliasCandidateId,
  getCurrentScore,
  getSource,
  listCandidateIds,
  listScoreSignals,
  saveScore,
} from './repository'
import { computeScore } from './scoring'

type TriggerType = 'push' | 'scheduled' | 'manual'

export interface IngestionResult {
  received: number
  accepted: number
  duplicates: number
  candidateIds: string[]
}

interface RunCounter {
  sourceId: string
  externalRunId: string
  runId: string
  received: number
  accepted: number
  duplicates: number
}

function nullable(value: string | undefined): string | null {
  return value ?? null
}

function catalogUrlIsVerified(source: SourceRow, value: string | undefined): boolean {
  if (!value) return false
  let allowed: string[]
  try {
    const parsed: unknown = JSON.parse(source.catalog_host_allowlist_json)
    allowed = Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : []
  } catch {
    return false
  }
  const hostname = new URL(value).hostname.toLowerCase()
  return allowed.some((pattern) => pattern.startsWith('*.')
    ? hostname.endsWith(pattern.slice(1)) && hostname.length > pattern.length - 1
    : hostname === pattern)
}

async function resolveCandidateId(db: D1Database, signal: ViralSignalV1): Promise<{ id: string; identityKey: string }> {
  const alias = await getAliasCandidateId(db, signal.source, signal.candidate.external_id)
  const identityKey = candidateIdentityKey(signal)
  if (alias) return { id: alias, identityKey }
  return { id: await stableId('candidate', identityKey), identityKey }
}

async function persistSignal(
  db: D1Database,
  signal: ViralSignalV1,
  source: SourceRow,
  receivedAt: string,
): Promise<{ candidateId: string; accepted: boolean }> {
  const { id: candidateId, identityKey } = await resolveCandidateId(db, signal)
  const signalId = await stableId('signal', `${signal.source}:${signal.external_observation_id}`)
  const evidenceHash = signal.evidence_hash ?? `sha256:${await sha256Hex(canonicalJson(signal))}`
  const normalizedSignal: ViralSignalV1 = { ...signal, evidence_hash: evidenceHash }
  const payloadJson = canonicalJson(normalizedSignal)
  const topicSlug = slugify(signal.candidate.topic.slug ?? signal.candidate.topic.name)
  const productSlug = slugify(signal.candidate.name)
  const gtin = normalizeGtin(signal.candidate.gtin)
  const productUrlVerified = catalogUrlIsVerified(source, signal.candidate.product_url)

  const existing = await db.prepare(`
    SELECT candidate_id
    FROM viral_signals
    WHERE source_id = ? AND external_observation_id = ?
  `).bind(signal.source, signal.external_observation_id).first<{ candidate_id: string }>()
  if (existing) return { candidateId: existing.candidate_id, accepted: false }

  const results = await db.batch([
    db.prepare(`
      INSERT INTO candidates (
        id, identity_key, name, slug_suggestion, brand, gtin, category,
        topic_name, topic_slug, topic_description, product_url, product_url_verified, image_url,
        search_terms_json, availability_status, release_date,
        metadata_trust_weight, first_seen_at, last_seen_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = CASE WHEN excluded.metadata_trust_weight > candidates.metadata_trust_weight
          OR (excluded.metadata_trust_weight = candidates.metadata_trust_weight AND excluded.last_seen_at >= candidates.last_seen_at)
          THEN excluded.name ELSE candidates.name END,
        slug_suggestion = CASE WHEN excluded.metadata_trust_weight > candidates.metadata_trust_weight
          OR (excluded.metadata_trust_weight = candidates.metadata_trust_weight AND excluded.last_seen_at >= candidates.last_seen_at)
          THEN excluded.slug_suggestion ELSE candidates.slug_suggestion END,
        brand = CASE WHEN excluded.brand IS NOT NULL AND (excluded.metadata_trust_weight > candidates.metadata_trust_weight
          OR (excluded.metadata_trust_weight = candidates.metadata_trust_weight AND excluded.last_seen_at >= candidates.last_seen_at))
          THEN excluded.brand ELSE candidates.brand END,
        gtin = COALESCE(candidates.gtin, excluded.gtin),
        category = CASE WHEN excluded.category IS NOT NULL AND (excluded.metadata_trust_weight > candidates.metadata_trust_weight
          OR (excluded.metadata_trust_weight = candidates.metadata_trust_weight AND excluded.last_seen_at >= candidates.last_seen_at))
          THEN excluded.category ELSE candidates.category END,
        topic_name = CASE WHEN excluded.metadata_trust_weight > candidates.metadata_trust_weight
          OR (excluded.metadata_trust_weight = candidates.metadata_trust_weight AND excluded.last_seen_at >= candidates.last_seen_at)
          THEN excluded.topic_name ELSE candidates.topic_name END,
        topic_slug = CASE WHEN excluded.metadata_trust_weight > candidates.metadata_trust_weight
          OR (excluded.metadata_trust_weight = candidates.metadata_trust_weight AND excluded.last_seen_at >= candidates.last_seen_at)
          THEN excluded.topic_slug ELSE candidates.topic_slug END,
        topic_description = CASE WHEN excluded.topic_description IS NOT NULL AND (excluded.metadata_trust_weight > candidates.metadata_trust_weight
          OR (excluded.metadata_trust_weight = candidates.metadata_trust_weight AND excluded.last_seen_at >= candidates.last_seen_at))
          THEN excluded.topic_description ELSE candidates.topic_description END,
        product_url = CASE WHEN excluded.product_url IS NOT NULL AND (
          excluded.product_url_verified > candidates.product_url_verified
          OR (excluded.product_url_verified = candidates.product_url_verified AND (
            excluded.metadata_trust_weight > candidates.metadata_trust_weight
            OR (excluded.metadata_trust_weight = candidates.metadata_trust_weight AND excluded.last_seen_at >= candidates.last_seen_at)
          )))
          THEN excluded.product_url ELSE candidates.product_url END,
        product_url_verified = CASE WHEN excluded.product_url IS NOT NULL AND (
          excluded.product_url_verified > candidates.product_url_verified
          OR (excluded.product_url_verified = candidates.product_url_verified AND (
            excluded.metadata_trust_weight > candidates.metadata_trust_weight
            OR (excluded.metadata_trust_weight = candidates.metadata_trust_weight AND excluded.last_seen_at >= candidates.last_seen_at)
          )))
          THEN excluded.product_url_verified ELSE candidates.product_url_verified END,
        image_url = CASE WHEN excluded.image_url IS NOT NULL AND (excluded.metadata_trust_weight > candidates.metadata_trust_weight
          OR (excluded.metadata_trust_weight = candidates.metadata_trust_weight AND excluded.last_seen_at >= candidates.last_seen_at))
          THEN excluded.image_url ELSE candidates.image_url END,
        search_terms_json = CASE WHEN excluded.search_terms_json <> '[]' AND (excluded.metadata_trust_weight > candidates.metadata_trust_weight
          OR (excluded.metadata_trust_weight = candidates.metadata_trust_weight AND excluded.last_seen_at >= candidates.last_seen_at))
          THEN excluded.search_terms_json ELSE candidates.search_terms_json END,
        availability_status = CASE WHEN excluded.availability_status IS NOT NULL AND (excluded.metadata_trust_weight > candidates.metadata_trust_weight
          OR (excluded.metadata_trust_weight = candidates.metadata_trust_weight AND excluded.last_seen_at >= candidates.last_seen_at))
          THEN excluded.availability_status ELSE candidates.availability_status END,
        release_date = CASE WHEN excluded.release_date IS NOT NULL AND (excluded.metadata_trust_weight > candidates.metadata_trust_weight
          OR (excluded.metadata_trust_weight = candidates.metadata_trust_weight AND excluded.last_seen_at >= candidates.last_seen_at))
          THEN excluded.release_date ELSE candidates.release_date END,
        metadata_trust_weight = MAX(candidates.metadata_trust_weight, excluded.metadata_trust_weight),
        last_seen_at = MAX(candidates.last_seen_at, excluded.last_seen_at),
        updated_at = excluded.updated_at
      WHERE NOT EXISTS (
        SELECT 1 FROM viral_signals WHERE source_id = ? AND external_observation_id = ?
      )
    `).bind(
      candidateId,
      identityKey,
      signal.candidate.name,
      productSlug,
      nullable(signal.candidate.brand),
      gtin,
      nullable(signal.candidate.category),
      signal.candidate.topic.name,
      topicSlug,
      nullable(signal.candidate.topic.description),
      nullable(signal.candidate.product_url),
      productUrlVerified ? 1 : 0,
      nullable(signal.candidate.image_url),
      JSON.stringify(signal.candidate.search_terms ?? []),
      nullable(signal.candidate.availability_status),
      nullable(signal.candidate.release_date),
      source.trust_weight,
      signal.observed_at,
      signal.observed_at,
      receivedAt,
      receivedAt,
      signal.source,
      signal.external_observation_id,
    ),
    db.prepare(`
      INSERT INTO candidate_aliases (source_id, external_id, candidate_id, first_seen_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(source_id, external_id) DO UPDATE SET
        last_seen_at = MAX(candidate_aliases.last_seen_at, excluded.last_seen_at)
      WHERE NOT EXISTS (
        SELECT 1 FROM viral_signals WHERE source_id = ? AND external_observation_id = ?
      )
    `).bind(
      signal.source,
      signal.candidate.external_id,
      candidateId,
      signal.observed_at,
      signal.observed_at,
      signal.source,
      signal.external_observation_id,
    ),
    db.prepare(`
      INSERT OR IGNORE INTO viral_signals (
        id, source_id, source_run_id, external_observation_id, candidate_id,
        observed_at, expires_at, signal_type, signal_value, velocity,
        rank_value, previous_rank, sample_size, confidence, evidence_url,
        evidence_hash, payload_json, received_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      signalId,
      source.id,
      signal.source_run_id,
      signal.external_observation_id,
      candidateId,
      signal.observed_at,
      signal.expires_at,
      signal.signal.type,
      signal.signal.value,
      signal.signal.velocity ?? null,
      signal.signal.rank ?? null,
      signal.signal.previous_rank ?? null,
      signal.signal.sample_size ?? null,
      signal.confidence,
      signal.evidence_url,
      evidenceHash,
      payloadJson,
      receivedAt,
    ),
  ])

  return { candidateId, accepted: (results[2]?.meta.changes ?? 0) > 0 }
}

export async function recomputeCandidate(db: D1Database, candidateId: string, now = new Date()): Promise<void> {
  const [signals, previous] = await Promise.all([
    listScoreSignals(db, candidateId, now.toISOString()),
    getCurrentScore(db, candidateId),
  ])
  const snapshot = computeScore(signals, previous, now)
  await saveScore(db, crypto.randomUUID(), candidateId, snapshot)
}

export async function recomputeAllCandidates(db: D1Database, now = new Date(), limit = 10): Promise<number> {
  const candidateIds = await listCandidateIds(db, limit)
  for (const candidateId of candidateIds) await recomputeCandidate(db, candidateId, now)
  return candidateIds.length
}

export async function ingestSignalBatch(
  db: D1Database,
  batch: ViralSignalBatchV1,
  triggerType: TriggerType,
  now = new Date(),
): Promise<IngestionResult> {
  const receivedAt = now.toISOString()
  const sources = new Map<string, SourceRow>()
  for (const sourceId of new Set(batch.records.map((record) => record.source))) {
    const source = await getSource(db, sourceId)
    if (!source) throw new EngineError('SOURCE_NOT_REGISTERED', `Source ${sourceId} is not registered.`, 409)
    if (source.enabled !== 1) throw new EngineError('SOURCE_DISABLED', `Source ${sourceId} is disabled.`, 409)
    sources.set(sourceId, source)
  }

  const counters = new Map<string, RunCounter>()
  for (const record of batch.records) {
    const key = `${record.source}\u0000${record.source_run_id}`
    if (!counters.has(key)) {
      counters.set(key, {
        sourceId: record.source,
        externalRunId: record.source_run_id,
        runId: await stableId('run', key),
        received: 0,
        accepted: 0,
        duplicates: 0,
      })
    }
    const counter = counters.get(key)
    if (counter) counter.received += 1
  }

  for (const counter of counters.values()) {
    await db.prepare(`
      INSERT INTO source_runs (
        id, source_id, external_run_id, trigger_type, status, started_at, received_count
      ) VALUES (?, ?, ?, ?, 'running', ?, ?)
      ON CONFLICT(source_id, external_run_id) DO UPDATE SET
        received_count = MAX(source_runs.received_count, excluded.received_count)
    `).bind(
      counter.runId,
      counter.sourceId,
      counter.externalRunId,
      triggerType,
      receivedAt,
      counter.received,
    ).run()
  }

  const changedCandidates = new Set<string>()
  try {
    for (const record of batch.records) {
      const source = sources.get(record.source)
      if (!source) throw new EngineError('SOURCE_NOT_REGISTERED', `Source ${record.source} is not registered.`, 409)
      const result = await persistSignal(db, record, source, receivedAt)
      const counter = counters.get(`${record.source}\u0000${record.source_run_id}`)
      if (result.accepted) {
        changedCandidates.add(result.candidateId)
        if (counter) counter.accepted += 1
      } else if (counter) {
        counter.duplicates += 1
      }
    }

    for (const candidateId of changedCandidates) await recomputeCandidate(db, candidateId, now)

    for (const counter of counters.values()) {
      await db.prepare(`
        UPDATE source_runs
        SET status = 'completed', completed_at = ?,
            accepted_count = MAX(accepted_count, ?),
            duplicate_count = MAX(duplicate_count, ?),
            error_code = NULL
        WHERE id = ?
      `).bind(receivedAt, counter.accepted, counter.duplicates, counter.runId).run()
    }
  } catch (error) {
    await Promise.allSettled(Array.from(counters.values(), (counter) => db.prepare(`
      UPDATE source_runs
      SET status = 'failed', completed_at = ?, error_code = ?
      WHERE id = ?
    `).bind(receivedAt, errorCode(error), counter.runId).run()))
    throw error
  }

  const accepted = Array.from(counters.values()).reduce((sum, counter) => sum + counter.accepted, 0)
  const duplicates = Array.from(counters.values()).reduce((sum, counter) => sum + counter.duplicates, 0)
  return {
    received: batch.records.length,
    accepted,
    duplicates,
    candidateIds: Array.from(changedCandidates),
  }
}
