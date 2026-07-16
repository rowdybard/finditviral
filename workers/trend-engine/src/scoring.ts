import {
  PATCH_POLICY_VERSION,
  SCORE_VERSION,
  type CandidateState,
  type CurrentScoreRow,
  type ScoreSignalInput,
  type ScoreSnapshot,
  type SignalType,
} from './domain'

const HALF_LIFE_HOURS = 24
const TYPE_WEIGHTS: Record<SignalType, number> = {
  search_interest: 1,
  social_velocity: 1,
  marketplace_rank: 0.9,
  editorial_mentions: 0.6,
  fiv_demand: 0.85,
  manual: 0.5,
}

interface IndependenceGroup {
  weightedValue: number
  weightedMomentum: number
  trustTotal: number
  qualityWeight: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function round(value: number, precision = 4): number {
  const factor = 10 ** precision
  return Math.round(value * factor) / factor
}

function derivedMomentum(signal: ScoreSignalInput): number {
  if (signal.velocity !== null) return signal.velocity
  if (signal.rank !== null && signal.previousRank !== null) {
    return clamp((signal.previousRank - signal.rank) / Math.max(signal.previousRank, signal.rank), -1, 1)
  }
  return 0
}

function classifyState(
  score: number,
  confidence: number,
  momentum: number,
  previous: CurrentScoreRow | null,
): CandidateState {
  if (previous?.state === 'trending' && (score < 65 || momentum <= -0.2 || (previous.score - score) >= 12)) {
    return 'cooling'
  }
  if (score >= 65 && confidence >= 0.5) return 'trending'
  if (score >= 40) return 'emerging'
  return 'candidate'
}

export function computeScore(
  signals: ScoreSignalInput[],
  previous: CurrentScoreRow | null,
  now = new Date(),
): ScoreSnapshot {
  const nowMs = now.getTime()
  const active = signals.filter((signal) => {
    const observed = Date.parse(signal.observedAt)
    const expires = Date.parse(signal.expiresAt)
    return Number.isFinite(observed) && Number.isFinite(expires) && observed <= nowMs && expires > nowMs
  })

  if (active.length === 0) {
    return {
      score: 0,
      previousScore: previous?.score ?? null,
      momentum: -1,
      confidence: 0,
      sourceCount: 0,
      signalCount: 0,
      state: 'archived',
      explanation: {
        policy_version: PATCH_POLICY_VERSION,
        weighted_signal: 0,
        recency_weight: 0,
        source_breadth: 0,
        momentum_adjustment: -15,
        active_signal_count: 0,
        distinct_source_count: 0,
      },
      scoreVersion: SCORE_VERSION,
      computedAt: now.toISOString(),
    }
  }

  let weightTotal = 0
  let weightedValueTotal = 0
  let weightedMomentumTotal = 0
  let recencyTotal = 0
  const groups = new Map<string, IndependenceGroup>()

  for (const signal of active) {
    const ageHours = Math.max(0, nowMs - Date.parse(signal.observedAt)) / (60 * 60 * 1000)
    const recency = 0.5 ** (ageHours / HALF_LIFE_HOURS)
    const qualityWeight = signal.confidence * TYPE_WEIGHTS[signal.signalType] * recency
    const group = groups.get(signal.independenceKey) ?? {
      weightedValue: 0,
      weightedMomentum: 0,
      trustTotal: 0,
      qualityWeight: 0,
    }
    group.weightedValue += signal.value * qualityWeight
    group.weightedMomentum += derivedMomentum(signal) * qualityWeight
    group.trustTotal += signal.trustWeight * qualityWeight
    group.qualityWeight += qualityWeight
    groups.set(signal.independenceKey, group)
    recencyTotal += recency
  }

  let independentSourceCount = 0
  for (const group of groups.values()) {
    if (group.qualityWeight <= 0) continue
    const groupValue = group.weightedValue / group.qualityWeight
    const groupMomentum = group.weightedMomentum / group.qualityWeight
    const groupTrust = group.trustTotal / group.qualityWeight
    // Repeated observations from one upstream can improve that upstream's quality,
    // but can never outweigh an actually independent source.
    const groupWeight = groupTrust * Math.min(1, group.qualityWeight)
    if (groupWeight <= 0) continue
    independentSourceCount += 1
    weightTotal += groupWeight
    weightedValueTotal += groupValue * groupWeight
    weightedMomentumTotal += groupMomentum * groupWeight
  }

  const weightedSignal = weightTotal > 0 ? weightedValueTotal / weightTotal : 0
  const momentum = weightTotal > 0 ? clamp(weightedMomentumTotal / weightTotal, -1, 1) : 0
  const sourceBreadth = clamp((independentSourceCount - 1) / 2, 0, 1)
  const breadthBonus = sourceBreadth * 15
  const momentumAdjustment = momentum * 15
  const score = clamp((weightedSignal * 0.85) + breadthBonus + momentumAdjustment, 0, 100)
  const coverage = 1 - Math.exp(-weightTotal / 2)
  const diversity = clamp(independentSourceCount / 3, 0, 1)
  const confidence = clamp((coverage * 0.7) + (diversity * 0.3), 0, 1)

  return {
    score: round(score, 2),
    previousScore: previous?.score ?? null,
    momentum: round(momentum),
    confidence: round(confidence),
    sourceCount: independentSourceCount,
    signalCount: active.length,
    state: classifyState(score, confidence, momentum, previous),
    explanation: {
      policy_version: PATCH_POLICY_VERSION,
      weighted_signal: round(weightedSignal, 2),
      recency_weight: round(recencyTotal / active.length),
      source_breadth: round(sourceBreadth),
      momentum_adjustment: round(momentumAdjustment, 2),
      active_signal_count: active.length,
      distinct_source_count: independentSourceCount,
    },
    scoreVersion: SCORE_VERSION,
    computedAt: now.toISOString(),
  }
}
