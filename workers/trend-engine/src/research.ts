import type { ResearchRunRow, ViralSignalV1 } from './domain'
import { EngineError, errorCode } from './errors'
import { stableId } from './identity'
import { ingestSignalBatch } from './ingest'
import {
  completeResearchRun,
  createOrGetResearchRun,
  deleteQueuedResearchRun,
  failResearchRun,
  getResearchRun,
} from './repository'
import { parseViralSignalBatch } from './validation'

export const OPENAI_RESEARCH_SOURCE = 'openai-research'
export const OPENAI_RESEARCH_PROMPT_VERSION = 'consumer-products-v1'
const MAX_CANDIDATES = 12
const MAX_OUTPUT_TOKENS = 8_000

type JsonRecord = Record<string, unknown>

export interface ResearchEnqueueResult {
  run: ResearchRunRow
  created: boolean
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function openAiHttpFailure(response: Response): EngineError {
  const requestId = response.headers.get('x-request-id')
  const requestSuffix = requestId ? ` OpenAI request ID: ${requestId}.` : ''
  if (response.status === 401) {
    return new EngineError('OPENAI_RESEARCH_AUTH_FAILED', `OpenAI authentication failed. Update the Worker OPENAI_API_KEY.${requestSuffix}`, 502, false)
  }
  if (response.status === 403) {
    return new EngineError('OPENAI_RESEARCH_ACCESS_DENIED', `OpenAI denied access to this research request. Check the API project, billing, and model access.${requestSuffix}`, 502, false)
  }
  if (response.status === 404) {
    return new EngineError('OPENAI_RESEARCH_MODEL_UNAVAILABLE', `The configured OpenAI research model is unavailable to this API project.${requestSuffix}`, 502, false)
  }
  if (response.status === 429) {
    return new EngineError('OPENAI_RESEARCH_RATE_LIMITED', `OpenAI rate-limited the research request.${requestSuffix}`, 502, true)
  }
  if (response.status >= 500 || response.status === 408) {
    return new EngineError('OPENAI_RESEARCH_UPSTREAM_UNAVAILABLE', `OpenAI research is temporarily unavailable (HTTP ${response.status}).${requestSuffix}`, 502, true)
  }
  return new EngineError('OPENAI_RESEARCH_REQUEST_REJECTED', `OpenAI rejected the research request (HTTP ${response.status}).${requestSuffix}`, 502, false)
}

function configuredModel(env: Env): string {
  const model: string = env.OPENAI_RESEARCH_MODEL
  return model.trim() || 'gpt-5.6-luna'
}

function parseUrls(value: unknown, allowedUrls: Set<string>): string[] {
  if (!Array.isArray(value)) return []
  const urls = value.flatMap((value) => {
    if (typeof value !== 'string') return []
    try {
      const url = new URL(value)
      return url.protocol === 'https:' && allowedUrls.has(url.toString()) ? [url.toString()] : []
    } catch {
      return []
    }
  })
  return Array.from(new Set(urls)).slice(0, 2)
}

function optionalString(value: unknown, max: number): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max ? value.trim() : undefined
}

function allowedCitationUrls(response: JsonRecord): Set<string> {
  const allowed = new Set<string>()
  const output = response.output
  if (!Array.isArray(output)) return allowed
  for (const item of output) {
    if (!isRecord(item) || !Array.isArray(item.content)) continue
    for (const content of item.content) {
      if (!isRecord(content) || !Array.isArray(content.annotations)) continue
      for (const annotation of content.annotations) {
        if (!isRecord(annotation) || annotation.type !== 'url_citation' || typeof annotation.url !== 'string') continue
        try {
          const url = new URL(annotation.url)
          if (url.protocol === 'https:') allowed.add(url.toString())
        } catch {
          // Ignore malformed citations returned by a provider response.
        }
      }
    }
  }
  return allowed
}

function outputText(response: JsonRecord): string | null {
  if (typeof response.output_text === 'string') return response.output_text
  const output = response.output
  if (!Array.isArray(output)) return null
  for (const item of output) {
    if (!isRecord(item) || !Array.isArray(item.content)) continue
    for (const content of item.content) {
      if (isRecord(content) && content.type === 'output_text' && typeof content.text === 'string') return content.text
    }
  }
  return null
}

