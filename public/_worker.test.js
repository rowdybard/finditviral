import { describe, expect, it, vi } from 'vitest'
import { handleEarlyAccess, handleProductClick } from './_worker.js'

const PRODUCT_ID = '22222222-2222-4222-8222-222222222222'
const VISITOR_ID = '11111111-1111-4111-8111-111111111111'

function env(overrides = {}) {
  return {
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_SECRET_KEY: 'sb_secret_test',
    TURNSTILE_SECRET_KEY: 'turnstile-secret',
    EARLY_ACCESS_RATE_LIMIT: {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue(undefined),
    },
    ...overrides,
  }
}

function request(body) {
  return new Request('https://finditviral.com/api/early-access', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'CF-Connecting-IP': '203.0.113.10',
    },
    body: JSON.stringify(body),
  })
}

function productClickRequest(body, { cookie, origin = 'https://finditviral.com' } = {}) {
  return new Request('https://finditviral.com/api/product-click', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'CF-Connecting-IP': '203.0.113.10',
      Origin: origin,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  })
}

describe('handleEarlyAccess', () => {
  it('requires Turnstile verification before persistence', async () => {
    const fetchImpl = vi.fn()
    const response = await handleEarlyAccess(request({
      email: 'shopper@example.com',
      reason: 'I want to find limited local products.',
    }), env(), fetchImpl)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'verification_required' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('uses a modern secret key only in the Supabase apikey header', async () => {
    const fetchImpl = vi.fn(async (url, init) => {
      if (String(url).includes('siteverify')) {
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      expect(init.headers.apikey).toBe('sb_secret_test')
      expect(init.headers.Authorization).toBeUndefined()
      expect(JSON.parse(init.body)).toEqual({
        p_email: 'shopper@example.com',
        p_reason: 'I want to find limited local products.',
      })
      return new Response(null, { status: 204 })
    })

    const response = await handleEarlyAccess(request({
      email: ' Shopper@Example.com ',
      reason: ' I want to find limited local products. ',
      turnstileToken: 'valid-token',
    }), env(), fetchImpl)

    expect(response.status).toBe(204)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('keeps the Bearer header for a legacy service-role JWT', async () => {
    const legacyKey = 'eyJlegacy.header.signature'
    const fetchImpl = vi.fn(async (url, init) => {
      if (String(url).includes('siteverify')) {
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      expect(init.headers.apikey).toBe(legacyKey)
      expect(init.headers.Authorization).toBe(`Bearer ${legacyKey}`)
      return new Response(null, { status: 204 })
    })

    const response = await handleEarlyAccess(request({
      email: 'shopper@example.com',
      reason: 'I want to find limited local products.',
      turnstileToken: 'valid-token',
    }), env({ SUPABASE_SECRET_KEY: legacyKey }), fetchImpl)

    expect(response.status).toBe(204)
  })

  it('fails closed when Turnstile rejects the token', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: false }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    const response = await handleEarlyAccess(request({
      email: 'shopper@example.com',
      reason: 'I want to find limited local products.',
      turnstileToken: 'bad-token',
    }), env(), fetchImpl)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'verification_failed' })
  })
})

describe('handleProductClick', () => {
  it('rejects malformed product IDs before calling Supabase', async () => {
    const fetchImpl = vi.fn()
    const response = await handleProductClick(
      productClickRequest({ productId: 'not-a-product' }),
      env(),
      fetchImpl,
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'invalid_request' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('requires a same-origin browser request', async () => {
    const fetchImpl = vi.fn()
    const response = await handleProductClick(
      productClickRequest({ productId: PRODUCT_ID }, { origin: 'https://example.com' }),
      env(),
      fetchImpl,
    )

    expect(response.status).toBe(403)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('creates an opaque first-party cookie and persists only a product-specific digest', async () => {
    const fetchImpl = vi.fn(async (_url, init) => {
      expect(init.headers.apikey).toBe('sb_secret_test')
      expect(init.headers.Authorization).toBeUndefined()
      const payload = JSON.parse(init.body)
      expect(payload).toEqual({
        p_product_id: PRODUCT_ID,
        p_click_key: expect.stringMatching(/^[0-9a-f]{64}$/),
      })
      expect(init.body).not.toContain('203.0.113.10')
      return new Response('true', { status: 200 })
    })

    const response = await handleProductClick(
      productClickRequest({ productId: PRODUCT_ID }),
      env(),
      fetchImpl,
    )

    expect(response.status).toBe(204)
    expect(response.headers.get('Set-Cookie')).toMatch(
      /^__Host-fiv_heat=[0-9a-f-]+; Path=\/; Max-Age=2592000; Secure; HttpOnly; SameSite=Lax$/,
    )
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('caps chunked bodies even when Content-Length is absent', async () => {
    const fetchImpl = vi.fn()
    const oversizedRequest = productClickRequest({
      productId: PRODUCT_ID,
      padding: 'x'.repeat(300),
    })
    expect(oversizedRequest.headers.get('Content-Length')).toBeNull()

    const response = await handleProductClick(oversizedRequest, env(), fetchImpl)

    expect(response.status).toBe(400)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('reuses a valid cookie without exposing it to Postgres', async () => {
    const fetchImpl = vi.fn(async (_url, init) => {
      const payload = JSON.parse(init.body)
      expect(payload.p_click_key).toMatch(/^[0-9a-f]{64}$/)
      expect(payload.p_click_key).not.toContain(VISITOR_ID)
      return new Response('false', { status: 200 })
    })

    const response = await handleProductClick(
      productClickRequest(
        { productId: PRODUCT_ID },
        { cookie: `__Host-fiv_heat=${VISITOR_ID}` },
      ),
      env(),
      fetchImpl,
    )

    expect(response.status).toBe(204)
    expect(response.headers.get('Set-Cookie')).toBeNull()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('fails closed for counting when the coarse abuse limit is unavailable', async () => {
    const fetchImpl = vi.fn()
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const response = await handleProductClick(
      productClickRequest({ productId: PRODUCT_ID }),
      env({
        EARLY_ACCESS_RATE_LIMIT: {
          get: vi.fn().mockRejectedValue(new Error('KV unavailable')),
          put: vi.fn(),
        },
      }),
      fetchImpl,
    )

    expect(response.status).toBe(204)
    expect(fetchImpl).not.toHaveBeenCalled()
    consoleSpy.mockRestore()
  })

  it('does not call Supabase after the coarse abuse limit is reached', async () => {
    const fetchImpl = vi.fn()
    const response = await handleProductClick(
      productClickRequest({ productId: PRODUCT_ID }),
      env({
        EARLY_ACCESS_RATE_LIMIT: {
          get: vi.fn().mockResolvedValue('60'),
          put: vi.fn(),
        },
      }),
      fetchImpl,
    )

    expect(response.status).toBe(204)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
