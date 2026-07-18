import type { EvidenceClassification, ResearchCandidateDiagnostic, ResearchExplanation, ResearchLane, ResearchRunDiagnostics, ResearchRunRow, ViralSignalV1 } from './domain'
import { EngineError, errorCode } from './errors'
import { stableId } from './identity'
import { ingestSignalBatch } from './ingest'
import {
  claimFinalize,
  claimLaneCheckpoint,
  completeLaneCheckpoint,
  completeResearchRun,
  createLaneCheckpoints,
  createOrGetResearchRun,
  deleteQueuedResearchRun,
  failLaneCheckpoint,
  failResearchRun,
  getLaneCheckpoint,
  getLaneCheckpoints,
  getNextLaneToRun,
  getResearchRun,
  pauseResearchRun,
  resumeResearchRunToRunning,
  setLaneRetryWait,
} from './repository'
import { parseViralSignalBatch } from './validation'

export const OPENAI_RESEARCH_SOURCE = 'openai-research'
export const OPENAI_RESEARCH_PROMPT_VERSION = 'consumer-products-v2'
const MAX_CANDIDATES_PER_LANE = 2
const MAX_OUTPUT_TOKENS = 1_600

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

function rateLimitResetSeconds(value: string | null): number | undefined {
  if (!value) return undefined
  let matched = false
  let seconds = 0
  for (const match of value.matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h)/g)) {
    matched = true
    const amount = Number(match[1])
    const unit = match[2]
    seconds += amount * (unit === 'ms' ? 0.001 : unit === 's' ? 1 : unit === 'm' ? 60 : 3600)
  }
  return matched && Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : undefined
}

function providerRetryAfterSeconds(response: Response): number | undefined {
  const retryAfterHeader = response.headers.get('retry-after')
  const resets = [
    retryAfterHeader,
    response.headers.get('x-ratelimit-reset-tokens'),
    response.headers.get('x-ratelimit-reset-project-tokens'),
    response.headers.get('x-ratelimit-reset-requests'),
  ].flatMap((value) => {
    if (!value) return []
    // Retry-After can be seconds or HTTP-date
    if (/^\d+$/.test(value.trim())) {
      const seconds = Number(value.trim())
      return seconds > 0 ? [seconds] : []
    }
    const seconds = rateLimitResetSeconds(value)
    return seconds === undefined ? [] : [seconds]
  })
  return resets.length > 0 ? Math.max(...resets) : undefined
}

function isBillingOrQuotaError(body: unknown): boolean {
  if (!isRecord(body)) return false
  const error = isRecord(body.error) ? body.error : null
  if (!error || typeof error.type !== 'string') return false
  const type = error.type.toLowerCase()
  const code = typeof error.code === 'string' ? error.code.toLowerCase() : ''
  return type.includes('insufficient_quota') || type.includes('billing') ||
    code.includes('insufficient_quota') || code.includes('billing')
}

