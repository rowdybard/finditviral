import {
  AVAILABILITY_STATUSES,
  CANDIDATE_STATES,
  ENGINE_MODES,
  PATCH_ACTIONS,
  PATCH_SCHEMA_VERSION,
  PATCH_POLICY_VERSION,
  SCORE_VERSION,
  type CandidateProjectionRow,
  type CatalogOverrides,
  type CatalogPatchOperationV1,
  type CatalogPatchV1,
  type EngineMode,
} from './domain'
import { EngineError } from './errors'
import { canonicalJson, sha256Hex, slugify, stableId } from './identity'
import {
  AUTOPILOT_MIN_CONFIDENCE,
  AUTOPILOT_MIN_SCORE,
  AUTOPILOT_MIN_SOURCES,
  evaluatePatchPolicy,
  MAX_SCORE_AGE_MS,
} from './policy'
import { listEvidenceUrls, listPatchCandidates } from './repository'

interface PatchRow {
  id: string
  mode: EngineMode
  status: 'building' | 'draft' | 'ready' | 'exported' | 'applied' | 'failed' | 'superseded'
  trigger_type: 'scheduled' | 'manual'
  target: 'finditviral'
  score_version: string
  checksum: string | null
  manifest_json: string | null
  operation_count: number
  created_at: string
  finalized_at: string | null
  exported_at: string | null
  applied_at: string | null
  error_code: string | null
  delivery_token: string | null
  lease_until: string | null
  export_attempts: number
}

interface ClaimResult {
  candidate: CandidateProjectionRow
  evidence: string[]
}

export interface PatchGenerationResult {
  patch: CatalogPatchV1 | null
  status: 'draft' | 'ready' | null
  skipped: Array<{ candidate_id: string; reasons: string[] }>
}

