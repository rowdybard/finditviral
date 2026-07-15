import { describe, expect, it, vi } from 'vitest'
import { getPageMetadata, handleEarlyAccess, handleProductClick } from './_worker.js'
import worker from './_worker.js'

const PRODUCT_ID = '22222222-2222-4222-8222-222222222222'
const VISITOR_ID = '11111111-1111-4111-8111-111111111111'

describe('Pages health-check origin bypass', () => {
  function assetEnv() {
    return {
      ASSETS: {
        fetch: vi.fn().mockResolvedValue(new Response('healthy', {
          status: 200,
          headers: { 'Content-Type': 'text/plain' },
        })),
      },
    }
  }

  it('keeps ordinary Pages requests redirected to the canonical hostname', async () => {
    const env = assetEnv()
    const response = await worker.fetch(new Request('https://finditviral.pages.dev/health.txt'), env)

    expect(response.status).toBe(301)
    expect(response.headers.get('Location')).toBe('https://finditviral.com/health.txt')
    expect(env.ASSETS.fetch).not.toHaveBeenCalled()
  })

  it('serves the Pages origin only for the exact health-check header', async () => {
    const env = assetEnv()
    const request = new Request('https://finditviral.pages.dev/health.txt', {
      headers: { 'X-FindItViral-Health-Check': 'pages-origin' },
    })
    const response = await worker.fetch(request, env)

    expect(response.status).toBe(200)
    await expect(response.text()).resolves.toBe('healthy')
    expect(env.ASSETS.fetch).toHaveBeenCalledWith(request)
  })

  it('never lets the health header bypass redirects for POST requests', async () => {
    const env = assetEnv()
    const response = await worker.fetch(new Request('https://finditviral.pages.dev/api/product-click', {
      method: 'POST',
      headers: { 'X-FindItViral-Health-Check': 'pages-origin' },
    }), env)

    expect(response.status).toBe(301)
    expect(response.headers.get('Location')).toBe('https://finditviral.com/api/product-click')
    expect(env.ASSETS.fetch).not.toHaveBeenCalled()
  })

  it('marks health-check HTML as noindex and no-store', async () => {
    vi.stubGlobal('HTMLRewriter', class {
      on() { return this }
      transform(response) { return response }
    })
    const env = {
      ASSETS: {
        fetch: vi.fn().mockResolvedValue(new Response('<html></html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        })),
      },
    }

    try {
      const response = await worker.fetch(new Request('https://finditviral.pages.dev/', {
        headers: { 'X-FindItViral-Health-Check': 'pages-origin' },
      }), env)

      expect(response.headers.get('X-Robots-Tag')).toBe('noindex, nofollow, noarchive')
      expect(response.headers.get('Cache-Control')).toBe('no-store')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('never lets the health header bypass the www redirect', async () => {
    const env = assetEnv()
    const response = await worker.fetch(new Request('https://www.finditviral.com/privacy', {
      headers: { 'X-FindItViral-Health-Check': 'pages-origin' },
    }), env)

    expect(response.status).toBe(301)
    expect(response.headers.get('Location')).toBe('https://finditviral.com/privacy')
    expect(env.ASSETS.fetch).not.toHaveBeenCalled()
  })
})

describe('public catalog metadata', () => {
  it('keeps product and store routes indexable while admin routes stay private', async () => {
    expect(await getPageMetadata('/products/test-product')).toMatchObject({
      canonicalUrl: 'https://finditviral.com/products/test-product',
      robots: 'index, follow',
    })
    expect(await getPageMetadata('/stores')).toMatchObject({
      canonicalUrl: 'https://finditviral.com/stores',
      robots: 'index, follow',
    })
    expect(await getPageMetadata('/stores/test-store/')).toMatchObject({
      canonicalUrl: 'https://finditviral.com/stores/test-store',
      robots: 'index, follow',
    })
    expect(await getPageMetadata('/admin')).toMatchObject({ robots: 'noindex, nofollow' })
  })

  it('makes lead detail routes indexable in worker metadata', async () => {
    expect(await getPageMetadata('/leads/squishmallow-restock')).toMatchObject({
      canonicalUrl: 'https://finditviral.com/leads/squishmallow-restock',
      robots: 'index, follow',
    })
  })

  it('injects product name into metadata when Supabase returns data', async () => {
    const fetchImpl = vi.fn(async (url, init) => {
      if (String(url).includes('get_public_product')) {
        return new Response(JSON.stringify({
          name: 'Squishmallow Phoenix',
          trend_name: 'Squishmallows',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response(null, { status: 404 })
    })

    const metadata = await getPageMetadata(
      '/products/squishmallow-phoenix',
      { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_test' },
      fetchImpl,
    )

    expect(metadata.title).toBe('Squishmallow Phoenix - FindItViral')
    expect(metadata.description).toContain('Squishmallow Phoenix')
    expect(metadata.robots).toBe('index, follow')
  })

  it('falls back to generic metadata when Supabase fails', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 500 }))

    const metadata = await getPageMetadata(
      '/products/unknown-product',
      { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_test' },
      fetchImpl,
    )

    expect(metadata.title).toBe('Product Availability in Greater Lansing - FindItViral')
    expect(metadata.robots).toBe('index, follow')
  })

  it('injects store name into metadata when Supabase returns data', async () => {
    const fetchImpl = vi.fn(async (url) => {
      if (String(url).includes('get_public_store')) {
        return new Response(JSON.stringify({
          store_name: 'Lansing Mall',
          retailer_name: 'Mall',
          city: 'Lansing',
          state: 'MI',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response(null, { status: 404 })
    })

    const metadata = await getPageMetadata(
      '/stores/lansing-mall',
      { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_test' },
      fetchImpl,
    )

    expect(metadata.title).toBe('Lansing Mall - FindItViral')
    expect(metadata.description).toContain('Lansing Mall')
    expect(metadata.description).toContain('Lansing, MI')
  })

  it('injects Lead details into metadata when Supabase returns data', async () => {
    const fetchImpl = vi.fn(async (url) => {
      if (String(url).includes('get_lead_detail')) {
        return new Response(JSON.stringify([{
          headline: 'Phoenix Squishmallow restock expected Friday',
          product_name: 'Squishmallow Phoenix',
        }]), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response(null, { status: 404 })
    })

    const metadata = await getPageMetadata(
      '/leads/phoenix-restock',
      { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_test' },
      fetchImpl,
    )

    expect(metadata.title).toBe('Phoenix Squishmallow restock expected Friday - FindItViral')
    expect(metadata.description).toContain('Squishmallow Phoenix')
    expect(metadata.robots).toBe('index, follow')
  })

  it('falls back to generic Lead metadata when Supabase fails', async () => {
    const metadata = await getPageMetadata(
      '/leads/unknown-lead',
      { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_test' },
      vi.fn().mockResolvedValue(new Response(null, { status: 500 })),
    )

    expect(metadata.title).toBe('Restock Lead - FindItViral')
    expect(metadata.robots).toBe('index, follow')
  })
})

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

function isAuthoritativeRateLimitRequest(url) {
  return String(url).includes('/rpc/consume_public_request_limit')
}

function allowedAuthoritativeRateLimitResponse() {
  return new Response('true', {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
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
      if (isAuthoritativeRateLimitRequest(url)) {
        expect(init.headers.apikey).toBe('sb_secret_test')
        expect(init.headers.Authorization).toBeUndefined()
        expect(JSON.parse(init.body)).toMatchObject({
          p_scope: 'early_access',
          p_key_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
        })
        expect(init.body).not.toContain('203.0.113.10')
        return allowedAuthoritativeRateLimitResponse()
      }
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
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('keeps the Bearer header for a legacy service-role JWT', async () => {
    const legacyKey = 'eyJlegacy.header.signature'
    const fetchImpl = vi.fn(async (url, init) => {
      if (isAuthoritativeRateLimitRequest(url)) {
        expect(init.headers.apikey).toBe(legacyKey)
        expect(init.headers.Authorization).toBe(`Bearer ${legacyKey}`)
        return allowedAuthoritativeRateLimitResponse()
      }
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
    const fetchImpl = vi.fn(async (url) => {
      if (isAuthoritativeRateLimitRequest(url)) return allowedAuthoritativeRateLimitResponse()
      return new Response(JSON.stringify({ success: false }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })

    const response = await handleEarlyAccess(request({
      email: 'shopper@example.com',
      reason: 'I want to find limited local products.',
      turnstileToken: 'bad-token',
    }), env(), fetchImpl)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'verification_failed' })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(String(fetchImpl.mock.calls[1]?.[0])).toContain('siteverify')
  })

  it('fails closed before Turnstile when the authoritative limiter is unavailable', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 503 }))

    const response = await handleEarlyAccess(request({
      email: 'shopper@example.com',
      reason: 'I want to find limited local products.',
      turnstileToken: 'valid-token',
    }), env(), fetchImpl)

    expect(response.status).toBe(503)
    expect(response.headers.get('Retry-After')).toBe('60')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain('consume_public_request_limit')
    consoleSpy.mockRestore()
  })

  it('allows only five concurrent requests to reach verification and persistence', async () => {
    let consumed = 0
    let turnstileCalls = 0
    let persistenceCalls = 0
    const fetchImpl = vi.fn(async (url) => {
      if (isAuthoritativeRateLimitRequest(url)) {
        consumed += 1
        return new Response(String(consumed <= 5), { status: 200 })
      }
      if (String(url).includes('siteverify')) {
        turnstileCalls += 1
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      persistenceCalls += 1
      return new Response(null, { status: 204 })
    })

    const responses = await Promise.all(Array.from({ length: 6 }, (_, index) => (
      handleEarlyAccess(request({
        email: `shopper${index}@example.com`,
        reason: 'I want to find limited local products.',
        turnstileToken: 'valid-token',
      }), env(), fetchImpl)
    )))

    expect(responses.map((response) => response.status).sort()).toEqual([204, 204, 204, 204, 204, 429])
    expect(turnstileCalls).toBe(5)
    expect(persistenceCalls).toBe(5)
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
    const fetchImpl = vi.fn(async (url, init) => {
      if (isAuthoritativeRateLimitRequest(url)) {
        expect(JSON.parse(init.body)).toMatchObject({
          p_scope: 'product_click',
          p_key_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
        })
        expect(init.body).not.toContain('203.0.113.10')
        return allowedAuthoritativeRateLimitResponse()
      }
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
    expect(fetchImpl).toHaveBeenCalledTimes(2)
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
    const fetchImpl = vi.fn(async (url, init) => {
      if (isAuthoritativeRateLimitRequest(url)) return allowedAuthoritativeRateLimitResponse()
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
    expect(fetchImpl).toHaveBeenCalledTimes(2)
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

  it('fails closed for counting when the authoritative limiter is unavailable', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 503 }))

    const response = await handleProductClick(
      productClickRequest({ productId: PRODUCT_ID }),
      env(),
      fetchImpl,
    )

    expect(response.status).toBe(204)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain('consume_public_request_limit')
    consoleSpy.mockRestore()
  })

  it('allows only sixty concurrent clicks to reach the persistence RPC', async () => {
    let consumed = 0
    let persistenceCalls = 0
    const fetchImpl = vi.fn(async (url) => {
      if (isAuthoritativeRateLimitRequest(url)) {
        consumed += 1
        return new Response(String(consumed <= 60), { status: 200 })
      }
      persistenceCalls += 1
      return new Response('true', { status: 200 })
    })

    const responses = await Promise.all(Array.from({ length: 61 }, () => (
      handleProductClick(
        productClickRequest({ productId: PRODUCT_ID }),
        env(),
        fetchImpl,
      )
    )))

    expect(responses.every((response) => response.status === 204)).toBe(true)
    expect(persistenceCalls).toBe(60)
  })
})

describe('enforceRateLimit — fail-open hardening', () => {
  it('blocks requests when the daily cap is reached even if primary KV fails', async () => {
    const fetchImpl = vi.fn(async (url, init) => {
      if (isAuthoritativeRateLimitRequest(url)) return allowedAuthoritativeRateLimitResponse()
      if (String(url).includes('siteverify')) {
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(null, { status: 204 })
    })

    const kvGet = vi.fn(async (key) => {
      if (key.startsWith('early-access-daily:')) return '20'
      throw new Error('KV unavailable')
    })
    const kvPut = vi.fn()

    const response = await handleEarlyAccess(request({
      email: 'shopper@example.com',
      reason: 'I want to find limited local products.',
      turnstileToken: 'valid-token',
    }), env({
      EARLY_ACCESS_RATE_LIMIT: { get: kvGet, put: kvPut },
    }), fetchImpl)

    expect(response.status).toBe(429)
    expect(fetchImpl).not.toHaveBeenCalled() // rate-limited before any fetch
  })

  it('allows requests when KV fails but daily cap has not been reached', async () => {
    const fetchImpl = vi.fn(async (url, init) => {
      if (isAuthoritativeRateLimitRequest(url)) return allowedAuthoritativeRateLimitResponse()
      if (String(url).includes('siteverify')) {
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(null, { status: 204 })
    })

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const kvGet = vi.fn(async (key) => {
      if (key.startsWith('early-access-daily:')) return '5'
      throw new Error('KV unavailable')
    })
    const kvPut = vi.fn()

    const response = await handleEarlyAccess(request({
      email: 'shopper@example.com',
      reason: 'I want to find limited local products.',
      turnstileToken: 'valid-token',
    }), env({
      EARLY_ACCESS_RATE_LIMIT: { get: kvGet, put: kvPut },
    }), fetchImpl)

    expect(response.status).toBe(204)
    expect(fetchImpl).toHaveBeenCalledTimes(3) // authoritative gate + Turnstile + persistence
    expect(consoleSpy).toHaveBeenCalled() // high-priority logging
    consoleSpy.mockRestore()
  })

  it('allows requests when both KV reads fail (total KV outage)', async () => {
    const fetchImpl = vi.fn(async (url, init) => {
      if (isAuthoritativeRateLimitRequest(url)) return allowedAuthoritativeRateLimitResponse()
      if (String(url).includes('siteverify')) {
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(null, { status: 204 })
    })

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const kvGet = vi.fn().mockRejectedValue(new Error('KV unavailable'))
    const kvPut = vi.fn()

    const response = await handleEarlyAccess(request({
      email: 'shopper@example.com',
      reason: 'I want to find limited local products.',
      turnstileToken: 'valid-token',
    }), env({
      EARLY_ACCESS_RATE_LIMIT: { get: kvGet, put: kvPut },
    }), fetchImpl)

    expect(response.status).toBe(204)
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(consoleSpy).toHaveBeenCalled()
    consoleSpy.mockRestore()
  })
})

describe('enforceRateLimit — boundary conditions', () => {
  function turnstileFetchMock() {
    return vi.fn(async (url) => {
      if (isAuthoritativeRateLimitRequest(url)) return allowedAuthoritativeRateLimitResponse()
      if (String(url).includes('siteverify')) {
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(null, { status: 204 })
    })
  }

  it('blocks when the primary rolling-window counter is exactly at the limit (5)', async () => {
    const fetchImpl = turnstileFetchMock()
    const kvGet = vi.fn(async (key) => {
      if (key.startsWith('early-access-daily:')) return '0'
      if (key.startsWith('early-access:')) return '5'
      return null
    })
    const kvPut = vi.fn()

    const response = await handleEarlyAccess(request({
      email: 'shopper@example.com',
      reason: 'I want to find limited local products.',
      turnstileToken: 'valid-token',
    }), env({
      EARLY_ACCESS_RATE_LIMIT: { get: kvGet, put: kvPut },
    }), fetchImpl)

    expect(response.status).toBe(429)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('allows when the primary rolling-window counter is one below the limit (4) and increments to 5', async () => {
    const fetchImpl = turnstileFetchMock()
    const kvGet = vi.fn(async (key) => {
      if (key.startsWith('early-access-daily:')) return '0'
      if (key.startsWith('early-access:')) return '4'
      return null
    })
    const kvPut = vi.fn()

    const response = await handleEarlyAccess(request({
      email: 'shopper@example.com',
      reason: 'I want to find limited local products.',
      turnstileToken: 'valid-token',
    }), env({
      EARLY_ACCESS_RATE_LIMIT: { get: kvGet, put: kvPut },
    }), fetchImpl)

    expect(response.status).toBe(204)
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    const rollingPut = kvPut.mock.calls.find(([key]) => key.startsWith('early-access:'))
    expect(rollingPut).toBeDefined()
    expect(rollingPut[1]).toBe('5')
  })

  it('blocks when the primary rolling-window counter exceeds the limit (6)', async () => {
    const fetchImpl = turnstileFetchMock()
    const kvGet = vi.fn(async (key) => {
      if (key.startsWith('early-access-daily:')) return '0'
      if (key.startsWith('early-access:')) return '6'
      return null
    })
    const kvPut = vi.fn()

    const response = await handleEarlyAccess(request({
      email: 'shopper@example.com',
      reason: 'I want to find limited local products.',
      turnstileToken: 'valid-token',
    }), env({
      EARLY_ACCESS_RATE_LIMIT: { get: kvGet, put: kvPut },
    }), fetchImpl)

    expect(response.status).toBe(429)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('blocks when the daily cap is exactly at the limit (20) even with primary KV available', async () => {
    const fetchImpl = turnstileFetchMock()
    const kvGet = vi.fn(async (key) => {
      if (key.startsWith('early-access-daily:')) return '20'
      if (key.startsWith('early-access:')) return '0'
      return null
    })
    const kvPut = vi.fn()

    const response = await handleEarlyAccess(request({
      email: 'shopper@example.com',
      reason: 'I want to find limited local products.',
      turnstileToken: 'valid-token',
    }), env({
      EARLY_ACCESS_RATE_LIMIT: { get: kvGet, put: kvPut },
    }), fetchImpl)

    expect(response.status).toBe(429)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('allows when the daily cap is one below the limit (19) and primary KV is at 0', async () => {
    const fetchImpl = turnstileFetchMock()
    const kvGet = vi.fn(async (key) => {
      if (key.startsWith('early-access-daily:')) return '19'
      if (key.startsWith('early-access:')) return '0'
      return null
    })
    const kvPut = vi.fn()

    const response = await handleEarlyAccess(request({
      email: 'shopper@example.com',
      reason: 'I want to find limited local products.',
      turnstileToken: 'valid-token',
    }), env({
      EARLY_ACCESS_RATE_LIMIT: { get: kvGet, put: kvPut },
    }), fetchImpl)

    expect(response.status).toBe(204)
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    const dailyPut = kvPut.mock.calls.find(([key]) => key.startsWith('early-access-daily:'))
    expect(dailyPut).toBeDefined()
    expect(dailyPut[1]).toBe('20')
  })

  it('rejects oversized request bodies for early-access', async () => {
    const fetchImpl = vi.fn()
    const oversizedBody = JSON.stringify({
      email: 'shopper@example.com',
      reason: 'I want to find limited local products. ' + 'x'.repeat(3000),
      turnstileToken: 'valid-token',
    })
    const oversizedRequest = new Request('https://finditviral.com/api/early-access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: oversizedBody,
    })

    const response = await handleEarlyAccess(oversizedRequest, env(), fetchImpl)

    expect(response.status).toBe(400)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('sitemap generation', () => {
  function sitemapEnv(overrides = {}) {
    return {
      SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_SECRET_KEY: 'sb_secret_test_key_long_enough',
      ASSETS: {
        fetch: vi.fn().mockResolvedValue(
          new Response('<xml>static</xml>', { status: 200, headers: { 'Content-Type': 'application/xml' } }),
        ),
      },
      ...overrides,
    }
  }

  function sitemapFetchMock(urls) {
    return vi.fn().mockResolvedValue(
      new Response(JSON.stringify(urls), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    )
  }

  it('returns dynamic XML with product URLs from Supabase RPC', async () => {
    const urls = [
      { url_path: '/', lastmod: '2026-07-14', changefreq: 'weekly', priority: 1.0 },
      { url_path: '/products/test-product', lastmod: '2026-07-13', changefreq: 'weekly', priority: 0.8 },
      { url_path: '/stores/test-store', lastmod: '2026-07-12', changefreq: 'weekly', priority: 0.6 },
      { url_path: '/leads/test-lead', lastmod: '2026-07-11', changefreq: 'daily', priority: 0.5 },
    ]
    const fetchImpl = sitemapFetchMock(urls)
    vi.stubGlobal('fetch', fetchImpl)

    const request = new Request('https://finditviral.com/sitemap.xml', { method: 'GET' })
    const response = await worker.fetch(request, sitemapEnv())

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('application/xml; charset=utf-8')
    const body = await response.text()
    expect(body).toContain('<urlset')
    expect(body).toContain('https://finditviral.com/products/test-product')
    expect(body).toContain('https://finditviral.com/stores/test-store')
    expect(body).toContain('https://finditviral.com/leads/test-lead')
    vi.unstubAllGlobals()
  })

  it('falls back to static sitemap when Supabase is unreachable', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('Connection refused'))
    vi.stubGlobal('fetch', fetchImpl)

    const env = sitemapEnv()
    const request = new Request('https://finditviral.com/sitemap.xml', { method: 'GET' })
    const response = await worker.fetch(request, env)

    expect(env.ASSETS.fetch).toHaveBeenCalledWith(request)
    vi.unstubAllGlobals()
  })

  it('falls back to static sitemap when Supabase config is missing', async () => {
    const env = sitemapEnv({ SUPABASE_URL: undefined, SUPABASE_SECRET_KEY: undefined })
    const request = new Request('https://finditviral.com/sitemap.xml', { method: 'GET' })
    const response = await worker.fetch(request, env)

    expect(env.ASSETS.fetch).toHaveBeenCalledWith(request)
  })

  it('filters out invalid sitemap paths', async () => {
    const urls = [
      { url_path: '/', lastmod: '2026-07-14', changefreq: 'weekly', priority: 1.0 },
      { url_path: '//example', lastmod: '2026-07-14', changefreq: 'weekly', priority: 0.5 },
      { url_path: '/../admin', lastmod: '2026-07-14', changefreq: 'weekly', priority: 0.5 },
      { url_path: '/auth', lastmod: '2026-07-14', changefreq: 'weekly', priority: 0.5 },
      { url_path: '/products/item?unexpected=query', lastmod: '2026-07-14', changefreq: 'weekly', priority: 0.5 },
      { url_path: '/stores/item#fragment', lastmod: '2026-07-14', changefreq: 'weekly', priority: 0.5 },
      { url_path: '/products/valid-product', lastmod: '2026-07-14', changefreq: 'weekly', priority: 0.8 },
      { url_path: '/leads/valid-lead', lastmod: '2026-07-14', changefreq: 'daily', priority: 0.5 },
    ]
    const fetchImpl = sitemapFetchMock(urls)
    vi.stubGlobal('fetch', fetchImpl)

    const request = new Request('https://finditviral.com/sitemap.xml', { method: 'GET' })
    const response = await worker.fetch(request, sitemapEnv())

    expect(response.status).toBe(200)
    const body = await response.text()
    expect(body).toContain('https://finditviral.com/')
    expect(body).toContain('https://finditviral.com/products/valid-product')
    expect(body).toContain('https://finditviral.com/leads/valid-lead')
    expect(body).not.toContain('//example')
    expect(body).not.toContain('/../admin')
    expect(body).not.toContain('/auth')
    expect(body).not.toContain('?unexpected=query')
    expect(body).not.toContain('#fragment')
    vi.unstubAllGlobals()
  })
})
