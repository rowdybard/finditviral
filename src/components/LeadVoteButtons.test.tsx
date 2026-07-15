import { describe, expect, it } from 'vitest'

type VoteType = 'credible' | 'doubtful'

function computeNetScore(credible: number, doubtful: number): number {
  return credible - doubtful
}

function isVoteActive(currentVote: VoteType | null, vote: VoteType): boolean {
  return currentVote === vote
}

describe('LeadVoteButtons logic', () => {
  it('computes net score as credible minus doubtful', () => {
    expect(computeNetScore(5, 2)).toBe(3)
    expect(computeNetScore(0, 3)).toBe(-3)
    expect(computeNetScore(0, 0)).toBe(0)
  })

  it('identifies active vote correctly', () => {
    expect(isVoteActive('credible', 'credible')).toBe(true)
    expect(isVoteActive('doubtful', 'doubtful')).toBe(true)
    expect(isVoteActive('credible', 'doubtful')).toBe(false)
    expect(isVoteActive(null, 'credible')).toBe(false)
    expect(isVoteActive(null, 'doubtful')).toBe(false)
  })
})
