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
})

