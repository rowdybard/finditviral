import { describe, expect, it } from 'vitest'
import { ValidationError } from '../src/errors'
import { parseViralSignalBatch } from '../src/validation'
import { makeSignal } from './fixtures'

describe('ViralSignalV1 validation', () => {
  it('normalizes a valid, current signal batch', () => {
    const now = new Date('2026-07-16T12:00:00.000Z')
    const record = makeSignal({ source: 'social-source', now })
    const parsed = parseViralSignalBatch({ schema_version: 1, records: [record] }, now)

    expect(parsed.records).toHaveLength(1)
    expect(parsed.records[0]?.candidate.name).toBe('Galaxy Glow Mini Printer')
    expect(parsed.records[0]?.evidence_url).toMatch(/^https:\/\//)
  })

  it('rejects stale evidence, arbitrary HTTP URLs, and invalid normalized values together', () => {
    const now = new Date('2026-07-16T12:00:00.000Z')
    const record = makeSignal({ source: 'social-source', now })
    const invalid = {
      ...record,
      observed_at: '2026-05-01T00:00:00.000Z',
      expires_at: '2026-08-01T00:00:00.000Z',
      evidence_url: 'http://insecure.example.com/evidence',
      signal: { ...record.signal, value: 150 },
    }

    expect(() => parseViralSignalBatch({ schema_version: 1, records: [invalid] }, now))
      .toThrow(ValidationError)
    try {
      parseViralSignalBatch({ schema_version: 1, records: [invalid] }, now)
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError)
      expect((error as ValidationError).issues.length).toBeGreaterThanOrEqual(3)
    }
  })

  it('rejects invalid timestamps as a contract error instead of throwing a date conversion error', () => {
    const record = makeSignal({ source: 'social-source' })
    expect(() => parseViralSignalBatch({
      schema_version: 1,
      records: [{ ...record, observed_at: 'not-a-date' }],
    })).toThrow(ValidationError)
  })

  it('keeps a batch within one source run and validates publication metadata strictly', () => {
    const now = new Date('2026-07-16T12:00:00.000Z')
    const first = makeSignal({ source: 'social-source', now })
    const second = makeSignal({ source: 'search-source', now })
    first.candidate.release_date = '2026-02-31'
    first.candidate.search_terms = ['duplicate', 'duplicate']
    first.evidence_hash = 'not-a-sha256'

    expect(() => parseViralSignalBatch({ schema_version: 1, records: [first, second] }, now))
      .toThrow(ValidationError)
    try {
      parseViralSignalBatch({ schema_version: 1, records: [first, second] }, now)
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError)
      const issues = (error as ValidationError).issues.join(' | ')
      expect(issues).toContain('real calendar date')
      expect(issues).toContain('must not contain duplicates')
      expect(issues).toContain('lowercase sha256')
      expect(issues).toContain('same source')
    }
  })

  it('keeps search terms within the FindItViral 500-character storage contract', () => {
    const now = new Date('2026-07-16T12:00:00.000Z')
    const record = makeSignal({ source: 'social-source', now })
    record.candidate.search_terms = Array.from({ length: 9 }, (_, index) => `term-${index}`)

    try {
      parseViralSignalBatch({ schema_version: 1, records: [record] }, now)
      throw new Error('Expected search-term validation to fail')
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError)
      expect((error as ValidationError).issues.join(' | ')).toContain('at most 8 items')
    }
  })
})
