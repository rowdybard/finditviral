import { describe, expect, it } from 'vitest'
import { validateUsername, normalizeUsername, USERNAME_PATTERN, USERNAME_MIN, USERNAME_MAX } from './username'

describe('USERNAME_PATTERN', () => {
  it('matches valid usernames', () => {
    expect(USERNAME_PATTERN.test('abc')).toBe(true)
    expect(USERNAME_PATTERN.test('user_123')).toBe(true)
    expect(USERNAME_PATTERN.test('a_b_c')).toBe(true)
  })

  it('rejects invalid usernames', () => {
    expect(USERNAME_PATTERN.test('ab')).toBe(false)
    expect(USERNAME_PATTERN.test('ABC')).toBe(false)
    expect(USERNAME_PATTERN.test('user-123')).toBe(false)
    expect(USERNAME_PATTERN.test('user 123')).toBe(false)
  })
})

describe('validateUsername', () => {
  it('returns null for valid usernames', () => {
    expect(validateUsername('goodname')).toBeNull()
    expect(validateUsername('user_123')).toBeNull()
  })

  it('returns error for too short', () => {
    expect(validateUsername('ab')).toBe('Username must be at least 3 characters')
  })

  it('returns error for too long', () => {
    expect(validateUsername('a'.repeat(21))).toBe('Username must be 20 characters or fewer')
  })

  it('returns error for invalid characters', () => {
    expect(validateUsername('User-Name')).toBe('Only lowercase letters, numbers, and underscore')
  })

  it('returns error for banned words', () => {
    expect(validateUsername('admin')).toBe('This username is not allowed')
    expect(validateUsername('superadmin')).toBe('This username is not allowed')
    expect(validateUsername('fuckyeah')).toBe('This username is not allowed')
  })

  it('trims and lowercases before validating', () => {
    expect(validateUsername('  GoodName  ')).toBeNull()
  })
})

describe('normalizeUsername', () => {
  it('lowercases and trims', () => {
    expect(normalizeUsername('  Hello  ')).toBe('hello')
  })
})

describe('constants', () => {
  it('has correct min and max', () => {
    expect(USERNAME_MIN).toBe(3)
    expect(USERNAME_MAX).toBe(20)
  })
})
