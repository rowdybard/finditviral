import type { EvidenceClassification, ResearchCandidateDiagnostic, ResearchExplanation, ResearchRunDiagnostics, ResearchRunRow, ViralSignalV1 } from './domain'
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
export const OPENAI_RESEARCH_PROMPT_VERSION = 'consumer-products-v2'
const MAX_CANDIDATES = 12
const MAX_OUTPUT_TOKENS = 8_000

type JsonRecord = Record<string, unknown>
type ResearchDiscoveryLane = 'social' | 'search demand' | 'commerce' | 'trend media'

const SOCIAL_HOSTS = ['tiktok.com', 'x.com', 'twitter.com', 'reddit.com', 'facebook.com', 'instagram.com', 'youtube.com']
const DEMAND_HOSTS = ['trends.google.com', 'shopping.google.com', 'google.com']
const COMMERCE_HOSTS = ['amazon.', 'walmart.', 'target.', 'costco.', 'bestbuy.', 'sephora.', 'ulta.', 'etsy.', 'ebay.', 'shopify.', 'nike.', 'disney.', 'mattel.', 'lego.']
const EVIDENCE_CLASSIFICATIONS: EvidenceClassification[] = ['brand_owned', 'founder_owned', 'press_release', 'retailer_listing', 'independent_editorial', 'independent_social', 'consumer_activity']
const LAUNCH_CLASSIFICATIONS = new Set<EvidenceClassification>(['brand_owned', 'founder_owned', 'press_release', 'retailer_listing'])

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

function suppliedHttpsUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.flatMap((entry) => {
    if (typeof entry !== 'string') return []
    try {
      const url = new URL(entry)
      return url.protocol === 'https:' ? [url.toString()] : []
    } catch {
      return []
    }
  }))).slice(0, 2)
}

function hasDistinctDomains(urls: string[]): boolean {
  return new Set(urls.map((value) => new URL(value).hostname.toLowerCase())).size >= 2
}

function optionalString(value: unknown, max: number): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max ? value.trim() : undefined
}

function textList(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => typeof item === 'string' && item.trim().length >= 3 && item.trim().length <= maxLength ? [item.trim()] : []).slice(0, maxItems)
}

function evidenceProfiles(value: unknown, allowed: Set<string>): Array<{ url: string; classification: EvidenceClassification }> {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!isRecord(item) || typeof item.url !== 'string' || typeof item.classification !== 'string' || !EVIDENCE_CLASSIFICATIONS.includes(item.classification as EvidenceClassification) || typeof item.supporting_quote !== 'string' || item.supporting_quote.trim().length < 3 || item.supporting_quote.trim().length > 280) return []
    try {
      const url = new URL(item.url)
      return url.protocol === 'https:' && allowed.has(url.toString()) ? [{ url: url.toString(), classification: item.classification as EvidenceClassification }] : []
    } catch {
      return []
    }
  }).slice(0, 2)
}

function hasConcatenatedReviewCounts(value: unknown): boolean {
  if (!isRecord(value)) return false
  const ratingCount = value.rating_count
  const questionCount = value.question_count
  const quote = value.supporting_quote
  return typeof ratingCount === 'number' && Number.isInteger(ratingCount) && ratingCount >= 0 &&
    typeof questionCount === 'number' && Number.isInteger(questionCount) && questionCount >= 0 &&
    questionCount > ratingCount * 5 && typeof quote === 'string' && quote.includes(`${ratingCount}${questionCount}`)
}

