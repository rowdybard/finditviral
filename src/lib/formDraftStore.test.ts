import { describe, expect, it } from 'vitest'
import {
  FORM_DRAFT_TTL_MS,
  formDraftKey,
  listUserFormDrafts,
  readFormDraft,
  removeFormDraft,
  createDraftSubmissionId,
  writeFormDraft,
  type DraftStorage,
} from './formDraftStore'

class MemoryStorage implements DraftStorage {
  private values = new Map<string, string>()
  get length() { return this.values.size }
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
  removeItem(key: string) { this.values.delete(key) }
  key(index: number) { return [...this.values.keys()][index] ?? null }
}

const parsePayload = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const name = (value as Record<string, unknown>).name
  return typeof name === 'string' ? { name } : null
}

describe('formDraftStore', () => {
  it('isolates drafts by user, form, and entity', () => {
    const storage = new MemoryStorage()
    const one = { userId: 'user:one', formType: 'bounty-claim' as const, entityId: 'bounty/1' }
    const two = { userId: 'user:one', formType: 'bounty-claim' as const, entityId: 'bounty/2' }
    const otherUser = { userId: 'user:two', formType: 'bounty-claim' as const, entityId: 'bounty/1' }
    writeFormDraft(one, { name: 'one' }, { storage, parsePayload, now: 10 })
    writeFormDraft(two, { name: 'two' }, { storage, parsePayload, now: 20 })
    writeFormDraft(otherUser, { name: 'other' }, { storage, parsePayload, now: 30 })

    expect(formDraftKey(one)).not.toBe(formDraftKey(two))
    expect(readFormDraft(one, parsePayload, { storage, now: 40 })?.payload.name).toBe('one')
    expect(readFormDraft(two, parsePayload, { storage, now: 40 })?.payload.name).toBe('two')
    expect(listUserFormDrafts('user:one', { storage, now: 40 })).toHaveLength(2)
  })

  it('expires and removes drafts after 90 days', () => {
    const storage = new MemoryStorage()
    const scope = { userId: 'user', formType: 'lead' as const }
    writeFormDraft(scope, { name: 'lead' }, { storage, parsePayload, now: 1_000 })
    expect(readFormDraft(scope, parsePayload, { storage, now: 1_000 + FORM_DRAFT_TTL_MS - 1 })).not.toBeNull()
    expect(readFormDraft(scope, parsePayload, { storage, now: 1_000 + FORM_DRAFT_TTL_MS })).toBeNull()
    expect(storage.getItem(formDraftKey(scope))).toBeNull()
  })

  it('rejects corrupted and schema-incompatible payloads', () => {
    const storage = new MemoryStorage()
    const scope = { userId: 'user', formType: 'sighting' as const }
    storage.setItem(formDraftKey(scope), '{bad json')
    expect(readFormDraft(scope, parsePayload, { storage })).toBeNull()

    writeFormDraft(scope, { name: 'valid' }, { storage, parsePayload, now: 100 })
    expect(readFormDraft(scope, () => null, { storage, now: 101 })).toBeNull()
    expect(storage.getItem(formDraftKey(scope))).toBeNull()
  })

  it('preserves creation time, refreshes expiry, metadata, and submission id', () => {
    const storage = new MemoryStorage()
    const scope = { userId: 'user', formType: 'sighting' as const }
    writeFormDraft(scope, { name: 'first' }, {
      storage,
      parsePayload,
      now: 10,
      metadata: { submissionId: 'stable-id', mediaPaths: ['user/photo.jpg'] },
    })
    const result = writeFormDraft(scope, { name: 'second' }, {
      storage,
      parsePayload,
      now: 20,
      metadata: { submissionId: 'stable-id', mediaPaths: ['user/photo.jpg'] },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.draft.createdAt).toBe(10)
    expect(result.draft.expiresAt).toBe(20 + FORM_DRAFT_TTL_MS)
    expect(result.draft.metadata.submissionId).toBe('stable-id')
    expect(result.draft.metadata.mediaPaths).toEqual(['user/photo.jpg'])
  })

  it('removes only the requested draft', () => {
    const storage = new MemoryStorage()
    const one = { userId: 'user', formType: 'lead' as const }
    const two = { userId: 'user', formType: 'bounty' as const }
    writeFormDraft(one, { name: 'one' }, { storage, parsePayload })
    writeFormDraft(two, { name: 'two' }, { storage, parsePayload })
    expect(removeFormDraft(one, storage)).toBe(true)
    expect(readFormDraft(one, parsePayload, { storage })).toBeNull()
    expect(readFormDraft(two, parsePayload, { storage })).not.toBeNull()
  })

  it('always creates a UUID submission key', () => {
    expect(createDraftSubmissionId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    )
  })
})
