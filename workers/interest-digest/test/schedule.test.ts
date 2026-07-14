import { describe, expect, it } from 'vitest'
import { getDetroitSchedule } from '../src/schedule'

describe('getDetroitSchedule', () => {
  it('opens the digest window at 8 AM during daylight time', () => {
    expect(getDetroitSchedule(Date.parse('2026-07-13T11:59:00Z'))).toEqual({
      localDate: '2026-07-13',
      localHour: 7,
      shouldAttempt: false,
    })
    expect(getDetroitSchedule(Date.parse('2026-07-13T12:00:00Z'))).toEqual({
      localDate: '2026-07-13',
      localHour: 8,
      shouldAttempt: true,
    })
  })

  it('opens the digest window at 8 AM during standard time', () => {
    expect(getDetroitSchedule(Date.parse('2026-01-13T12:59:00Z'))).toEqual({
      localDate: '2026-01-13',
      localHour: 7,
      shouldAttempt: false,
    })
    expect(getDetroitSchedule(Date.parse('2026-01-13T13:00:00Z'))).toEqual({
      localDate: '2026-01-13',
      localHour: 8,
      shouldAttempt: true,
    })
  })

  it('uses the Detroit calendar date across UTC midnight', () => {
    expect(getDetroitSchedule(Date.parse('2026-07-14T02:00:00Z'))).toMatchObject({
      localDate: '2026-07-13',
      localHour: 22,
    })
  })

  it('spring forward: 8 AM EDT on 2026-03-08 is 12:00 UTC (DST started at 2 AM)', () => {
    expect(getDetroitSchedule(Date.parse('2026-03-08T11:59:00Z'))).toEqual({
      localDate: '2026-03-08',
      localHour: 7,
      shouldAttempt: false,
    })
    expect(getDetroitSchedule(Date.parse('2026-03-08T12:00:00Z'))).toEqual({
      localDate: '2026-03-08',
      localHour: 8,
      shouldAttempt: true,
    })
  })

  it('fall back: 8 AM EST on 2026-11-01 is 13:00 UTC', () => {
    expect(getDetroitSchedule(Date.parse('2026-11-01T12:59:00Z'))).toEqual({
      localDate: '2026-11-01',
      localHour: 7,
      shouldAttempt: false,
    })
    expect(getDetroitSchedule(Date.parse('2026-11-01T13:00:00Z'))).toEqual({
      localDate: '2026-11-01',
      localHour: 8,
      shouldAttempt: true,
    })
  })

  it('midnight UTC boundary: 2026-07-14T00:00Z is still 2026-07-13 in Detroit', () => {
    expect(getDetroitSchedule(Date.parse('2026-07-14T00:00:00Z'))).toMatchObject({
      localDate: '2026-07-13',
      localHour: 20,
    })
  })
})