function openAiHttpFailure(response: Response, body: unknown): EngineError {
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
    const rateLimits = readOpenAiRateLimits(response)
    if (isBillingOrQuotaError(body)) {
      return new EngineError('OPENAI_RESEARCH_QUOTA_EXHAUSTED', `OpenAI billing quota exhausted. Check the API project billing configuration.${requestSuffix}`, 502, false, undefined, { provider_status: response.status, provider_error: body, rate_limits: rateLimits })
    }
    const retryAfterSeconds = providerRetryAfterSeconds(response)
    const retrySuffix = retryAfterSeconds ? ` Retrying after the provider reset window (about ${retryAfterSeconds}s).` : ''
    return new EngineError('OPENAI_RESEARCH_RATE_LIMITED', `OpenAI rate-limited the research request.${retrySuffix}${requestSuffix}`, 502, true, retryAfterSeconds, { provider_status: response.status, provider_error: body, rate_limits: rateLimits })
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

async function recordsFromResponse(response: JsonRecord, run: ResearchRunRow, lane: ResearchLane, now: Date): Promise<{ records: ViralSignalV1[]; rejected: number; evidence: Array<{ candidate_id: string; urls: string[] }>; diagnostics: ResearchRunDiagnostics }> {
  const text = outputText(response)
  if (!text) throw new EngineError('OPENAI_RESEARCH_INVALID_RESPONSE', 'OpenAI research response did not contain structured output.', 502, false)
  let parsed: unknown
  try {
    parsed = JSON.parse(text) as unknown
  } catch {
    throw new EngineError('OPENAI_RESEARCH_INVALID_RESPONSE', 'OpenAI research output was not valid JSON.', 502, false)
  }
  const candidates = isRecord(parsed) && Array.isArray(parsed.candidates) ? parsed.candidates.slice(0, MAX_CANDIDATES_PER_LANE) : []
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
    const evidenceHash = urls.slice().sort().join('\u0000')
    const observationId = await stableId('research_observation', `${run.id}\u0000${externalId}\u0000${lane}\u0000${type}\u0000${evidenceHash}`)
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
        maxItems: MAX_CANDIDATES_PER_LANE,
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

const LANE_PROMPTS: Record<ResearchLane, string> = {
  social: `You are FindItViral's high-recall consumer-product scout focused on SOCIAL CONVERSATION. Research newly viral, buyable products in the United States discovered through social platforms.

Search TikTok product/hashtag discovery, X/Twitter discussions, Reddit communities, public Facebook/Instagram posts, and YouTube Shorts/creator coverage. Find products with growing social buzz that are actually buyable.

Return only product-specific candidates with a real official or retailer product URL and exactly two distinct current HTTPS evidence URLs from different domains. Label each cited page as brand_owned, founder_owned, press_release, retailer_listing, independent_editorial, independent_social, or consumer_activity. Explain why it was discovered and explicitly list missing validation. Treat social platforms as discovery signals, not proof by themselves. Never claim a platform was searched if no public result was available. Do not invent metrics, citations, availability, or viral claims. Keep confidence conservative and return up to ${MAX_CANDIDATES_PER_LANE} candidates.`,

  search_demand: `You are FindItViral's high-recall consumer-product scout focused on SEARCH DEMAND. Research newly viral, buyable products in the United States discovered through search interest data.

Search Google Trends, Google Shopping, autocomplete-style query coverage, and breakout-search reporting. Find products with rising or breakout search interest that are actually buyable.

Return only product-specific candidates with a real official or retailer product URL and exactly two distinct current HTTPS evidence URLs from different domains. Label each cited page as brand_owned, founder_owned, press_release, retailer_listing, independent_editorial, independent_social, or consumer_activity. Explain why it was discovered and explicitly list missing validation. Do not invent metrics, citations, availability, or viral claims. Keep confidence conservative and return up to ${MAX_CANDIDATES_PER_LANE} candidates.`,

  commerce: `You are FindItViral's high-recall consumer-product scout focused on COMMERCE. Research newly viral, buyable products in the United States discovered through retail and marketplace availability.

Search brand launches plus retailer and marketplace availability (including major retail, specialty, resale, and creator storefronts). Find products with new or notable retail presence that also have viral momentum.

Return only product-specific candidates with a real official or retailer product URL and exactly two distinct current HTTPS evidence URLs from different domains. Label each cited page as brand_owned, founder_owned, press_release, retailer_listing, independent_editorial, independent_social, or consumer_activity. Explain why it was discovered and explicitly list missing validation. A product page is catalog evidence, not virality evidence. Do not invent metrics, citations, availability, or viral claims. Keep confidence conservative and return up to ${MAX_CANDIDATES_PER_LANE} candidates.`,

  trend_media: `You are FindItViral's high-recall consumer-product scout focused on TREND CONFIRMATION. Research newly viral, buyable products in the United States discovered through trend publications and media coverage.

Search consumer trend publications, deal/community sites, trade coverage, and local or niche communities that corroborate emerging demand. Verify whether claims are genuinely current rather than old reposts, rumors, or a single creator's ad.

Return only product-specific candidates with a real official or retailer product URL and exactly two distinct current HTTPS evidence URLs from different domains. Label each cited page as brand_owned, founder_owned, press_release, retailer_listing, independent_editorial, independent_social, or consumer_activity. Explain why it was discovered and explicitly list missing validation. Do not invent metrics, citations, availability, or viral claims. Keep confidence conservative and return up to ${MAX_CANDIDATES_PER_LANE} candidates.`,
}

type OpenAiRateLimits = {
  requestId: string | null
  limitRequests: number | null
  remainingRequests: number | null
  resetRequestsSeconds: number | null
  limitTokens: number | null
  remainingTokens: number | null
  resetTokensSeconds: number | null
}

function numericHeader(
  response: Response,
  name: string,
): number | null {
  const value = response.headers.get(name)
  if (!value) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function resetHeaderSeconds(
  response: Response,
  name: string,
): number | null {
  const value = response.headers.get(name)
  if (!value) return null
  const seconds = rateLimitResetSeconds(value)
  return seconds ?? null
}

function readOpenAiRateLimits(
  response: Response,
): OpenAiRateLimits {
  return {
    requestId: response.headers.get('x-request-id'),
    limitRequests: numericHeader(response, 'x-ratelimit-limit-requests'),
    remainingRequests: numericHeader(response, 'x-ratelimit-remaining-requests'),
    resetRequestsSeconds: resetHeaderSeconds(response, 'x-ratelimit-reset-requests'),
    limitTokens: numericHeader(response, 'x-ratelimit-limit-tokens'),
    remainingTokens: numericHeader(response, 'x-ratelimit-remaining-tokens'),
    resetTokensSeconds: resetHeaderSeconds(response, 'x-ratelimit-reset-tokens'),
  }
}

type OpenAiLaneResult = {
  body: JsonRecord
  rateLimits: OpenAiRateLimits
}

async function callOpenAiLane(env: Env, lane: ResearchLane): Promise<OpenAiLaneResult> {
  if (!env.OPENAI_API_KEY || env.OPENAI_API_KEY.length < 20) {
    throw new EngineError('OPENAI_RESEARCH_NOT_CONFIGURED', 'OPENAI_API_KEY is missing or invalid.', 500, false)
  }
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: configuredModel(env),
      max_output_tokens: MAX_OUTPUT_TOKENS,
      max_tool_calls: 3,
      reasoning: { effort: 'medium' },
      tools: [{ type: 'web_search', search_context_size: 'low' }],
      tool_choice: 'required',
      include: ['web_search_call.action.sources'],
      input: LANE_PROMPTS[lane],
      text: { format: { type: 'json_schema', name: 'viral_research_candidates', strict: true, schema: responseSchema() } },
    }),
  })
  const rateLimits = readOpenAiRateLimits(response)
  const body = await response.json().catch(() => null)
  if (!response.ok) throw openAiHttpFailure(response, body)
  if (!isRecord(body)) throw new EngineError('OPENAI_RESEARCH_INVALID_RESPONSE', 'OpenAI research response was not a JSON object.', 502, false)
  const webSearchCalls = Array.isArray(body.output)
    ? body.output.filter(
        item => isRecord(item) && item.type === 'web_search_call',
      ).length
    : 0
  console.log(JSON.stringify({
    event: 'openai_lane_usage',
    lane,
    response_id: typeof body.id === 'string' ? body.id : null,
    web_search_calls: webSearchCalls,
    input_tokens: isRecord(body.usage) && typeof body.usage.input_tokens === 'number' ? body.usage.input_tokens : null,
    output_tokens: isRecord(body.usage) && typeof body.usage.output_tokens === 'number' ? body.usage.output_tokens : null,
  }))
  return { body, rateLimits }
}

