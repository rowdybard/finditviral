import { describe, expect, it } from 'vitest'
import type { DigestClaim } from '../src/domain'
import { renderDigestEmail } from '../src/email'
import {
  classifyDeliveryFailure,
  MissingMessageIdError,
  sanitizeErrorMessage,
} from '../src/errors'

const claim: DigestClaim = {
  runId: '11111111-1111-4111-8111-111111111111',
  runLocalDate: '2026-07-13',
  cutoffAt: '2026-07-13T12:00:00.000Z',
  attemptId: '22222222-2222-4222-8222-222222222222',
  attemptNumber: 1,
  leaseToken: '33333333-3333-4333-8333-333333333333',
  items: [{
    eventId: '44444444-4444-4444-8444-444444444444',
    source: 'early_access',
    occurredAt: '2026-07-12T20:00:00.000Z',
    email: 'shopper@example.com',
    username: null,
    interest: '<script>alert("nope")</script>',
  }],
}

describe('digest email', () => {
  it('includes a plain-text alternative and escapes untrusted HTML', () => {
    const email = renderDigestEmail(claim)
    expect(email.subject).toContain('July 13, 2026')
    expect(email.text).toContain('<script>alert("nope")</script>')
    expect(email.html).toContain('&lt;script&gt;alert(&quot;nope&quot;)&lt;/script&gt;')
    expect(email.html).not.toContain('<script>')
  })
})

describe('delivery failure handling', () => {
  it('classifies known platform failures narrowly', () => {
    expect(classifyDeliveryFailure({ code: 'E_RATE_LIMIT_EXCEEDED' })).toBe('transient_failure')
    expect(classifyDeliveryFailure({ code: 'E_SENDER_NOT_VERIFIED' })).toBe('permanent_failure')
    expect(classifyDeliveryFailure(new MissingMessageIdError())).toBe('uncertain')
    expect(classifyDeliveryFailure(new Error('connection closed'))).toBe('uncertain')
  })

  it('removes credentials and email addresses from persisted error text', () => {
    expect(sanitizeErrorMessage(
      'Bearer eyJabc.def.ghi sb_secret_abc123 owner@example.com',
    )).toBe('Bearer [redacted] [redacted-api-key] [redacted-email]')
  })
})