async function recordsFromResponse(response: JsonRecord, run: ResearchRunRow, now: Date): Promise<{ records: ViralSignalV1[]; rejected: number; evidence: Array<{ candidate_id: string; urls: string[] }> }> {
  const text = outputText(response)
  if (!text) throw new EngineError('OPENAI_RESEARCH_INVALID_RESPONSE', 'OpenAI research response did not contain structured output.', 502, false)
  let parsed: unknown
  try {
    parsed = JSON.parse(text) as unknown
  } catch {
    throw new EngineError('OPENAI_RESEARCH_INVALID_RESPONSE', 'OpenAI research output was not valid JSON.', 502, false)
  }
  const candidates = isRecord(parsed) && Array.isArray(parsed.candidates) ? parsed.candidates.slice(0, MAX_CANDIDATES) : []
  const allowed = allowedCitationUrls(response)
  const records: ViralSignalV1[] = []
  const evidence: Array<{ candidate_id: string; urls: string[] }> = []
  let rejected = 0

  for (const candidate of candidates) {
    if (!isRecord(candidate)) { rejected += 1; continue }
    const name = optionalString(candidate.name, 160)
    const productUrl = optionalString(candidate.product_url, 2048)
    const topic = isRecord(candidate.topic) ? candidate.topic : null
    const topicName = topic ? optionalString(topic.name, 100) : undefined
    const urls = parseUrls(candidate.evidence_urls, allowed)
    const signal = isRecord(candidate.signal) ? candidate.signal : null
    const type = signal ? optionalString(signal.type, 40) : undefined
    const value = signal?.value
    const confidence = candidate.confidence
    if (!name || !productUrl || !topicName || urls.length < 2 || !signal ||
      (type !== 'search_interest' && type !== 'social_velocity' && type !== 'marketplace_rank' && type !== 'editorial_mentions') ||
      typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100 ||
      typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      rejected += 1
      continue
    }
    const externalId = await stableId('research_candidate', `${name}\u0000${optionalString(candidate.brand, 100) ?? ''}\u0000${productUrl}`)
    const observationId = await stableId('research_observation', `${run.id}\u0000${externalId}`)
    const candidateId = await stableId('candidate', optionalString(candidate.brand, 100)
      ? `brand-name:${optionalString(candidate.brand, 100)!.toLocaleLowerCase('en-US')}\u0000${name.toLocaleLowerCase('en-US')}`
      : `source:${OPENAI_RESEARCH_SOURCE}\u0000${externalId}`)
    const availability = optionalString(candidate.availability_status, 20)
    const availabilityStatus = availability === 'available' || availability === 'backorder' || availability === 'preorder' || availability === 'announced' || availability === 'limited'
      ? availability
      : 'announced'
    records.push({
      schema_version: 1,
      kind: 'viral_signal',
      source: OPENAI_RESEARCH_SOURCE,
      external_observation_id: observationId,
      source_run_id: run.id,
      observed_at: now.toISOString(),
      expires_at: new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString(),
      candidate: {
        external_id: externalId,
        name,
        ...(optionalString(candidate.brand, 100) ? { brand: optionalString(candidate.brand, 100) } : {}),
        ...(optionalString(candidate.category, 100) ? { category: optionalString(candidate.category, 100) } : {}),
        topic: {
          name: topicName,
          ...(topic && optionalString(topic.slug, 90) ? { slug: optionalString(topic.slug, 90) } : {}),
          ...(topic && optionalString(topic.description, 500) ? { description: optionalString(topic.description, 500) } : {}),
        },
        product_url: productUrl,
        ...(optionalString(candidate.image_url, 2048) ? { image_url: optionalString(candidate.image_url, 2048) } : {}),
        search_terms: [name, ...(optionalString(candidate.brand, 100) ? [optionalString(candidate.brand, 100)!] : [])],
        availability_status: availabilityStatus,
      },
      signal: {
        type,
        value,
        ...(typeof signal.velocity === 'number' && signal.velocity >= -1 && signal.velocity <= 1 ? { velocity: signal.velocity } : {}),
      },
      confidence,
      evidence_url: urls[0]!,
    })
    evidence.push({ candidate_id: candidateId, urls })
  }
  return { records, rejected, evidence }
}

