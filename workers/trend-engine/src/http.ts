import { authorize } from './auth'
import { assertAllowedSourceUrl } from './collector'
import {
  CANDIDATE_STATES,
  ENGINE_SERVICE,
  type CandidateState,
  type EngineMode,
  type EvidenceClassification,
  type ResearchExplanation,
  type ReviewStatus,
} from './domain'
import { EngineError, ValidationError } from './errors'
import { recomputeAllCandidates } from './ingest'
import { logError } from './logging'
import {
  generateCatalogPatch,
  claimNextReadyPatch,
  getPatch,
  markPatchStatus,
  saveCatalogLink,
} from './patches'
import {
  getCandidate,
  listCandidates,
  listChanges,
  getResearchRun,
  cancelResearchRun,
  getLaneCheckpoints,
  listResearchRuns,
  researchRunView,
  resumeResearchRun,
  listSources,
  saveReviewDecision,
  upsertSource,
} from './repository'
import { enqueueResearchRun } from './research'
import { ingestSignalBatch } from './ingest'
import {
  parseCatalogLink,
  parseEngineMode,
  parseReview,
  parseSourceCreate,
  parseViralSignalBatch,
} from './validation'

const MAX_BODY_BYTES = 512 * 1024
const CORS_HEADERS = {
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
}

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  ...CORS_HEADERS,
}

function json(value: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(value), { status, headers: { ...JSON_HEADERS, ...headers } })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function readJson(request: Request): Promise<unknown> {
  const contentType = request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()
  if (contentType !== 'application/json') throw new EngineError('CONTENT_TYPE_INVALID', 'Content-Type must be application/json.', 415)
  const length = request.headers.get('content-length')
  if (length && Number(length) > MAX_BODY_BYTES) throw new EngineError('REQUEST_TOO_LARGE', 'The request body is too large.', 413)
  if (!request.body) throw new EngineError('JSON_INVALID', 'The request body is empty.', 400)
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const result = await reader.read()
    if (result.done) break
    total += result.value.byteLength
    if (total > MAX_BODY_BYTES) {
      await reader.cancel('request body exceeds size limit')
      throw new EngineError('REQUEST_TOO_LARGE', 'The request body is too large.', 413)
    }
    chunks.push(result.value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  const text = new TextDecoder().decode(bytes)
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new EngineError('JSON_INVALID', 'The request body is not valid JSON.', 400)
  }
}

