import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderFlaggedModerationEmail } from '../src/email'
import { parseOpenAiModeration, type ModerationQueueItem } from '../src/domain'
import { processScheduledModeration } from '../src/index'

const CONTRIBUTION_ID = '11111111-1111-4111-8111-111111111111'

function makeItem(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    contribution_type: 'bounty',
    contribution_id: CONTRIBUTION_ID,
    text_content: 'Please find the limited edition snack.',
    product_name: 'Example Snack',
    username: 'shopper',
    result_flagged: null,
    result_categories: [],
    result_model: null,
    needs_notification: false,
    ...overrides,
  }
}

function makeEnv(overrides: Record<string, unknown> = {}) {
  return {
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SECRET_KEY: 'sb_secret_test_key_long_enough',
    OPENAI_API_KEY: 'sk-test-key-long-enough-for-validation',
    MODERATION_TO_EMAIL: 'owner@finditviral.com',
    MODERATION_FROM_EMAIL: 'digest@finditviral.com',
    MODERATION_FROM_NAME: 'FindItViral Moderation',
    EMAIL: { send: vi.fn().mockResolvedValue({ messageId: 'message-123' }) },
    ...overrides,
  } as unknown as Env
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('OpenAI moderation contract', () => {
  it('keeps only flagged categories from the OpenAI response', () => {
    expect(parseOpenAiModeration({
      model: 'omni-moderation-latest',
      results: [{
        flagged: true,
        categories: { violence: true, harassment: false, 'self-harm': true },
      }],
    })).toEqual({
      flagged: true,
      categories: ['self-harm', 'violence'],
      model: 'omni-moderation-latest',
    })
  })

  it('escapes contribution text before including it in owner HTML email', () => {
    const item: ModerationQueueItem = {
      contributionType: 'lead',
      contributionId: CONTRIBUTION_ID,
      textContent: '<img src=x onerror=alert(1)>',
      productName: '<Example>',
      username: 'member',
      resultFlagged: true,
      resultCategories: ['harassment'],
      resultModel: 'omni-moderation-latest',
      needsNotification: true,
    }
    const email = renderFlaggedModerationEmail(item)
    expect(email.html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(email.html).not.toContain('<img src=x onerror=alert(1)>')
  })
})

describe('scheduled content moderation', () => {
  it('records a clean bounty result and leaves owner email untouched', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response([makeItem()]))
      .mockResolvedValueOnce(response({
        model: 'omni-moderation-latest',
        results: [{ flagged: false, categories: {} }],
      }))
      .mockResolvedValueOnce(response([{
        recorded: true,
        result_flagged: false,
        auto_approved: true,
        notification_pending: false,
      }]))
    vi.stubGlobal('fetch', fetchMock)
    const env = makeEnv()

    await processScheduledModeration(env)

    expect(env.EMAIL.send).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(3)
    const saveBody = JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body)) as Record<string, unknown>
    expect(saveBody).toMatchObject({
      p_contribution_type: 'bounty',
      p_contribution_id: CONTRIBUTION_ID,
      p_flagged: false,
      p_model: 'omni-moderation-latest',
    })
  })

  it('publishes a clean lead confirmation through the atomic result RPC', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response([makeItem({ contribution_type: 'sighting' })]))
      .mockResolvedValueOnce(response({
        model: 'omni-moderation-latest',
        results: [{ flagged: false, categories: {} }],
      }))
      .mockResolvedValueOnce(response([{
        recorded: true,
        result_flagged: false,
        auto_approved: true,
        notification_pending: false,
      }]))
    vi.stubGlobal('fetch', fetchMock)
    const env = makeEnv()

    await processScheduledModeration(env)

    const saveBody = JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body)) as Record<string, unknown>
    expect(saveBody.p_contribution_type).toBe('sighting')
    expect(saveBody.p_flagged).toBe(false)
    expect(env.EMAIL.send).not.toHaveBeenCalled()
  })

  it('skips OpenAI for empty text but persists a clean skipped-empty result', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response([makeItem({ text_content: '' })]))
      .mockResolvedValueOnce(response([{
        recorded: true,
        result_flagged: false,
        auto_approved: true,
        notification_pending: false,
      }]))
    vi.stubGlobal('fetch', fetchMock)

    await processScheduledModeration(makeEnv())

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('/set_content_moderation_result')
    const saveBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as Record<string, unknown>
    expect(saveBody.p_model).toBe('skipped-empty')
  })

  it('emails an owner once for a flagged item, then marks the alert accepted', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response([makeItem()]))
      .mockResolvedValueOnce(response({
        model: 'omni-moderation-latest',
        results: [{ flagged: true, categories: { violence: true } }],
      }))
      .mockResolvedValueOnce(response([{
        recorded: true,
        result_flagged: true,
        auto_approved: false,
        notification_pending: true,
      }]))
      .mockResolvedValueOnce(response(true))
    vi.stubGlobal('fetch', fetchMock)
    const env = makeEnv()

    await processScheduledModeration(env)

    expect(env.EMAIL.send).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(String(fetchMock.mock.calls[3]?.[0])).toContain('/mark_content_moderation_notification_sent')
  })

  it('keeps an OpenAI failure retryable and never logs the submitted text', async () => {
    const privateText = 'private contribution text must not appear in logs'
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response([makeItem({ text_content: privateText })]))
      .mockResolvedValueOnce(response({ error: { message: 'upstream failed' } }, 500))
    vi.stubGlobal('fetch', fetchMock)
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(processScheduledModeration(makeEnv())).resolves.toBeUndefined()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    for (const call of consoleSpy.mock.calls) expect(String(call[0])).not.toContain(privateText)
  })
})