export function computeRetryDelay(retryAfterSeconds: number | undefined, attempts: number): number {
  const exponentialDelay = Math.min(30 * (2 ** Math.max(0, attempts - 1)), 3600)
  const base = retryAfterSeconds ? Math.min(Math.max(exponentialDelay, retryAfterSeconds), 3600) : exponentialDelay
  const jitter = Math.floor(Math.random() * 15)
  return Math.min(base + jitter, 3600)
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
    await createLaneCheckpoints(env.DB, result.run.id, now.toISOString())
    await env.RESEARCH_QUEUE.send({ kind: 'research_lane', run_id: result.run.id, lane: 'social' })
  } catch (error) {
    await deleteQueuedResearchRun(env.DB, result.run.id)
    throw error
  }
  return result
}

export function computeNextLaneDelay(
  rateLimits?: OpenAiRateLimits,
): number {
  const jitter = Math.floor(Math.random() * 31)

  if (!rateLimits) {
    return 300 + jitter
  }

  const requestExhausted =
    rateLimits.remainingRequests !== null &&
    rateLimits.remainingRequests <= 1

  const tokenLimit = rateLimits.limitTokens
  const remainingTokens = rateLimits.remainingTokens

  const tokenCapacityLow =
    tokenLimit !== null &&
    remainingTokens !== null &&
    remainingTokens < Math.max(4_000, tokenLimit * 0.25)

  const resetSeconds = Math.max(
    requestExhausted ? rateLimits.resetRequestsSeconds ?? 0 : 0,
    tokenCapacityLow ? rateLimits.resetTokensSeconds ?? 0 : 0,
  )

  if (resetSeconds > 0) {
    return Math.min(Math.max(resetSeconds + jitter, 60), 3_600)
  }

  return 300 + jitter
}