function responseSchema(): JsonRecord {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['candidates'],
    properties: {
      candidates: {
        type: 'array',
        maxItems: MAX_CANDIDATES,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'product_url', 'topic', 'signal', 'confidence', 'evidence_urls'],
          properties: {
            name: { type: 'string' }, brand: { type: 'string' }, category: { type: 'string' },
            product_url: { type: 'string' }, image_url: { type: 'string' }, availability_status: { type: 'string' },
            topic: { type: 'object', additionalProperties: false, required: ['name'], properties: { name: { type: 'string' }, slug: { type: 'string' }, description: { type: 'string' } } },
            signal: { type: 'object', additionalProperties: false, required: ['type', 'value'], properties: { type: { type: 'string', enum: ['search_interest', 'social_velocity', 'marketplace_rank', 'editorial_mentions'] }, value: { type: 'number' }, velocity: { type: 'number' } } },
            confidence: { type: 'number' }, evidence_urls: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'string' } },
          },
        },
      },
    },
  }
}

async function callOpenAi(env: Env): Promise<JsonRecord> {
  if (!env.OPENAI_API_KEY || env.OPENAI_API_KEY.length < 20) {
    throw new EngineError('OPENAI_RESEARCH_NOT_CONFIGURED', 'OPENAI_API_KEY is missing or invalid.', 500, false)
  }
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: configuredModel(env),
      max_output_tokens: MAX_OUTPUT_TOKENS,
      tools: [{ type: 'web_search' }],
      tool_choice: 'required',
      input: `Research newly viral consumer products in the United States. Find product-specific trends across collectibles, food, beauty, technology, and retail launches. Return only candidates with a real product URL and exactly two distinct current HTTPS citations from your web research. Do not invent metrics, citations, or availability. Keep confidence conservative and return at most ${MAX_CANDIDATES} candidates.`,
      text: { format: { type: 'json_schema', name: 'viral_research_candidates', strict: true, schema: responseSchema() } },
    }),
  })
  const body = await response.json().catch(() => null)
  if (!response.ok) throw openAiHttpFailure(response)
  if (!isRecord(body)) throw new EngineError('OPENAI_RESEARCH_INVALID_RESPONSE', 'OpenAI research response was not a JSON object.', 502, false)
  return body
}

export async function enqueueResearchRun(env: Env, input: { trigger: 'scheduled' | 'manual'; requestKey: string; now?: Date }): Promise<ResearchEnqueueResult> {
  const now = input.now ?? new Date()
  const result = await createOrGetResearchRun(env.DB, {
    requestKey: input.requestKey,
    trigger: input.trigger,
    model: configuredModel(env),
    now: now.toISOString(),
  })
  if (!result.created) return result
  try {
    await env.RESEARCH_QUEUE.send({ kind: 'openai_research', run_id: result.run.id })
  } catch (error) {
    await deleteQueuedResearchRun(env.DB, result.run.id)
    throw error
  }
  return result
}

export async function executeResearchRun(env: Env, runId: string, now = new Date()): Promise<void> {
  const run = await getResearchRun(env.DB, runId)
  if (!run) throw new EngineError('RESEARCH_RUN_NOT_FOUND', 'Research run does not exist.', 404, false)
  const response = await callOpenAi(env)
  const research = await recordsFromResponse(response, run, now)
  const ingestion = { received: 0, accepted: 0, duplicates: 0, candidateIds: [] as string[] }
  for (let index = 0; index < research.records.length; index += 4) {
    const batch = parseViralSignalBatch({ schema_version: 1, records: research.records.slice(index, index + 4) }, now)
    const result = await ingestSignalBatch(env.DB, batch, 'scheduled', now)
    ingestion.received += result.received
    ingestion.accepted += result.accepted
    ingestion.duplicates += result.duplicates
    ingestion.candidateIds.push(...result.candidateIds)
  }
  await completeResearchRun(env.DB, run.id, {
    now: new Date().toISOString(),
    received: research.records.length,
    accepted: ingestion.accepted,
    duplicates: ingestion.duplicates,
    rejected: research.rejected,
    candidateIds: ingestion.candidateIds,
    evidence: research.evidence,
  })
}

export async function recordResearchFailure(env: Env, runId: string, error: unknown, retryable: boolean): Promise<void> {
  await failResearchRun(env.DB, runId, errorCode(error), new Date().toISOString(), retryable)
}