function allowedCitationUrls(response: JsonRecord): Set<string> {
  const allowed = new Set<string>()
  const output = response.output
  if (!Array.isArray(output)) return allowed
  for (const item of output) {
    if (!isRecord(item)) continue
    if (Array.isArray(item.content)) {
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
    const action = isRecord(item.action) ? item.action : null
    if (!action || !Array.isArray(action.sources)) continue
    for (const source of action.sources) {
      if (!isRecord(source) || typeof source.url !== 'string') continue
      try {
        const url = new URL(source.url)
        if (url.protocol === 'https:') allowed.add(url.toString())
      } catch {
        // Ignore malformed provider source URLs.
      }
    }
  }
  return allowed
}

function sourceCoverage(urls: Iterable<string>): ResearchDiscoveryLane[] {
  const lanes = new Set<ResearchDiscoveryLane>()
  for (const value of urls) {
    let host: string
    try { host = new URL(value).hostname.toLowerCase() } catch { continue }
    if (SOCIAL_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`))) lanes.add('social')
    else if (DEMAND_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`))) lanes.add('search demand')
    else if (COMMERCE_HOSTS.some((domain) => host.includes(domain))) lanes.add('commerce')
    else lanes.add('trend media')
  }
  const ordered: ResearchDiscoveryLane[] = ['social', 'search demand', 'commerce', 'trend media']
  return ordered.filter((lane) => lanes.has(lane))
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

