export const FORM_DRAFT_VERSION = 1 as const
export const FORM_DRAFT_TTL_MS = 90 * 24 * 60 * 60 * 1000
export const FORM_DRAFT_PREFIX = `finditviral:draft:v${FORM_DRAFT_VERSION}`

export type FormDraftType = 'sighting' | 'bounty' | 'lead' | 'bounty-claim' | 'onboarding'

export type FormDraftScope = {
  userId: string
  formType: FormDraftType
  entityId?: string
}

export type FormDraftMetadata = {
  title?: string
  destination?: string
  submissionId?: string
  serverDraftId?: string
  mediaPaths?: string[]
}

export type FormDraftEnvelope<T> = {
  version: typeof FORM_DRAFT_VERSION
  userId: string
  formType: FormDraftType
  entityId: string
  createdAt: number
  updatedAt: number
  expiresAt: number
  payload: T
  metadata: FormDraftMetadata
}

export type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>
export type DraftParser<T> = (value: unknown) => T | null

export type DraftWriteResult<T> =
  | { ok: true; draft: FormDraftEnvelope<T> }
  | { ok: false; error: Error }

const formTypes = new Set<FormDraftType>(['sighting', 'bounty', 'lead', 'bounty-claim', 'onboarding'])

function normalizedEntityId(entityId?: string): string {
  return entityId?.trim() || 'new'
}

function encodedPart(value: string): string {
  return encodeURIComponent(value)
}

export function formDraftKey(scope: FormDraftScope): string {
  return [
    FORM_DRAFT_PREFIX,
    encodedPart(scope.userId),
    scope.formType,
    encodedPart(normalizedEntityId(scope.entityId)),
  ].join(':')
}

function userDraftPrefix(userId: string): string {
  return `${FORM_DRAFT_PREFIX}:${encodedPart(userId)}:`
}

function defaultStorage(): DraftStorage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function parseMetadata(value: unknown): FormDraftMetadata | null {
  if (!isRecord(value)) return null
  const metadata: FormDraftMetadata = {}
  if (value.title !== undefined) {
    if (typeof value.title !== 'string') return null
    metadata.title = value.title
  }
  if (value.destination !== undefined) {
    if (typeof value.destination !== 'string') return null
    metadata.destination = value.destination
  }
  if (value.submissionId !== undefined) {
    if (typeof value.submissionId !== 'string') return null
    metadata.submissionId = value.submissionId
  }
  if (value.serverDraftId !== undefined) {
    if (typeof value.serverDraftId !== 'string') return null
    metadata.serverDraftId = value.serverDraftId
  }
  if (value.mediaPaths !== undefined) {
    if (!Array.isArray(value.mediaPaths) || value.mediaPaths.some((path) => typeof path !== 'string')) return null
    metadata.mediaPaths = value.mediaPaths as string[]
  }
  return metadata
}

function parseEnvelope(value: unknown): FormDraftEnvelope<unknown> | null {
  if (!isRecord(value)) return null
  if (value.version !== FORM_DRAFT_VERSION) return null
  if (typeof value.userId !== 'string' || value.userId.length === 0) return null
  if (typeof value.formType !== 'string' || !formTypes.has(value.formType as FormDraftType)) return null
  if (typeof value.entityId !== 'string' || value.entityId.length === 0) return null
  if (typeof value.createdAt !== 'number' || !Number.isFinite(value.createdAt)) return null
  if (typeof value.updatedAt !== 'number' || !Number.isFinite(value.updatedAt)) return null
  if (typeof value.expiresAt !== 'number' || !Number.isFinite(value.expiresAt)) return null
  const metadata = parseMetadata(value.metadata)
  if (!metadata) return null
  return {
    version: FORM_DRAFT_VERSION,
    userId: value.userId,
    formType: value.formType as FormDraftType,
    entityId: value.entityId,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    expiresAt: value.expiresAt,
    payload: value.payload,
    metadata,
  }
}

