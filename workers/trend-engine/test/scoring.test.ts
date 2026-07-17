import { describe, expect, it } from 'vitest'
import type { CurrentScoreRow, ScoreSignalInput } from '../src/domain'
import { computeScore } from '../src/scoring'

const now = new Date('2026-07-16T12:00:00.000Z')

function signal(sourceId: string, overrides: Partial<ScoreSignalInput> = {}): ScoreSignalInput {
  return {
    sourceId,
    independenceKey: sourceId,
    trustWeight: 0.9,
    signalType: 'social_velocity',
    value: 90,
    velocity: 0.45,
    rank: null,
    previousRank: null,
    confidence: 0.95,
    observedAt: '2026-07-16T11:50:00.000Z',
    expiresAt: '2026-07-18T12:00:00.000Z',
    ...overrides,
  }
}

function previousTrending(score = 88): CurrentScoreRow {
  return {
    candidate_id: 'candidate_test',
    score,
    previous_score: 80,
    momentum: 0.4,
    confidence: 0.8,
    source_count: 3,
    signal_count: 3,
    state: 'trending',
    explanation_json: '{}',
    score_version: 'older-version',
    computed_at: '2026-07-16T11:00:00.000Z',
  }
}

describe('viral score', () => {
  it('requires multi-source confidence before classifying a high value as trending', () => {
    const oneSource = computeScore([signal('source-a')], null, now)
    const threeSources = computeScore([
      signal('source-a'),
      signal('source-b', { signalType: 'search_interest' }),
      signal('source-c', { signalType: 'marketplace_rank' }),
    ], null, now)

    expect(oneSource.state).toBe('emerging')
    expect(threeSources.state).toBe('trending')
    expect(threeSources.confidence).toBeGreaterThan(oneSource.confidence)
    expect(threeSources.sourceCount).toBe(3)
  })

  it('requires two distinct signal categories before promoting a candidate to trending', () => {
    const oneCategory = computeScore([
      signal('source-a'), signal('source-b'), signal('source-c'),
    ], null, now)
    expect(oneCategory.state).toBe('emerging')
    expect(oneCategory.explanation.confirmed_signal_categories).toEqual(['social_velocity'])
    expect(oneCategory.explanation.trending_gate_passed).toBe(false)
  })

  it('caps launch-led research at emerging with conservative confidence', () => {
    const result = computeScore([
      signal('source-a'),
      signal('source-b', { signalType: 'search_interest' }),
      signal('source-c', { signalType: 'marketplace_rank' }),
    ], null, now, { maximumState: 'emerging', maximumConfidence: 0.45 })
    expect(result.state).toBe('emerging')
    expect(result.confidence).toBeLessThanOrEqual(0.45)
    expect(result.explanation.maximum_state).toBe('emerging')
  })

  it('moves a formerly trending candidate into cooling when momentum reverses', () => {
    const result = computeScore([
      signal('source-a', { value: 55, velocity: -0.8 }),
      signal('source-b', { value: 50, velocity: -0.7 }),
    ], previousTrending(), now)

    expect(result.state).toBe('cooling')
    expect(result.momentum).toBeLessThan(0)
  })

  it('archives a candidate after all evidence expires', () => {
    const result = computeScore([
      signal('source-a', { expiresAt: '2026-07-16T11:00:00.000Z' }),
    ], previousTrending(), now)

    expect(result).toMatchObject({ state: 'archived', score: 0, confidence: 0 })
  })

  it('does not let mirrored or repeated signals impersonate independent evidence', () => {
    const result = computeScore([
      signal('mirror-a', { independenceKey: 'same-upstream' }),
      signal('mirror-b', { independenceKey: 'same-upstream', signalType: 'search_interest' }),
      signal('mirror-c', { independenceKey: 'same-upstream', signalType: 'marketplace_rank' }),
      signal('untrusted-a', { independenceKey: 'untrusted-a', trustWeight: 0 }),
      signal('untrusted-b', { independenceKey: 'untrusted-b', trustWeight: 0 }),
    ], null, now)

    expect(result.sourceCount).toBe(1)
    expect(result.state).toBe('emerging')
  })
})