export async function enqueueNextLane(
  env: Env,
  runId: string,
  rateLimits?: OpenAiRateLimits,
): Promise<void> {
  const now = new Date()
  const nextLane = await getNextLaneToRun(env.DB, runId, now.toISOString())
  if (nextLane) {
    await env.RESEARCH_QUEUE.send(
      { kind: 'research_lane', run_id: runId, lane: nextLane },
      { delaySeconds: computeNextLaneDelay(rateLimits) },
    )
    return
  }
  await env.RESEARCH_QUEUE.send({ kind: 'research_finalize', run_id: runId })
}

export type LaneExecutionResult =
  | { outcome: 'completed' }
  | { outcome: 'replacement_scheduled' }
  | { outcome: 'busy' }

export async function executeResearchLane(env: Env, runId: string, lane: ResearchLane, now = new Date()): Promise<LaneExecutionResult> {
  const run = await getResearchRun(env.DB, runId)
  if (!run) throw new EngineError('RESEARCH_RUN_NOT_FOUND', 'Research run does not exist.', 404, false)
  if (run.status === 'failed' || run.status === 'succeeded') return { outcome: 'completed' }

  const leaseUntil = new Date(now.getTime() + 5 * 60 * 1000).toISOString()
  const claim = await claimLaneCheckpoint(env.DB, runId, lane, now.toISOString(), leaseUntil)
  if (claim === 'completed') {
    await enqueueNextLane(env, runId)
    return { outcome: 'completed' }
  }
  if (claim === 'busy') return { outcome: 'busy' }

  // Transition run from paused_rate_limit/queued back to running now that we have a lane claim.
  await resumeResearchRunToRunning(env.DB, runId, now.toISOString(), leaseUntil)

  const checkpoint = await getLaneCheckpoint(env.DB, runId, lane)
  const attempts = checkpoint?.attempts ?? 0

  try {
    const openAiResult = await callOpenAiLane(env, lane)
    const response = openAiResult.body
    const research = await recordsFromResponse(response, run, lane, now)
    const requestId = response.id as string | undefined ?? null
    const usage = response.usage as Record<string, unknown> | undefined ?? {}
    await completeLaneCheckpoint(env.DB, runId, lane, {
      candidatesJson: JSON.stringify(research.records),
      evidenceJson: JSON.stringify(research.evidence),
      diagnosticsJson: JSON.stringify(research.diagnostics),
      requestId: typeof requestId === 'string' ? requestId : null,
      usageJson: JSON.stringify(usage),
      rateLimitDiagnosticsJson: JSON.stringify(openAiResult.rateLimits),
      now: now.toISOString(),
    })
    await enqueueNextLane(env, runId, openAiResult.rateLimits)
    return { outcome: 'completed' }
  } catch (error) {
    if (error instanceof EngineError && error.code === 'OPENAI_RESEARCH_RATE_LIMITED') {
      const rateLimits = error.details?.['rate_limits'] as OpenAiRateLimits | undefined
      const resetSeconds = Math.max(
        rateLimits?.resetRequestsSeconds ?? 0,
        rateLimits?.resetTokensSeconds ?? 0,
        error.retryAfterSeconds ?? 0,
      )
      const baseDelay = computeRetryDelay(resetSeconds || undefined, attempts + 1)
      const delay = Math.min(baseDelay + 30 + Math.floor(Math.random() * 31), 3_600)
      const nextRetryAt = new Date(now.getTime() + delay * 1000).toISOString()
      const rateLimitDiag = JSON.stringify(error.details ?? {})
      await setLaneRetryWait(env.DB, runId, lane, nextRetryAt, rateLimitDiag, now.toISOString())
      await pauseResearchRun(env.DB, runId)
      await env.RESEARCH_QUEUE.send(
        { kind: 'research_lane', run_id: runId, lane },
        { delaySeconds: delay },
      )
      return { outcome: 'replacement_scheduled' }
    }
    const retryable = !(error instanceof EngineError) || error.retryable
    if (retryable) {
      const delay = computeRetryDelay(undefined, attempts + 1)
      const nextRetryAt = new Date(now.getTime() + delay * 1000).toISOString()
      await setLaneRetryWait(env.DB, runId, lane, nextRetryAt, '{}', now.toISOString())
      await env.RESEARCH_QUEUE.send(
        { kind: 'research_lane', run_id: runId, lane },
        { delaySeconds: delay },
      )
      return { outcome: 'replacement_scheduled' }
    }
    await failLaneCheckpoint(env.DB, runId, lane, errorCode(error), now.toISOString())
    await failResearchRun(env.DB, runId, errorCode(error), now.toISOString(), false)
    throw error
  }
}