async function recordsFromResponse(response: JsonRecord, run: ResearchRunRow, now: Date): Promise<{ records: ViralSignalV1[]; rejected: number; evidence: Array<{ candidate_id: string; urls: string[] }>; diagnostics: ResearchRunDiagnostics }> {
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
  const diagnostics: ResearchCandidateDiagnostic[] = []
  const emptyDiagnostic = { why_discovered: [] as string[], missing_validation: [] as string[], evidence_classifications: [] as EvidenceClassification[], maximum_state: null, count_flag: null }
  let rejected = 0

  for (const candidate of candidates) {
    if (!isRecord(candidate)) {
      rejected += 1
      diagnostics.push({ name: null, product_url: null, evidence_urls: [], matched_evidence_count: 0, rejection_reasons: ['invalid_candidate_object'], ...emptyDiagnostic })
      continue
    }
    const name = optionalString(candidate.name, 160)
    const productUrl = optionalString(candidate.product_url, 2048)
    const topic = isRecord(candidate.topic) ? candidate.topic : null
    const topicName = topic ? optionalString(topic.name, 100) : undefined
    const urls = parseUrls(candidate.evidence_urls, allowed)
    const suppliedUrls = suppliedHttpsUrls(candidate.evidence_urls)
    const profiles = evidenceProfiles(candidate.evidence, allowed)
    const whyDiscovered = textList(candidate.why_discovered, 4, 240)
    const missingValidation = textList(candidate.missing_validation, 4, 240)
    const classifications = profiles.map((profile) => profile.classification)
    const launchEvidenceCount = classifications.filter((classification) => LAUNCH_CLASSIFICATIONS.has(classification)).length
    const independentConsumerCount = classifications.filter((classification) => classification === 'independent_social' || classification === 'consumer_activity').length
    const launchBiased = independentConsumerCount === 0 && launchEvidenceCount > classifications.length / 2
    const countFlag = hasConcatenatedReviewCounts(candidate.review_metrics) ? 'possible_concatenated_count' : null
    const signal = isRecord(candidate.signal) ? candidate.signal : null
    const type = signal ? optionalString(signal.type, 40) : undefined
    const value = signal?.value
    const confidence = candidate.confidence
    const rejectionReasons: string[] = []
    if (!name) rejectionReasons.push('missing_name')
    if (!productUrl) rejectionReasons.push('missing_product_url')
    if (!topicName) rejectionReasons.push('missing_topic_name')
    if (urls.length < 2) rejectionReasons.push('requires_two_returned_web_sources')
    else if (!hasDistinctDomains(urls)) rejectionReasons.push('requires_two_independent_domains')
    if (profiles.length !== 2 || new Set(profiles.map((profile) => profile.url)).size !== 2 || profiles.some((profile) => !urls.includes(profile.url))) rejectionReasons.push('missing_labeled_evidence_profiles')
    if (whyDiscovered.length === 0) rejectionReasons.push('missing_discovery_explanation')
    if (countFlag) rejectionReasons.push(countFlag)
    if (!signal) rejectionReasons.push('missing_signal')
    if (type && type !== 'search_interest' && type !== 'social_velocity' && type !== 'marketplace_rank' && type !== 'editorial_mentions') rejectionReasons.push('invalid_signal_type')
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) rejectionReasons.push('invalid_signal_value')
    if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) rejectionReasons.push('invalid_confidence')
    if (rejectionReasons.length > 0 || !signal ||
      (type !== 'search_interest' && type !== 'social_velocity' && type !== 'marketplace_rank' && type !== 'editorial_mentions') ||
      typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100 ||
      typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      rejected += 1
      diagnostics.push({ name: name ?? null, product_url: productUrl ?? null, evidence_urls: suppliedUrls, matched_evidence_count: urls.length, rejection_reasons: rejectionReasons, why_discovered: whyDiscovered, missing_validation: missingValidation, evidence_classifications: classifications, maximum_state: launchBiased ? 'emerging' : null, count_flag: countFlag })
      continue
    }
    // The branch above rejects every malformed field. Repeat the guard in a form
    // TypeScript can narrow before constructing the canonical signal.
    if (!name || !productUrl || !topicName || !signal || !type || typeof value !== 'number' || typeof confidence !== 'number') continue
    const brand = optionalString(candidate.brand, 100)
    const externalId = await stableId('research_candidate', `${name}\u0000${brand ?? ''}\u0000${productUrl}`)
    const observationId = await stableId('research_observation', `${run.id}\u0000${externalId}`)
    const candidateId = await stableId('candidate', brand
      ? `brand-name:${brand.toLocaleLowerCase('en-US')}\u0000${name.toLocaleLowerCase('en-US')}`
      : `source:${OPENAI_RESEARCH_SOURCE}\u0000${externalId}`)
    const availability = optionalString(candidate.availability_status, 20)
    const availabilityStatus = availability === 'available' || availability === 'backorder' || availability === 'preorder' || availability === 'announced' || availability === 'limited'
      ? availability
      : 'announced'
    const researchExplanation: ResearchExplanation = {
      why_discovered: whyDiscovered,
      missing_validation: missingValidation,
      evidence_classifications: classifications,
      maximum_state: launchBiased ? 'emerging' : null,
      maximum_confidence: launchBiased ? 0.45 : null,
    }
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
        ...(brand ? { brand } : {}),
        ...(optionalString(candidate.category, 100) ? { category: optionalString(candidate.category, 100) } : {}),
        topic: {
          name: topicName,
          ...(topic && optionalString(topic.slug, 90) ? { slug: optionalString(topic.slug, 90) } : {}),
          ...(topic && optionalString(topic.description, 500) ? { description: optionalString(topic.description, 500) } : {}),
        },
        product_url: productUrl,
        ...(optionalString(candidate.image_url, 2048) ? { image_url: optionalString(candidate.image_url, 2048) } : {}),
        search_terms: [name, ...(brand ? [brand] : [])],
        availability_status: availabilityStatus,
        research_explanation: researchExplanation,
      },
      signal: {
        type,
        value,
        ...(typeof signal.velocity === 'number' && signal.velocity >= -1 && signal.velocity <= 1 ? { velocity: signal.velocity } : {}),
      },
      confidence: Math.min(confidence, researchExplanation.maximum_confidence ?? 1),
      evidence_url: urls[0]!,
    })
    evidence.push({ candidate_id: candidateId, urls })
    diagnostics.push({ name, product_url: productUrl, evidence_urls: urls, matched_evidence_count: urls.length, rejection_reasons: [], why_discovered: whyDiscovered, missing_validation: missingValidation, evidence_classifications: classifications, maximum_state: researchExplanation.maximum_state, count_flag: null })
  }
  return {
    records,
    rejected,
    evidence,
    diagnostics: {
      source_urls: Array.from(allowed).slice(0, 40),
      discovery_lanes: sourceCoverage(allowed),
      candidates: diagnostics,
      summary: candidates.length === 0 ? 'OpenAI returned no candidate objects.' : records.length === 0 ? 'No candidates passed validation.' : null,
    },
  }
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
          required: ['name', 'brand', 'category', 'product_url', 'image_url', 'availability_status', 'topic', 'signal', 'confidence', 'evidence_urls', 'evidence', 'why_discovered', 'missing_validation', 'review_metrics'],
          properties: {
            name: { type: 'string' }, brand: { type: ['string', 'null'] }, category: { type: ['string', 'null'] },
            product_url: { type: 'string' }, image_url: { type: ['string', 'null'] }, availability_status: { type: ['string', 'null'] },
            topic: { type: 'object', additionalProperties: false, required: ['name', 'slug', 'description'], properties: { name: { type: 'string' }, slug: { type: ['string', 'null'] }, description: { type: ['string', 'null'] } } },
            signal: { type: 'object', additionalProperties: false, required: ['type', 'value', 'velocity'], properties: { type: { type: 'string', enum: ['search_interest', 'social_velocity', 'marketplace_rank', 'editorial_mentions'] }, value: { type: 'number' }, velocity: { type: ['number', 'null'] } } },
            confidence: { type: 'number' }, evidence_urls: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'string' } },
            evidence: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'object', additionalProperties: false, required: ['url', 'classification', 'supporting_quote'], properties: { url: { type: 'string' }, classification: { type: 'string', enum: EVIDENCE_CLASSIFICATIONS }, supporting_quote: { type: 'string' } } } },
            why_discovered: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'string' } },
            missing_validation: { type: 'array', maxItems: 4, items: { type: 'string' } },
            review_metrics: { type: 'object', additionalProperties: false, required: ['rating_count', 'question_count', 'count_confidence', 'supporting_quote'], properties: { rating_count: { type: ['integer', 'null'], minimum: 0 }, question_count: { type: ['integer', 'null'], minimum: 0 }, count_confidence: { type: ['number', 'null'], minimum: 0, maximum: 1 }, supporting_quote: { type: ['string', 'null'] } } },
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
      reasoning: { effort: 'high' },
      tools: [{ type: 'web_search', search_context_size: 'high', return_token_budget: 'unlimited' }],
      tool_choice: 'required',
      include: ['web_search_call.action.sources'],
      input: `You are FindItViral's high-recall consumer-product scout. Research newly viral, buyable products in the United States across collectibles, food, beauty, technology, apparel, home, and retail launches. Look above, below, and between the obvious headlines: uncover early chatter before it becomes mainstream, then verify it.

Before synthesizing candidates, perform separate web searches in each lane when public results are available:
1. Social conversation: TikTok product/hashtag discovery, X/Twitter discussions, Reddit communities, public Facebook/Instagram posts, and YouTube Shorts/creator coverage.
2. Search demand: Google Trends, Google Shopping, autocomplete-style query coverage, and breakout-search reporting.
3. Commerce: brand launches plus retailer and marketplace availability (including major retail, specialty, resale, and creator storefronts).
4. Trend confirmation: consumer trend publications, deal/community sites, trade coverage, and local or niche communities that corroborate emerging demand.
5. Counter-check: search for stock, product identity, and whether the claim is genuinely current rather than an old repost, rumor, or a single creator's ad.

Treat social platforms as discovery signals, not proof by themselves. Search broadly across the listed platforms but never claim a platform was searched if no public result was available. Return only product-specific candidates with a real official or retailer product URL and exactly two distinct current HTTPS evidence URLs from different domains. Label each cited page as brand_owned, founder_owned, press_release, retailer_listing, independent_editorial, independent_social, or consumer_activity. Explain why it was discovered and explicitly list missing validation. A product page is catalog evidence, not virality evidence. Use the one signal only for the strongest currently measured category; do not convert launch buzz into search or social velocity. For review counts, return null unless a labeled count and supporting quote are clear; never combine adjacent labels or infer a count from flattened text. Do not invent metrics, citations, availability, or viral claims. Keep confidence conservative and return up to ${MAX_CANDIDATES} candidates.`,
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
    // A force-cancel can arrive while OpenAI is responding. Do not create any
    // further candidates after that terminal state has been requested.
    const current = await getResearchRun(env.DB, runId)
    if (current?.status !== 'running') return
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
    diagnostics: research.diagnostics,
  })
}

export async function recordResearchFailure(env: Env, runId: string, error: unknown, retryable: boolean): Promise<void> {
  await failResearchRun(env.DB, runId, errorCode(error), new Date().toISOString(), retryable)
}