function boundedInteger(value: string | null, fallback: number, min: number, max: number): number {
  if (value === null || value === '') return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

function configuredMode(env: Env): EngineMode {
  const value: string = env.AUTOPILOT_MODE
  if (value === 'shadow' || value === 'review' || value === 'autopilot') return value
  throw new EngineError('ENGINE_CONFIGURATION_INVALID', 'AUTOPILOT_MODE must be shadow, review, or autopilot.', 500)
}

function parseStoredStringArray(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function sourcePublicView(source: Awaited<ReturnType<typeof listSources>>[number]): Record<string, unknown> {
  return {
    id: source.id,
    name: source.name,
    kind: source.kind,
    endpoint_url: source.endpoint_url,
    independence_key: source.independence_key,
    catalog_host_allowlist: parseStoredStringArray(source.catalog_host_allowlist_json),
    trust_weight: source.trust_weight,
    poll_interval_minutes: source.poll_interval_minutes,
    enabled: source.enabled === 1,
    next_poll_at: source.next_poll_at,
    last_polled_at: source.last_polled_at,
    last_success_at: source.last_success_at,
    last_error_code: source.last_error_code,
    consecutive_failures: source.consecutive_failures,
  }
}

function candidateView(candidate: NonNullable<Awaited<ReturnType<typeof getCandidate>>>): Record<string, unknown> {
  let searchTerms: string[] = []
  try {
    const parsed: unknown = JSON.parse(candidate.search_terms_json)
    if (Array.isArray(parsed)) searchTerms = parsed.filter((item): item is string => typeof item === 'string')
  } catch {
    searchTerms = []
  }
  return {
    id: candidate.id,
    identity_key: candidate.identity_key,
    name: candidate.name,
    suggested_slug: candidate.slug_suggestion,
    brand: candidate.brand,
    gtin: candidate.gtin,
    category: candidate.category,
    topic: {
      name: candidate.topic_name,
      slug: candidate.topic_slug,
      description: candidate.topic_description,
    },
    product_url: candidate.product_url,
    product_url_verified: candidate.product_url_verified === 1,
    image_candidate_url: candidate.image_url,
    search_terms: searchTerms,
    availability_status: candidate.availability_status,
    release_date: candidate.release_date,
    first_seen_at: candidate.first_seen_at,
    last_seen_at: candidate.last_seen_at,
    review_status: candidate.review_status,
    reviewed_at: candidate.reviewed_at,
    research_explanation: researchExplanationView(candidate.research_explanation_json ?? null),
    score: candidate.score === null ? null : {
      value: candidate.score,
      previous: candidate.previous_score,
      momentum: candidate.momentum,
      confidence: candidate.score_confidence,
      source_count: candidate.source_count,
      signal_count: candidate.signal_count,
      state: candidate.state,
      version: candidate.score_version,
      computed_at: candidate.score_computed_at,
    },
  }
}

function parseCandidateState(value: string | null): CandidateState | undefined {
  return value && CANDIDATE_STATES.includes(value as CandidateState) ? value as CandidateState : undefined
}

function parseReviewStatus(value: string | null): ReviewStatus | undefined {
  return value === 'pending' || value === 'approved' || value === 'rejected' ? value : undefined
}

async function handleSources(request: Request, env: Env): Promise<Response> {
  await authorize(request, env, 'admin')
  if (request.method === 'GET') {
    return json({ sources: (await listSources(env.DB)).map(sourcePublicView) })
  }
  if (request.method === 'POST') {
    const input = parseSourceCreate(await readJson(request))
    if (input.endpoint_url) assertAllowedSourceUrl(input.endpoint_url, env)
    const source = await upsertSource(env.DB, input, new Date().toISOString())
    return json({ source: sourcePublicView(source) }, 201)
  }
  throw new EngineError('METHOD_NOT_ALLOWED', 'Method not allowed.', 405)
}

async function handleSignals(request: Request, env: Env): Promise<Response> {
  await authorize(request, env, 'ingest')
  if (request.method !== 'POST') throw new EngineError('METHOD_NOT_ALLOWED', 'Method not allowed.', 405)
  const batch = parseViralSignalBatch(await readJson(request))
  const result = await ingestSignalBatch(env.DB, batch, 'push')
  return json({ result }, result.accepted > 0 ? 202 : 200)
}

async function handleCandidateList(request: Request, env: Env, url: URL): Promise<Response> {
  await authorize(request, env, 'read')
  if (request.method !== 'GET') throw new EngineError('METHOD_NOT_ALLOWED', 'Method not allowed.', 405)
  const limit = boundedInteger(url.searchParams.get('limit'), 50, 1, 100)
  const offset = boundedInteger(url.searchParams.get('offset'), 0, 0, 10_000)
  const state = parseCandidateState(url.searchParams.get('state'))
  const reviewStatus = parseReviewStatus(url.searchParams.get('review_status'))
  const candidates = await listCandidates(env.DB, { state, reviewStatus, limit, offset })
  return json({ candidates: candidates.map(candidateView), pagination: { limit, offset, count: candidates.length } })
}

async function handleCandidateDetail(request: Request, env: Env, candidateId: string): Promise<Response> {
  await authorize(request, env, 'read')
  if (request.method !== 'GET') throw new EngineError('METHOD_NOT_ALLOWED', 'Method not allowed.', 405)
  const candidate = await getCandidate(env.DB, candidateId)
  if (!candidate) throw new EngineError('CANDIDATE_NOT_FOUND', 'The candidate does not exist.', 404)
  return json({ candidate: candidateView(candidate) })
}

async function handleCandidateReview(request: Request, env: Env, candidateId: string): Promise<Response> {
  await authorize(request, env, 'admin')
  if (request.method !== 'POST') throw new EngineError('METHOD_NOT_ALLOWED', 'Method not allowed.', 405)
  const review = parseReview(await readJson(request))
  const now = new Date().toISOString()
  const saved = await saveReviewDecision(env.DB, {
    id: crypto.randomUUID(),
    candidateId,
    decision: review.decision,
    note: review.note,
    overridesJson: review.overrides ? JSON.stringify(review.overrides) : null,
    decidedAt: now,
  })
  if (!saved) throw new EngineError('CANDIDATE_NOT_FOUND', 'The candidate does not exist.', 404)
  return json({ candidate_id: candidateId, review_status: review.decision, reviewed_at: now })
}

async function handlePatchCreate(request: Request, env: Env): Promise<Response> {
  await authorize(request, env, 'admin')
  if (request.method !== 'POST') throw new EngineError('METHOD_NOT_ALLOWED', 'Method not allowed.', 405)
  const body = await readJson(request)
  if (!isRecord(body)) throw new ValidationError(['body must be an object'])
  const activeMode = configuredMode(env)
  const requestedMode = parseEngineMode(body.mode, activeMode)
  if (requestedMode !== activeMode) {
    throw new EngineError('PATCH_MODE_LOCKED', 'Manual patch generation cannot override AUTOPILOT_MODE.', 409)
  }
  const result = await generateCatalogPatch(env.DB, activeMode, 'manual')
  return json(result, result.patch ? 201 : 200)
}

async function handlePatchNext(request: Request, env: Env): Promise<Response> {
  await authorize(request, env, 'publisher')
  const mode = configuredMode(env)
  if (mode === 'shadow') {
    return new Response(null, { status: 204, headers: { ...JSON_HEADERS, 'X-Engine-Mode': mode } })
  }
  const delivery = await claimNextReadyPatch(env.DB, mode)
  return delivery
    ? json({
      patch: delivery.patch,
      delivery_token: delivery.deliveryToken,
      lease_expires_at: delivery.leaseExpiresAt,
    }, 200, { ETag: `"${delivery.patch.checksum}"` })
    : new Response(null, { status: 204, headers: { ...JSON_HEADERS, 'X-Engine-Mode': mode } })
}

async function handlePatchDetail(request: Request, env: Env, patchId: string): Promise<Response> {
  await authorize(request, env, 'read')
  const patch = await getPatch(env.DB, patchId)
  if (!patch) throw new EngineError('PATCH_NOT_FOUND', 'The catalog patch does not exist.', 404)
  return json({ patch }, 200, { ETag: `"${patch.checksum}"` })
}

async function handlePatchAck(request: Request, env: Env, patchId: string): Promise<Response> {
  await authorize(request, env, 'publisher')
  if (request.method !== 'POST') throw new EngineError('METHOD_NOT_ALLOWED', 'Method not allowed.', 405)
  const body = await readJson(request)
  if (!isRecord(body) || (body.status !== 'applied' && body.status !== 'failed')) {
    throw new ValidationError(['body.status must be applied or failed'])
  }
  if (typeof body.delivery_token !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.delivery_token)) {
    throw new ValidationError(['body.delivery_token is required'])
  }
  const status = body.status
  if (!await markPatchStatus(env.DB, patchId, status, body.delivery_token)) {
    throw new EngineError('PATCH_NOT_FOUND', 'The catalog patch does not exist.', 404)
  }
  return json({ patch_id: patchId, status })
}

async function handleCatalogLink(request: Request, env: Env): Promise<Response> {
  await authorize(request, env, 'publisher')
  if (request.method !== 'POST') throw new EngineError('METHOD_NOT_ALLOWED', 'Method not allowed.', 405)
  const link = parseCatalogLink(await readJson(request))
  await saveCatalogLink(env.DB, link)
  return json({ candidate_id: link.candidateId, status: link.status }, 201)
}

async function handleChanges(request: Request, env: Env, url: URL): Promise<Response> {
  await authorize(request, env, 'read')
  if (request.method !== 'GET') throw new EngineError('METHOD_NOT_ALLOWED', 'Method not allowed.', 405)
  const after = boundedInteger(url.searchParams.get('after'), 0, 0, Number.MAX_SAFE_INTEGER)
  const limit = boundedInteger(url.searchParams.get('limit'), 100, 1, 500)
  const rows = await listChanges(env.DB, after, limit)
  const changes = rows.map((row) => {
    let payload: unknown = null
    try {
      payload = JSON.parse(row.payload_json) as unknown
    } catch {
      payload = null
    }
    return {
      sequence: row.sequence_number,
      event_type: row.event_type,
      entity_id: row.entity_id,
      occurred_at: row.occurred_at,
      payload,
    }
  })
  return json({
    changes,
    next_cursor: changes.length > 0 ? changes[changes.length - 1]?.sequence ?? after : after,
  })
}

async function handleRecompute(request: Request, env: Env): Promise<Response> {
  await authorize(request, env, 'admin')
  if (request.method !== 'POST') throw new EngineError('METHOD_NOT_ALLOWED', 'Method not allowed.', 405)
  const count = await recomputeAllCandidates(env.DB)
  return json({ recomputed: count })
}

function researchExplanationView(value: string | null): ResearchExplanation | null {
  if (!value) return null
  try {
    const parsed: unknown = JSON.parse(value)
    if (!isRecord(parsed) || !Array.isArray(parsed.why_discovered) || !Array.isArray(parsed.missing_validation) || !Array.isArray(parsed.evidence_classifications)) return null
    const whyDiscovered = parsed.why_discovered.filter((item): item is string => typeof item === 'string').slice(0, 4)
    const missingValidation = parsed.missing_validation.filter((item): item is string => typeof item === 'string').slice(0, 4)
    const classifications = parsed.evidence_classifications.filter((item): item is EvidenceClassification => typeof item === 'string' && ['brand_owned', 'founder_owned', 'press_release', 'retailer_listing', 'independent_editorial', 'independent_social', 'consumer_activity'].includes(item)).slice(0, 2)
    const maximumState = parsed.maximum_state === 'emerging' ? 'emerging' : null
    const maximumConfidence = typeof parsed.maximum_confidence === 'number' && parsed.maximum_confidence >= 0 && parsed.maximum_confidence <= 1 ? parsed.maximum_confidence : null
    return { why_discovered: whyDiscovered, missing_validation: missingValidation, evidence_classifications: classifications, maximum_state: maximumState, maximum_confidence: maximumConfidence }
  } catch {
    return null
  }
}

async function handleResearchRuns(request: Request, env: Env, url: URL): Promise<Response> {
  await authorize(request, env, 'admin')
  if (request.method === 'GET') {
    const limit = boundedInteger(url.searchParams.get('limit'), 20, 1, 50)
    return json({ runs: (await listResearchRuns(env.DB, limit)).map((r) => researchRunView(r)) })
  }
  if (request.method === 'POST') {
    const result = await enqueueResearchRun(env, {
      trigger: 'manual',
      requestKey: `manual:${crypto.randomUUID()}`,
    })
    return json({ run: researchRunView(result.run), created: result.created }, result.created ? 202 : 200)
  }
  throw new EngineError('METHOD_NOT_ALLOWED', 'Method not allowed.', 405)
}

async function handleResearchRunDetail(request: Request, env: Env, runId: string, action?: string): Promise<Response> {
  await authorize(request, env, 'admin')
  if (action === 'cancel') {
    if (request.method !== 'POST') throw new EngineError('METHOD_NOT_ALLOWED', 'Method not allowed.', 405)
    const run = await cancelResearchRun(env.DB, runId, new Date().toISOString())
    if (!run) throw new EngineError('RESEARCH_RUN_NOT_ACTIVE', 'Only active research runs can be cancelled.', 409)
    return json({ run: researchRunView(run) })
  }
  if (action === 'resume') {
    if (request.method !== 'POST') throw new EngineError('METHOD_NOT_ALLOWED', 'Method not allowed.', 405)
    const run = await resumeResearchRun(env.DB, runId)
    if (!run) throw new EngineError('RESEARCH_RUN_NOT_PAUSED', 'Only paused research runs can be resumed.', 409)
    await env.RESEARCH_QUEUE.send({ kind: 'research_lane', run_id: runId, lane: 'social' })
    return json({ run: researchRunView(run) })
  }
  if (request.method !== 'GET') throw new EngineError('METHOD_NOT_ALLOWED', 'Method not allowed.', 405)
  const run = await getResearchRun(env.DB, runId)
  if (!run) throw new EngineError('RESEARCH_RUN_NOT_FOUND', 'The research run does not exist.', 404)
  const checkpoints = await getLaneCheckpoints(env.DB, runId)
  return json({ run: researchRunView(run, checkpoints) })
}

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }
  if (request.method === 'GET' && url.pathname === '/health') {
    return json({ service: ENGINE_SERVICE, status: 'ok', mode: configuredMode(env), time: new Date().toISOString() })
  }
  if (url.pathname === '/__scheduled') throw new EngineError('NOT_FOUND', 'Not found.', 404)
  if (url.pathname === '/v1/sources') return handleSources(request, env)
  if (url.pathname === '/v1/signals') return handleSignals(request, env)
  if (url.pathname === '/v1/candidates') return handleCandidateList(request, env, url)
  if (url.pathname === '/v1/patches' && request.method === 'POST') return handlePatchCreate(request, env)
  if (url.pathname === '/v1/patches/next' && request.method === 'GET') return handlePatchNext(request, env)
  if (url.pathname === '/v1/catalog-links') return handleCatalogLink(request, env)
  if (url.pathname === '/v1/changes') return handleChanges(request, env, url)
  if (url.pathname === '/v1/recompute') return handleRecompute(request, env)
  if (url.pathname === '/v1/research/runs') return handleResearchRuns(request, env, url)

  const reviewMatch = url.pathname.match(/^\/v1\/candidates\/([^/]+)\/review$/)
  if (reviewMatch?.[1]) return handleCandidateReview(request, env, decodeURIComponent(reviewMatch[1]))
  const candidateMatch = url.pathname.match(/^\/v1\/candidates\/([^/]+)$/)
  if (candidateMatch?.[1] && request.method === 'GET') return handleCandidateDetail(request, env, decodeURIComponent(candidateMatch[1]))
  const ackMatch = url.pathname.match(/^\/v1\/patches\/([^/]+)\/ack$/)
  if (ackMatch?.[1]) return handlePatchAck(request, env, decodeURIComponent(ackMatch[1]))
  const patchMatch = url.pathname.match(/^\/v1\/patches\/([^/]+)$/)
  if (patchMatch?.[1] && request.method === 'GET') return handlePatchDetail(request, env, decodeURIComponent(patchMatch[1]))
  const researchRunMatch = url.pathname.match(/^\/v1\/research\/runs\/([^/]+)$/)
  if (researchRunMatch?.[1]) return handleResearchRunDetail(request, env, decodeURIComponent(researchRunMatch[1]))
  const researchCancelMatch = url.pathname.match(/^\/v1\/research\/runs\/([^/]+)\/cancel$/)
  if (researchCancelMatch?.[1]) return handleResearchRunDetail(request, env, decodeURIComponent(researchCancelMatch[1]), 'cancel')
  const researchResumeMatch = url.pathname.match(/^\/v1\/research\/runs\/([^/]+)\/resume$/)
  if (researchResumeMatch?.[1]) return handleResearchRunDetail(request, env, decodeURIComponent(researchResumeMatch[1]), 'resume')

  throw new EngineError('NOT_FOUND', 'Not found.', 404)
}

export async function handleHttpRequest(request: Request, env: Env): Promise<Response> {
  const requestId = crypto.randomUUID()
  try {
    return await route(request, env)
  } catch (error) {
    if (error instanceof ValidationError) {
      return json({ error: { code: error.code, message: error.message, issues: error.issues, request_id: requestId } }, error.status)
    }
    if (error instanceof EngineError) {
      if (error.status >= 500) logError('http_request_failed', error, { request_id: requestId, path: new URL(request.url).pathname })
      return json({ error: { code: error.code, message: error.message, request_id: requestId } }, error.status)
    }
    logError('http_request_failed', error, { request_id: requestId, path: new URL(request.url).pathname })
    return json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error.', request_id: requestId } }, 500)
  }
}