export async function finalizeResearchRun(env: Env, runId: string, now = new Date()): Promise<void> {
  const run = await getResearchRun(env.DB, runId)
  if (!run) throw new EngineError('RESEARCH_RUN_NOT_FOUND', 'Research run does not exist.', 404, false)
  if (run.status === 'succeeded' || run.status === 'failed') return

  if (run.status !== 'finalizing') {
    const claimed = await claimFinalize(env.DB, runId)
    if (!claimed) return
  }

  const checkpoints = await getLaneCheckpoints(env.DB, runId)
  const allRecords: ViralSignalV1[] = []
  const allEvidence: Array<{ candidate_id: string; urls: string[] }> = []
  const allSourceUrls = new Set<string>()
  const allCandidateDiagnostics: ResearchCandidateDiagnostic[] = []
  let totalRejected = 0

  for (const cp of checkpoints) {
    if (cp.status !== 'succeeded') continue
    const records: ViralSignalV1[] = JSON.parse(cp.candidates_json)
    const evidence: Array<{ candidate_id: string; urls: string[] }> = JSON.parse(cp.evidence_json)
    const diagnostics: ResearchRunDiagnostics = JSON.parse(cp.diagnostics_json)
    allRecords.push(...records)
    allEvidence.push(...evidence)
    allCandidateDiagnostics.push(...diagnostics.candidates)
    totalRejected += diagnostics.candidates.filter((c) => c.rejection_reasons.length > 0).length
    for (const url of diagnostics.source_urls) allSourceUrls.add(url)
  }

  const ingestion = { received: 0, accepted: 0, duplicates: 0, candidateIds: [] as string[] }
  for (let index = 0; index < allRecords.length; index += 4) {
    const current = await getResearchRun(env.DB, runId)
    if (current?.status !== 'finalizing') return
    const batch = parseViralSignalBatch({ schema_version: 1, records: allRecords.slice(index, index + 4) }, now)
    const result = await ingestSignalBatch(env.DB, batch, 'scheduled', now)
    ingestion.received += result.received
    ingestion.accepted += result.accepted
    ingestion.duplicates += result.duplicates
    ingestion.candidateIds.push(...result.candidateIds)
  }

  const mergedDiagnostics: ResearchRunDiagnostics = {
    source_urls: Array.from(allSourceUrls).slice(0, 40),
    discovery_lanes: sourceCoverage(allSourceUrls),
    candidates: allCandidateDiagnostics.slice(0, 12),
    summary: allRecords.length === 0 ? 'No candidates passed validation across lanes.' : null,
  }

  await completeResearchRun(env.DB, runId, {
    now: new Date().toISOString(),
    received: allRecords.length,
    accepted: ingestion.accepted,
    duplicates: ingestion.duplicates,
    rejected: totalRejected,
    candidateIds: ingestion.candidateIds,
    evidence: allEvidence,
    diagnostics: mergedDiagnostics,
  })
}

export async function executeResearchRun(env: Env, runId: string, now = new Date()): Promise<void> {
  const run = await getResearchRun(env.DB, runId)
  if (!run) throw new EngineError('RESEARCH_RUN_NOT_FOUND', 'Research run does not exist.', 404, false)
  const openAiResult = await callOpenAiLane(env, 'social')
  const research = await recordsFromResponse(openAiResult.body, run, 'social', now)
  const ingestion = { received: 0, accepted: 0, duplicates: 0, candidateIds: [] as string[] }
  for (let index = 0; index < research.records.length; index += 4) {
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