export interface PatchDelivery {
  patch: CatalogPatchV1
  deliveryToken: string
  leaseExpiresAt: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseStringArray(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function parseOverrides(value: string | null): CatalogOverrides {
  if (!value) return {}
  try {
    const parsed: unknown = JSON.parse(value)
    if (!isRecord(parsed)) return {}
    const overrides: CatalogOverrides = {}
    if (typeof parsed.trend_name === 'string') overrides.trend_name = parsed.trend_name
    if (typeof parsed.trend_slug === 'string') overrides.trend_slug = parsed.trend_slug
    if (parsed.trend_description === null || typeof parsed.trend_description === 'string') {
      overrides.trend_description = parsed.trend_description
    }
    if (typeof parsed.product_name === 'string') overrides.product_name = parsed.product_name
    if (typeof parsed.product_slug === 'string') overrides.product_slug = parsed.product_slug
    if (parsed.brand === null || typeof parsed.brand === 'string') overrides.brand = parsed.brand
    if (parsed.category === null || typeof parsed.category === 'string') overrides.category = parsed.category
    if (isStringArray(parsed.search_terms)) overrides.search_terms = parsed.search_terms
    if (isAvailabilityStatus(parsed.availability_status)) overrides.availability_status = parsed.availability_status
    if (parsed.release_date === null || typeof parsed.release_date === 'string') overrides.release_date = parsed.release_date
    if (isHttpsUrl(parsed.source_url)) overrides.source_url = parsed.source_url
    return overrides
  } catch {
    return {}
  }
}

function withOverrides(candidate: CandidateProjectionRow): CandidateProjectionRow {
  const overrides = parseOverrides(candidate.review_overrides_json)
  return {
    ...candidate,
    name: overrides.product_name ?? candidate.name,
    slug_suggestion: overrides.product_slug ?? candidate.slug_suggestion,
    brand: overrides.brand === undefined ? candidate.brand : overrides.brand,
    category: overrides.category === undefined ? candidate.category : overrides.category,
    topic_name: overrides.trend_name ?? candidate.topic_name,
    topic_slug: overrides.trend_slug ?? candidate.topic_slug,
    topic_description: overrides.trend_description === undefined ? candidate.topic_description : overrides.trend_description,
    product_url: overrides.source_url ?? candidate.product_url,
    product_url_verified: candidate.review_status === 'approved' && (overrides.source_url || candidate.product_url)
      ? 1
      : candidate.product_url_verified,
    search_terms_json: overrides.search_terms ? JSON.stringify(overrides.search_terms) : candidate.search_terms_json,
    availability_status: overrides.availability_status ?? candidate.availability_status,
    release_date: overrides.release_date === undefined ? candidate.release_date : overrides.release_date,
  }
}

function patchStatusForMode(mode: EngineMode): 'draft' | 'ready' {
  return mode === 'shadow' ? 'draft' : 'ready'
}

async function claimCandidate(
  db: D1Database,
  patchId: string,
  candidateId: string,
  now: string,
): Promise<boolean> {
  const result = await db.prepare(`
    INSERT OR IGNORE INTO patch_candidate_claims (candidate_id, action, patch_id, claimed_at)
    VALUES (?, 'add_product', ?, ?)
  `).bind(candidateId, patchId, now).run()
  return result.meta.changes > 0
}

function reasonFor(candidate: CandidateProjectionRow, evidence: string[]): CatalogPatchOperationV1['reason'] {
  return {
    score: candidate.score ?? 0,
    confidence: candidate.score_confidence ?? 0,
    state: candidate.state ?? 'candidate',
    policy_version: PATCH_POLICY_VERSION,
    evidence_urls: evidence,
  }
}

async function buildOperations(
  patchId: string,
  claimed: ClaimResult[],
): Promise<CatalogPatchOperationV1[]> {
  const operations: CatalogPatchOperationV1[] = []
  const topicOperationIds = new Map<string, string>()

  for (const item of claimed) {
    const candidate = item.candidate
    if (!candidate.availability_status) {
      throw new EngineError('PATCH_CANDIDATE_INCOMPLETE', `Candidate ${candidate.id} has no availability status.`, 409)
    }
    const topicSlug = slugify(candidate.topic_slug || candidate.topic_name)
    if (!topicOperationIds.has(topicSlug)) {
      const operationId = await stableId('op', `${patchId}:ensure_trend:${topicSlug}`)
      topicOperationIds.set(topicSlug, operationId)
      operations.push({
        operation_id: operationId,
        sequence: operations.length + 1,
        action: 'ensure_trend',
        candidate_id: candidate.id,
        idempotency_key: `catalog:ensure_trend:${topicSlug}`,
        depends_on: [],
        before: null,
        after: {
          name: candidate.topic_name,
          slug: topicSlug,
          description: candidate.topic_description,
          is_active: true,
        },
        reason: reasonFor(candidate, item.evidence),
        reversible: false,
      })
    }

    const operationId = await stableId('op', `${patchId}:add_product:${candidate.id}`)
    const trendOperationId = topicOperationIds.get(topicSlug)
    operations.push({
      operation_id: operationId,
      sequence: operations.length + 1,
      action: 'add_product',
      candidate_id: candidate.id,
      idempotency_key: `catalog:add_product:${candidate.id}`,
      depends_on: trendOperationId ? [trendOperationId] : [],
      before: null,
      after: {
        engine_candidate_id: candidate.id,
        trend_slug: topicSlug,
        name: candidate.name,
        slug: slugify(candidate.slug_suggestion || candidate.name),
        brand: candidate.brand,
        category: candidate.category,
        search_terms: parseStringArray(candidate.search_terms_json),
        availability_status: candidate.availability_status,
        release_date: candidate.release_date,
        source_url: candidate.product_url,
        is_active: true,
        rollback_strategy: 'soft_deactivate',
      },
      reason: reasonFor(candidate, item.evidence),
      reversible: true,
    })
  }

  return operations
}

async function retireUndeliverablePatches(db: D1Database, mode: EngineMode, now: Date): Promise<void> {
  const nowIso = now.toISOString()
  const freshAfter = new Date(now.getTime() - MAX_SCORE_AGE_MS).toISOString()
  const undeliverable = `
    (status = 'ready' OR (status = 'exported' AND COALESCE(lease_until, '') <= ?))
    AND (mode <> ? OR COALESCE(finalized_at, created_at) < ?)
  `
  await db.batch([
    db.prepare(`
      DELETE FROM patch_candidate_claims
      WHERE patch_id IN (SELECT id FROM patches WHERE ${undeliverable})
    `).bind(nowIso, mode, freshAfter),
    db.prepare(`
      UPDATE patches
      SET status = CASE WHEN mode <> ? THEN 'superseded' ELSE 'failed' END,
          error_code = CASE WHEN mode <> ? THEN 'PATCH_MODE_CHANGED' ELSE 'PATCH_STALE' END,
          delivery_token = NULL,
          lease_until = NULL
      WHERE ${undeliverable}
    `).bind(mode, mode, nowIso, mode, freshAfter),
  ])
}

async function preparePatchGeneration(db: D1Database, mode: EngineMode, now: Date): Promise<void> {
  const nowIso = now.toISOString()
  const staleBefore = new Date(now.getTime() - 15 * 60 * 1000).toISOString()
  await retireUndeliverablePatches(db, mode, now)
  await db.batch([
    db.prepare(`
      UPDATE patches
      SET status = 'failed', error_code = 'STALE_BUILD_RECOVERED', finalized_at = ?
      WHERE status = 'building' AND created_at < ?
    `).bind(nowIso, staleBefore),
    db.prepare(`
      DELETE FROM patch_candidate_claims
      WHERE patch_id IN (SELECT id FROM patches WHERE status = 'failed')
    `),
    db.prepare(`
      UPDATE patches
      SET status = 'superseded', error_code = 'DRAFT_REPLACED'
      WHERE status = 'draft'
    `),
    db.prepare(`
      DELETE FROM patch_candidate_claims
      WHERE patch_id IN (SELECT id FROM patches WHERE status = 'superseded')
    `),
  ])
}

export async function generateCatalogPatch(
  db: D1Database,
  mode: EngineMode,
  triggerType: 'scheduled' | 'manual',
  now = new Date(),
): Promise<PatchGenerationResult> {
  const generatedAt = now.toISOString()
  const patchId = `patch_${crypto.randomUUID()}`
  await preparePatchGeneration(db, mode, now)
  const candidates = await listPatchCandidates(db, {
    mode,
    scoreFreshAfter: new Date(now.getTime() - MAX_SCORE_AGE_MS).toISOString(),
    evidenceActiveAt: generatedAt,
    autopilotMinScore: AUTOPILOT_MIN_SCORE,
    autopilotMinConfidence: AUTOPILOT_MIN_CONFIDENCE,
    autopilotMinSources: AUTOPILOT_MIN_SOURCES,
  })
  const skipped: Array<{ candidate_id: string; reasons: string[] }> = []

  await db.prepare(`
    INSERT INTO patches (id, mode, status, trigger_type, target, score_version, created_at)
    VALUES (?, ?, 'building', ?, 'finditviral', ?, ?)
  `).bind(patchId, mode, triggerType, SCORE_VERSION, generatedAt).run()

  const claimed: ClaimResult[] = []
  const claimedProductSlugs = new Map<string, string>()
  const claimedTopicNames = new Map<string, string>()
  try {
    for (const rawCandidate of candidates) {
      if (claimed.length >= 9) break
      const candidate = withOverrides(rawCandidate)
      const decision = evaluatePatchPolicy(candidate, mode, now)
      if (!decision.eligible) {
        skipped.push({ candidate_id: candidate.id, reasons: decision.reasons })
        continue
      }
      const productSlug = slugify(candidate.slug_suggestion || candidate.name)
      const productSlugOwner = claimedProductSlugs.get(productSlug)
      if (productSlugOwner && productSlugOwner !== candidate.id) {
        skipped.push({ candidate_id: candidate.id, reasons: [`product slug collides with ${productSlugOwner}`] })
        continue
      }
      const topicSlug = slugify(candidate.topic_slug || candidate.topic_name)
      const topicName = candidate.topic_name.trim().toLocaleLowerCase('en-US')
      const existingTopicName = claimedTopicNames.get(topicSlug)
      if (existingTopicName && existingTopicName !== topicName) {
        skipped.push({ candidate_id: candidate.id, reasons: ['trend slug resolves to two different trend names'] })
        continue
      }
      const evidence = await listEvidenceUrls(db, candidate.id, generatedAt)
      if (evidence.length === 0) {
        skipped.push({ candidate_id: candidate.id, reasons: ['candidate has no active evidence URLs'] })
        continue
      }
      if (!await claimCandidate(db, patchId, candidate.id, generatedAt)) {
        skipped.push({ candidate_id: candidate.id, reasons: ['candidate already belongs to an active catalog patch'] })
        continue
      }
      claimedProductSlugs.set(productSlug, candidate.id)
      claimedTopicNames.set(topicSlug, topicName)
      claimed.push({ candidate, evidence })
    }

    if (claimed.length === 0) {
      await db.prepare('DELETE FROM patches WHERE id = ?').bind(patchId).run()
      return { patch: null, status: null, skipped }
    }

    const operations = await buildOperations(patchId, claimed)
    const withoutChecksum: CatalogPatchV1 = {
      schema_version: PATCH_SCHEMA_VERSION,
      patch_id: patchId,
      generated_at: generatedAt,
      target: 'finditviral',
      mode,
      score_version: SCORE_VERSION,
      checksum: '',
      operations,
    }
    const checksum = `sha256:${await sha256Hex(canonicalJson(withoutChecksum))}`
    const patch: CatalogPatchV1 = { ...withoutChecksum, checksum }
    const manifestJson = canonicalJson(patch)
    const status = patchStatusForMode(mode)

    const statements: D1PreparedStatement[] = operations.map((operation) => db.prepare(`
      INSERT INTO patch_operations (
        id, patch_id, sequence_number, action, candidate_id, idempotency_key,
        depends_on_json, before_json, after_json, reason_json, reversible
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      operation.operation_id,
      patchId,
      operation.sequence,
      operation.action,
      operation.candidate_id,
      operation.idempotency_key,
      JSON.stringify(operation.depends_on),
      operation.before ? JSON.stringify(operation.before) : null,
      JSON.stringify(operation.after),
      JSON.stringify(operation.reason),
      operation.reversible ? 1 : 0,
    ))
    statements.push(
      db.prepare(`
        UPDATE patches
        SET status = ?, checksum = ?, manifest_json = ?, operation_count = ?, finalized_at = ?
        WHERE id = ? AND status = 'building'
      `).bind(status, checksum, manifestJson, operations.length, generatedAt, patchId),
      db.prepare(`
        INSERT INTO change_log (event_type, entity_id, occurred_at, payload_json)
        VALUES ('catalog_patch', ?, ?, ?)
      `).bind(patchId, generatedAt, manifestJson),
    )
    await db.batch(statements)
    return { patch, status, skipped }
  } catch (error) {
    await db.batch([
      db.prepare('DELETE FROM patch_candidate_claims WHERE patch_id = ?').bind(patchId),
      db.prepare(`UPDATE patches SET status = 'failed', error_code = 'PATCH_BUILD_FAILED', finalized_at = ? WHERE id = ?`)
        .bind(generatedAt, patchId),
    ])
    throw error
  }
}

function hasOnlyKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys)
  return Object.keys(record).every((key) => allowed.has(key))
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isSearchTerms(value: unknown): value is string[] {
  return isStringArray(value)
    && value.length <= 8
    && value.every((item) => item === item.trim() && item.length >= 1 && item.length <= 60)
    && new Set(value).size === value.length
    && value.join(' ').length <= 500
}

function isCandidateState(value: unknown): value is typeof CANDIDATE_STATES[number] {
  return typeof value === 'string' && CANDIDATE_STATES.some((state) => state === value)
}

function isEngineMode(value: unknown): value is typeof ENGINE_MODES[number] {
  return typeof value === 'string' && ENGINE_MODES.some((mode) => mode === value)
}

function isPatchAction(value: unknown): value is typeof PATCH_ACTIONS[number] {
  return typeof value === 'string' && PATCH_ACTIONS.some((action) => action === value)
}

function isAvailabilityStatus(value: unknown): value is typeof AVAILABILITY_STATUSES[number] {
  return typeof value === 'string' && AVAILABILITY_STATUSES.some((status) => status === value)
}

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password
  } catch {
    return false
  }
}

function isPatchReason(value: unknown): value is CatalogPatchOperationV1['reason'] {
  if (!isRecord(value) || !hasOnlyKeys(value, ['score', 'confidence', 'state', 'policy_version', 'evidence_urls'])) return false
  return typeof value.score === 'number'
    && Number.isFinite(value.score)
    && value.score >= 0
    && value.score <= 100
    && typeof value.confidence === 'number'
    && Number.isFinite(value.confidence)
    && value.confidence >= 0
    && value.confidence <= 1
    && isCandidateState(value.state)
    && typeof value.policy_version === 'string'
    && value.policy_version.length > 0
    && isStringArray(value.evidence_urls)
    && value.evidence_urls.length > 0
    && value.evidence_urls.every(isHttpsUrl)
}

function isOperationAfter(action: typeof PATCH_ACTIONS[number], value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false
  if (action === 'ensure_trend') {
    return hasOnlyKeys(value, ['name', 'slug', 'description', 'is_active'])
      && typeof value.name === 'string'
      && typeof value.slug === 'string'
      && (value.description === null || typeof value.description === 'string')
      && value.is_active === true
  }
  if (action === 'add_product') {
    return hasOnlyKeys(value, [
      'engine_candidate_id', 'trend_slug', 'name', 'slug', 'brand', 'category',
      'search_terms', 'availability_status', 'release_date', 'source_url',
      'is_active', 'rollback_strategy',
    ])
      && typeof value.engine_candidate_id === 'string'
      && typeof value.trend_slug === 'string'
      && typeof value.name === 'string'
      && typeof value.slug === 'string'
      && (value.brand === null || typeof value.brand === 'string')
      && (value.category === null || typeof value.category === 'string')
      && isSearchTerms(value.search_terms)
      && isAvailabilityStatus(value.availability_status)
      && value.availability_status !== 'retired'
      && (value.release_date === null || typeof value.release_date === 'string')
      && isHttpsUrl(value.source_url)
      && value.is_active === true
      && value.rollback_strategy === 'soft_deactivate'
  }
  return false
}

function isCatalogPatchOperation(value: unknown): value is CatalogPatchOperationV1 {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    'operation_id', 'sequence', 'action', 'candidate_id', 'idempotency_key',
    'depends_on', 'before', 'after', 'reason', 'reversible',
  ])) return false
  if (!isPatchAction(value.action)) return false
  const reversibleMatchesAction = value.action === 'ensure_trend'
    ? value.reversible === false
    : value.reversible === true
  return typeof value.operation_id === 'string'
    && /^op_[0-9a-f]{24}$/.test(value.operation_id)
    && typeof value.sequence === 'number'
    && Number.isInteger(value.sequence)
    && value.sequence >= 1
    && typeof value.candidate_id === 'string'
    && /^candidate_[0-9a-f]{24}$/.test(value.candidate_id)
    && typeof value.idempotency_key === 'string'
    && value.idempotency_key.length > 0
    && isStringArray(value.depends_on)
    && (value.before === null || isRecord(value.before))
    && isOperationAfter(value.action, value.after)
    && isPatchReason(value.reason)
    && reversibleMatchesAction
}

function isCatalogPatch(value: unknown): value is CatalogPatchV1 {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    'schema_version', 'patch_id', 'generated_at', 'target', 'mode',
    'score_version', 'checksum', 'operations',
  ])) return false
  return value.schema_version === PATCH_SCHEMA_VERSION
    && typeof value.patch_id === 'string'
    && /^patch_[0-9a-f-]{36}$/.test(value.patch_id)
    && typeof value.generated_at === 'string'
    && Number.isFinite(Date.parse(value.generated_at))
    && value.target === 'finditviral'
    && isEngineMode(value.mode)
    && typeof value.score_version === 'string'
    && value.score_version.length > 0
    && typeof value.checksum === 'string'
    && /^sha256:[0-9a-f]{64}$/.test(value.checksum)
    && Array.isArray(value.operations)
    && value.operations.length > 0
    && value.operations.every(isCatalogPatchOperation)
}

async function parsePatch(row: PatchRow | null): Promise<CatalogPatchV1 | null> {
  if (!row) return null
  if (!row.manifest_json || !row.checksum) {
    throw new EngineError('PATCH_MANIFEST_INVALID', 'The stored patch manifest is incomplete.', 500)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(row.manifest_json)
  } catch {
    throw new EngineError('PATCH_MANIFEST_INVALID', 'The stored patch manifest is not valid JSON.', 500)
  }
  if (!isCatalogPatch(parsed)) {
    throw new EngineError('PATCH_MANIFEST_INVALID', 'The stored patch manifest failed runtime validation.', 500)
  }
  if (parsed.patch_id !== row.id || parsed.mode !== row.mode || parsed.score_version !== row.score_version || parsed.checksum !== row.checksum) {
    throw new EngineError('PATCH_MANIFEST_INVALID', 'The stored patch manifest does not match its outbox row.', 500)
  }
  const seenOperations = new Set<string>()
  const idempotencyKeys = new Set<string>()
  for (const [index, operation] of parsed.operations.entries()) {
    if (operation.sequence !== index + 1
      || operation.depends_on.some((dependency) => !seenOperations.has(dependency))
      || seenOperations.has(operation.operation_id)
      || idempotencyKeys.has(operation.idempotency_key)) {
      throw new EngineError('PATCH_MANIFEST_INVALID', 'The stored patch operation graph is invalid.', 500)
    }
    seenOperations.add(operation.operation_id)
    idempotencyKeys.add(operation.idempotency_key)
  }
  const expectedChecksum = `sha256:${await sha256Hex(canonicalJson({ ...parsed, checksum: '' }))}`
  if (expectedChecksum !== parsed.checksum) {
    throw new EngineError('PATCH_CHECKSUM_INVALID', 'The stored patch checksum does not match its manifest.', 500)
  }
  return parsed
}

export async function getPatch(db: D1Database, patchId: string): Promise<CatalogPatchV1 | null> {
  const row = await db.prepare('SELECT * FROM patches WHERE id = ?').bind(patchId).first<PatchRow>()
  return parsePatch(row)
}

export async function claimNextReadyPatch(
  db: D1Database,
  mode: Exclude<EngineMode, 'shadow'>,
  now = new Date(),
): Promise<PatchDelivery | null> {
  const nowIso = now.toISOString()
  const freshAfter = new Date(now.getTime() - MAX_SCORE_AGE_MS).toISOString()
  await retireUndeliverablePatches(db, mode, now)
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const row = await db.prepare(`
      SELECT * FROM patches
      WHERE mode = ?
        AND COALESCE(finalized_at, created_at) >= ?
        AND (
          status = 'ready'
          OR (status = 'exported' AND COALESCE(lease_until, '') <= ?)
        )
      ORDER BY created_at, id
      LIMIT 1
    `).bind(mode, freshAfter, nowIso).first<PatchRow>()
    if (!row) return null
    const deliveryToken = crypto.randomUUID()
    const leaseExpiresAt = new Date(now.getTime() + 5 * 60 * 1000).toISOString()
    const claimed = await db.prepare(`
      UPDATE patches
      SET status = 'exported', exported_at = ?, delivery_token = ?, lease_until = ?,
          export_attempts = export_attempts + 1
      WHERE id = ?
        AND mode = ?
        AND COALESCE(finalized_at, created_at) >= ?
        AND (status = 'ready' OR (status = 'exported' AND COALESCE(lease_until, '') <= ?))
    `).bind(nowIso, deliveryToken, leaseExpiresAt, row.id, mode, freshAfter, nowIso).run()
    if (claimed.meta.changes === 0) continue
    try {
      const patch = await parsePatch(row)
      if (!patch) throw new EngineError('PATCH_MANIFEST_INVALID', 'The stored patch manifest is missing.', 500)
      return { patch, deliveryToken, leaseExpiresAt }
    } catch {
      await db.batch([
        db.prepare(`
          UPDATE patches
          SET status = 'failed', error_code = 'PATCH_MANIFEST_INVALID',
              delivery_token = NULL, lease_until = NULL
          WHERE id = ? AND delivery_token = ?
        `).bind(row.id, deliveryToken),
        db.prepare('DELETE FROM patch_candidate_claims WHERE patch_id = ?').bind(row.id),
      ])
    }
  }
  throw new EngineError('PATCH_DELIVERY_CONTENDED', 'A patch could not be claimed after several attempts.', 503, true)
}

export async function markPatchStatus(
  db: D1Database,
  patchId: string,
  status: 'applied' | 'failed',
  deliveryToken: string,
  now = new Date(),
): Promise<boolean> {
  const existing = await db.prepare(`
    SELECT id, status, delivery_token
    FROM patches
    WHERE id = ?
  `).bind(patchId).first<{ id: string; status: PatchRow['status']; delivery_token: string | null }>()
  if (!existing) return false
  if (existing.status !== 'exported' || existing.delivery_token !== deliveryToken) {
    throw new EngineError('PATCH_ACK_CONFLICT', 'The patch is not held by this delivery lease.', 409)
  }
  if (status === 'applied') {
    const missing = await db.prepare(`
      SELECT COUNT(*) AS count
      FROM patch_operations po
      LEFT JOIN catalog_links cl ON cl.candidate_id = po.candidate_id
      WHERE po.patch_id = ?
        AND po.action = 'add_product'
        AND (
          cl.candidate_id IS NULL OR cl.status <> 'active'
          OR cl.fiv_product_id IS NULL OR cl.fiv_product_slug IS NULL
          OR cl.fiv_trend_id IS NULL OR cl.fiv_trend_slug IS NULL
        )
    `).bind(patchId).first<{ count: number }>()
    if ((missing?.count ?? 0) > 0) {
      throw new EngineError('PATCH_LINKS_INCOMPLETE', 'Every added product must be linked before the patch is applied.', 409)
    }
  }
  const nowIso = now.toISOString()
  const updated = await db.prepare(`
    UPDATE patches
    SET status = ?, applied_at = CASE WHEN ? = 'applied' THEN ? ELSE applied_at END,
        error_code = CASE WHEN ? = 'failed' THEN 'PUBLISHER_REPORTED_FAILURE' ELSE NULL END,
        delivery_token = NULL, lease_until = NULL
    WHERE id = ? AND status = 'exported' AND delivery_token = ?
  `).bind(status, status, nowIso, status, patchId, deliveryToken).run()
  if (updated.meta.changes === 0) {
    throw new EngineError('PATCH_ACK_CONFLICT', 'The patch delivery lease changed before acknowledgment.', 409)
  }
  if (status === 'failed') {
    await db.prepare('DELETE FROM patch_candidate_claims WHERE patch_id = ?').bind(patchId).run()
  }
  return true
}

export async function saveCatalogLink(
  db: D1Database,
  input: {
    candidateId: string
    fivProductId: string | null
    fivProductSlug: string | null
    fivTrendId: string | null
    fivTrendSlug: string | null
    status: 'active' | 'inactive'
  },
  now = new Date(),
): Promise<void> {
  const candidate = await db.prepare('SELECT id FROM candidates WHERE id = ?').bind(input.candidateId).first<{ id: string }>()
  if (!candidate) throw new EngineError('CANDIDATE_NOT_FOUND', 'The candidate does not exist.', 404)
  const nowIso = now.toISOString()
  try {
    await db.prepare(`
      INSERT INTO catalog_links (
        candidate_id, fiv_product_id, fiv_product_slug, fiv_trend_id,
        fiv_trend_slug, status, linked_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(candidate_id) DO UPDATE SET
        fiv_product_id = excluded.fiv_product_id,
        fiv_product_slug = excluded.fiv_product_slug,
        fiv_trend_id = excluded.fiv_trend_id,
        fiv_trend_slug = excluded.fiv_trend_slug,
        status = excluded.status,
        updated_at = excluded.updated_at
    `).bind(
      input.candidateId,
      input.fivProductId,
      input.fivProductSlug,
      input.fivTrendId,
      input.fivTrendSlug,
      input.status,
      nowIso,
      nowIso,
    ).run()
  } catch (error) {
    if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
      throw new EngineError('CATALOG_LINK_CONFLICT', 'The FindItViral product ID or slug is already linked.', 409)
    }
    throw error
  }
}