function readRawEnvelope(key: string, storage: DraftStorage): FormDraftEnvelope<unknown> | null {
  const raw = storage.getItem(key)
  if (!raw) return null
  try {
    return parseEnvelope(JSON.parse(raw))
  } catch {
    return null
  }
}

function matchesScope(draft: FormDraftEnvelope<unknown>, scope: FormDraftScope): boolean {
  return draft.userId === scope.userId
    && draft.formType === scope.formType
    && draft.entityId === normalizedEntityId(scope.entityId)
}

export function readFormDraft<T>(
  scope: FormDraftScope,
  parsePayload: DraftParser<T>,
  options: { storage?: DraftStorage | null; now?: number; removeInvalid?: boolean } = {},
): FormDraftEnvelope<T> | null {
  const storage = options.storage === undefined ? defaultStorage() : options.storage
  if (!storage || !scope.userId) return null
  const key = formDraftKey(scope)
  try {
    const draft = readRawEnvelope(key, storage)
    const now = options.now ?? Date.now()
    if (!draft || !matchesScope(draft, scope) || draft.expiresAt <= now) {
      if (options.removeInvalid !== false && storage.getItem(key) !== null) storage.removeItem(key)
      return null
    }
    const payload = parsePayload(draft.payload)
    if (payload === null) {
      if (options.removeInvalid !== false) storage.removeItem(key)
      return null
    }
    return { ...draft, payload }
  } catch {
    return null
  }
}

export function writeFormDraft<T>(
  scope: FormDraftScope,
  payload: T,
  options: {
    storage?: DraftStorage | null
    now?: number
    metadata?: FormDraftMetadata
    parsePayload: DraftParser<T>
  },
): DraftWriteResult<T> {
  const storage = options.storage === undefined ? defaultStorage() : options.storage
  if (!storage) return { ok: false, error: new Error('Draft storage is unavailable.') }
  const parsedPayload = options.parsePayload(payload)
  if (parsedPayload === null) return { ok: false, error: new Error('Draft data is invalid.') }
  const key = formDraftKey(scope)
  try {
    const now = options.now ?? Date.now()
    const existing = readRawEnvelope(key, storage)
    const draft: FormDraftEnvelope<T> = {
      version: FORM_DRAFT_VERSION,
      userId: scope.userId,
      formType: scope.formType,
      entityId: normalizedEntityId(scope.entityId),
      createdAt: existing && matchesScope(existing, scope) ? existing.createdAt : now,
      updatedAt: now,
      expiresAt: now + FORM_DRAFT_TTL_MS,
      payload: parsedPayload,
      metadata: options.metadata ?? {},
    }
    storage.setItem(key, JSON.stringify(draft))
    return { ok: true, draft }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error : new Error('Draft could not be saved.') }
  }
}

export function removeFormDraft(
  scope: FormDraftScope,
  storage: DraftStorage | null | undefined = defaultStorage(),
): boolean {
  if (!storage) return false
  try {
    storage.removeItem(formDraftKey(scope))
    return true
  } catch {
    return false
  }
}

export function listUserFormDrafts(
  userId: string,
  options: { storage?: DraftStorage | null; now?: number } = {},
): FormDraftEnvelope<unknown>[] {
  const storage = options.storage === undefined ? defaultStorage() : options.storage
  if (!storage || !userId) return []
  const prefix = userDraftPrefix(userId)
  const drafts: FormDraftEnvelope<unknown>[] = []
  const now = options.now ?? Date.now()
  try {
    const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index))
      .filter((key): key is string => Boolean(key?.startsWith(prefix)))
    for (const key of keys) {
      const draft = readRawEnvelope(key, storage)
      if (!draft || draft.userId !== userId || draft.expiresAt <= now) {
        storage.removeItem(key)
        continue
      }
      drafts.push(draft)
    }
  } catch {
    return []
  }
  return drafts.sort((a, b) => b.updatedAt - a.updatedAt)
}

export function createDraftSubmissionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  // Preserve the UUID contract required by submit_sightings_v2 even in older
  // WebViews that do not expose crypto.randomUUID().
  const bytes = new Uint8Array(16)
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes)
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256)
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
