export const MODERATION_MODEL = 'omni-moderation-latest'
export const MAX_QUEUE_ITEMS = 25
export const MAX_TEXT_CONTENT_LENGTH = 8_000

export type ContributionType = 'bounty' | 'lead' | 'sighting'

export type ModerationQueueItem = {
  contributionType: ContributionType
  contributionId: string
  textContent: string
  productName: string
  username: string | null
  resultFlagged: boolean | null
  resultCategories: string[]
  resultModel: string | null
  needsNotification: boolean
}

export type ModerationDecision = {
  flagged: boolean
  categories: string[]
  model: string
}

export type PersistedModerationResult = {
  recorded: boolean
  resultFlagged: boolean
  autoApproved: boolean
  notificationPending: boolean
}

export class ModerationContractError extends Error {
  readonly code = 'MODERATION_CONTRACT_INVALID'

  constructor(message: string) {
    super(message)
    this.name = 'ModerationContractError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireString(record: Record<string, unknown>, key: string, maxLength: number): string {
  const value = record[key]
  if (typeof value !== 'string' || value.length > maxLength) {
    throw new ModerationContractError(`${key} must be a string of at most ${maxLength} characters`)
  }
  return value
}

function requireUuid(record: Record<string, unknown>, key: string): string {
  const value = requireString(record, key, 36)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new ModerationContractError(`${key} must be a UUID`)
  }
  return value
}

function parseCategories(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 32 || value.some((entry) => typeof entry !== 'string' || entry.length > 120)) {
    throw new ModerationContractError('result_categories must contain at most 32 short strings')
  }
  return value as string[]
}

function parseQueueItem(value: unknown): ModerationQueueItem {
  if (!isRecord(value)) throw new ModerationContractError('queue item must be an object')
  const contributionType = requireString(value, 'contribution_type', 16)
  if (contributionType !== 'bounty' && contributionType !== 'lead' && contributionType !== 'sighting') {
    throw new ModerationContractError('queue contribution_type is unsupported')
  }
  const username = value.username
  if (username !== null && (typeof username !== 'string' || username.length > 64)) {
    throw new ModerationContractError('username must be null or a short string')
  }
  const resultFlagged = value.result_flagged
  if (resultFlagged !== null && typeof resultFlagged !== 'boolean') {
    throw new ModerationContractError('result_flagged must be null or boolean')
  }
  if (typeof value.needs_notification !== 'boolean') {
    throw new ModerationContractError('needs_notification must be boolean')
  }
  const resultModel = value.result_model
  if (resultModel !== null && (typeof resultModel !== 'string' || resultModel.length > 160)) {
    throw new ModerationContractError('result_model must be null or a short string')
  }
  return {
    contributionType,
    contributionId: requireUuid(value, 'contribution_id'),
    textContent: requireString(value, 'text_content', MAX_TEXT_CONTENT_LENGTH),
    productName: requireString(value, 'product_name', 240),
    username,
    resultFlagged,
    resultCategories: parseCategories(value.result_categories),
    resultModel,
    needsNotification: value.needs_notification,
  }
}

export function parseModerationQueue(value: unknown): ModerationQueueItem[] {
  if (!Array.isArray(value) || value.length > MAX_QUEUE_ITEMS) {
    throw new ModerationContractError(`queue response must contain at most ${MAX_QUEUE_ITEMS} items`)
  }
  const items = value.map(parseQueueItem)
  const unique = new Set(items.map((item) => `${item.contributionType}:${item.contributionId}`))
  if (unique.size !== items.length) throw new ModerationContractError('queue response contains duplicate contributions')
  return items
}

export function parsePersistedModerationResult(value: unknown): PersistedModerationResult {
  const row = Array.isArray(value) ? value[0] : value
  if (!isRecord(row)
    || typeof row.recorded !== 'boolean'
    || typeof row.result_flagged !== 'boolean'
    || typeof row.auto_approved !== 'boolean'
    || typeof row.notification_pending !== 'boolean') {
    throw new ModerationContractError('persisted moderation response is invalid')
  }
  return {
    recorded: row.recorded,
    resultFlagged: row.result_flagged,
    autoApproved: row.auto_approved,
    notificationPending: row.notification_pending,
  }
}

export function parseOpenAiModeration(value: unknown): ModerationDecision {
  if (!isRecord(value) || !Array.isArray(value.results) || value.results.length !== 1 || !isRecord(value.results[0])) {
    throw new ModerationContractError('OpenAI moderation response is invalid')
  }
  const result = value.results[0]
  if (typeof result.flagged !== 'boolean' || !isRecord(result.categories)) {
    throw new ModerationContractError('OpenAI moderation result is invalid')
  }
  const categories = Object.entries(result.categories)
    .filter(([, flagged]) => flagged === true)
    .map(([category]) => category)
    .filter((category) => category.length <= 120)
    .sort()
  const model = typeof value.model === 'string' && value.model.length > 0 && value.model.length <= 160
    ? value.model
    : MODERATION_MODEL
  return { flagged: result.flagged, categories, model }
}
