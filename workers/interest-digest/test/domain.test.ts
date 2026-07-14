import { describe, expect, it } from 'vitest'
import { parseDigestClaimResponse } from '../src/domain'

const validClaim = {
  run_id: '11111111-1111-4111-8111-111111111111',
  run_local_date: '2026-07-13',
  cutoff_at: '2026-07-13T12:00:00.000Z',
  attempt_id: '22222222-2222-4222-8222-222222222222',
  attempt_number: 1,
  lease_token: '33333333-3333-4333-8333-333333333333',
  items: [
    {
      event_id: '44444444-4444-4444-8444-444444444444',
      source: 'early_access',
      occurred_at: '2026-07-12T20:00:00.000Z',
      email: 'shopper@example.com',
      username: null,
      interest: 'I am looking for a limited plush release.',
    },
  ],
}

describe('parseDigestClaimResponse', () => {
  it('treats an empty result as no work', () => {
    expect(parseDigestClaimResponse([])).toBeNull()
  })

  it('maps the service RPC contract into the worker model', () => {
    expect(parseDigestClaimResponse([validClaim])).toMatchObject({
      runId: validClaim.run_id,
      attemptId: validClaim.attempt_id,
      attemptNumber: 1,
      items: [{ eventId: validClaim.items[0].event_id, source: 'early_access' }],
    })
  })

  it('rejects duplicate events and more than one claimed row', () => {
    expect(() => parseDigestClaimResponse([validClaim, validClaim])).toThrow(/at most one row/)
    expect(() => parseDigestClaimResponse([{
      ...validClaim,
      items: [validClaim.items[0], validClaim.items[0]],
    }])).toThrow(/duplicate event IDs/)
  })

  it('forces onboarding_looking_for email to null even if database leaks one', () => {
    const result = parseDigestClaimResponse([{
      ...validClaim,
      items: [{
        event_id: '55555555-5555-4555-8555-555555555555',
        source: 'onboarding_looking_for',
        occurred_at: '2026-07-12T20:00:00.000Z',
        email: 'leaked@example.com',
        username: 'bargainhunter',
        interest: 'Looking for viral snacks.',
      }],
    }])
    expect(result).not.toBeNull()
    expect(result!.items[0].email).toBeNull()
  })
})

