import type { CandidateProjectionRow, EngineMode, PatchPolicyDecision } from './domain'

export const AUTOPILOT_MIN_SCORE = 80
export const AUTOPILOT_MIN_CONFIDENCE = 0.75
export const AUTOPILOT_MIN_SOURCES = 3
export const MAX_SCORE_AGE_MS = 2 * 60 * 60 * 1000

export function evaluatePatchPolicy(
  candidate: CandidateProjectionRow,
  mode: EngineMode,
  now = new Date(),
): PatchPolicyDecision {
  const reasons: string[] = []
  if (candidate.review_status === 'rejected') reasons.push('candidate was rejected')
  if (candidate.state !== 'trending') reasons.push('candidate is not currently trending')
  if (!candidate.product_url || candidate.product_url_verified !== 1) {
    reasons.push('candidate has no verified catalog product URL')
  }
  if (!candidate.availability_status) reasons.push('candidate has no catalog availability status')
  if (candidate.availability_status === 'retired') reasons.push('retired products cannot be activated')
  const scoreComputedAt = candidate.score_computed_at ? Date.parse(candidate.score_computed_at) : Number.NaN
  if (!Number.isFinite(scoreComputedAt) || scoreComputedAt < now.getTime() - MAX_SCORE_AGE_MS) {
    reasons.push('candidate score is stale')
  }

  const score = candidate.score ?? 0
  const confidence = candidate.score_confidence ?? 0
  const sourceCount = candidate.source_count ?? 0

  if (mode === 'review' && candidate.review_status !== 'approved') {
    reasons.push('candidate has not been approved')
  }
  if (mode === 'autopilot' && candidate.review_status !== 'approved') {
    if (score < AUTOPILOT_MIN_SCORE) reasons.push(`score is below ${AUTOPILOT_MIN_SCORE}`)
    if (confidence < AUTOPILOT_MIN_CONFIDENCE) reasons.push(`confidence is below ${AUTOPILOT_MIN_CONFIDENCE}`)
    if (sourceCount < AUTOPILOT_MIN_SOURCES) reasons.push(`fewer than ${AUTOPILOT_MIN_SOURCES} independent sources agree`)
  }

  return {
    eligible: reasons.length === 0,
    ready: reasons.length === 0 && mode !== 'shadow',
    reasons,
  }
}
