import { describe, expect, it, vi } from 'vitest'
import { handleEarlyAccess } from './_worker.js'

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

  it('authenticates to Supabase with both apikey and Authorization headers', async () => {
    const fetchImpl = vi.fn(async (url, init) => {
      if (String(url).includes('siteverify')) {
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      expect(init.headers.apikey).toBe('sb_secret_test')
      expect(init.headers.Authorization).toBe('Bearer sb_secret_test')
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
