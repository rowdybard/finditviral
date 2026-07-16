import { describe, expect, it } from 'vitest'
import type { CandidateProjectionRow } from '../src/domain'
import { evaluatePatchPolicy } from '../src/policy'

function candidate(overrides: Partial<CandidateProjectionRow> = {}): CandidateProjectionRow {
  return {
    id: 'candidate_123',
    identity_key: 'brand-name:nova-toys:galaxy-glow-mini-printer',
    name: 'Galaxy Glow Mini Printer',
    slug_suggestion: 'galaxy-glow-mini-printer',
    brand: 'Nova Toys',
    gtin: null,
    category: 'Tech toys',
    topic_name: 'Pocket Creativity',
    topic_slug: 'pocket-creativity',
    topic_description: null,
    product_url: 'https://products.example.com/galaxy-glow-mini-printer',
    product_url_verified: 1,
    image_url: null,
    search_terms_json: '[]',
    availability_status: 'available',
    release_date: null,
    first_seen_at: '2026-07-16T10:00:00.000Z',
    last_seen_at: '2026-07-16T12:00:00.000Z',
    review_status: 'pending',
    review_overrides_json: null,
    reviewed_at: null,
    score: 90,
    previous_score: 75,
    momentum: 0.5,
    score_confidence: 0.85,
    source_count: 3,
    signal_count: 4,
    state: 'trending',
    score_version: 'viral-score-2026-07-v1',
    score_computed_at: '2026-07-16T12:00:00.000Z',
    ...overrides,
  }
}

describe('catalog publication policy', () => {
  it('keeps shadow patches non-publishable while still allowing a draft', () => {
    expect(evaluatePatchPolicy(candidate(), 'shadow', new Date('2026-07-16T12:30:00.000Z')))
      .toEqual({ eligible: true, ready: false, reasons: [] })
  })

  it('requires explicit approval in review mode', () => {
    const now = new Date('2026-07-16T12:30:00.000Z')
    expect(evaluatePatchPolicy(candidate(), 'review', now).eligible).toBe(false)
    expect(evaluatePatchPolicy(candidate({ review_status: 'approved' }), 'review', now).ready).toBe(true)
  })

  it('allows only high-confidence multi-source candidates through autopilot', () => {
    const now = new Date('2026-07-16T12:30:00.000Z')
    expect(evaluatePatchPolicy(candidate(), 'autopilot', now).ready).toBe(true)
    expect(evaluatePatchPolicy(candidate({ source_count: 2 }), 'autopilot', now).eligible).toBe(false)
    expect(evaluatePatchPolicy(candidate({ review_status: 'rejected' }), 'autopilot', now).eligible).toBe(false)
  })
})
