const CANONICAL_HOST = 'finditviral.com'
const REDIRECT_HOSTS = new Set(['finditviral.pages.dev', 'www.finditviral.com'])

const EARLY_ACCESS_PATH = '/api/early-access'
const PRODUCT_CLICK_PATH = '/api/product-click'
const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const PRODUCT_CLICK_COOKIE = '__Host-fiv_heat'
const PRODUCT_CLICK_COOKIE_MAX_AGE = 60 * 60 * 24 * 30
const PRODUCT_CLICK_RATE_LIMIT_MAX = 60
const PRODUCT_CLICK_RATE_LIMIT_WINDOW_SECONDS = 600
const PRODUCT_CLICK_MAX_BODY_LENGTH = 256
const RATE_LIMIT_MAX_REQUESTS = 5
const RATE_LIMIT_WINDOW_SECONDS = 600
const UPSTREAM_TIMEOUT_MS = 10_000

const SPA_ROUTES = [
  /^\/privacy\/?$/,
  /^\/auth\/?$/,
  /^\/onboarding\/?$/,
  /^\/home\/?$/,
  /^\/trends\//,
  /^\/products\//,
  /^\/bounties(?:\/|$)/,
  /^\/sightings(?:\/|$)/,
  /^\/profile\//,
]

const ROOT_METADATA = {
  title: 'FindItViral - Find Viral Products in Greater Lansing',
  description: 'Join the FindItViral beta to find and report viral, limited, and hard-to-find retail products around Greater Lansing.',
  canonicalUrl: 'https://finditviral.com/',
  robots: 'index, follow',
}

const PRIVACY_METADATA = {
  title: 'Privacy Notice - FindItViral',
  description: 'How FindItViral collects, uses, retains, and deletes early-access waitlist information.',
  canonicalUrl: 'https://finditviral.com/privacy',
  robots: 'index, follow',
}

const PRIVATE_METADATA = {
  title: 'Greater Lansing Beta - FindItViral',
  description: 'The signed-in FindItViral beta for Greater Lansing shoppers.',
  canonicalUrl: 'https://finditviral.com/',
  robots: 'noindex, nofollow',
}

function createNonce() {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return btoa(String.fromCharCode(...bytes))
}

function createContentSecurityPolicy(nonce) {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://cloudflareinsights.com https://challenges.cloudflare.com https://www.google-analytics.com",
    "font-src 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "frame-src https://challenges.cloudflare.com",
    "img-src 'self' data: https://images.unsplash.com https://www.google-analytics.com",
    "manifest-src 'self'",
    "object-src 'none'",
    `script-src 'self' 'nonce-${nonce}' https://static.cloudflareinsights.com https://challenges.cloudflare.com https://www.googletagmanager.com`,
    "style-src 'self'",
    'upgrade-insecure-requests',
  ].join('; ')
}

function createApiResponse(status, body, extraHeaders = {}) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: {
      'Cache-Control': 'no-store',
      ...(body === null ? {} : { 'Content-Type': 'application/json; charset=utf-8' }),
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      ...extraHeaders,
    },
  })
}

function createSupabaseServerHeaders(apiKey) {
  return {
    apikey: apiKey,
    ...(apiKey.startsWith('eyJ') ? { Authorization: `Bearer ${apiKey}` } : {}),
    'Content-Type': 'application/json',
  }
}

function logApiEvent(level, message, details = {}) {
  const entry = JSON.stringify({ message, ...details })
  if (level === 'error') console.error(entry)
  else console.warn(entry)
}

async function enforceRateLimit(env, clientIp) {
  if (!env.EARLY_ACCESS_RATE_LIMIT || !clientIp) return 'allowed'

  try {
    const key = `early-access:${clientIp}`
    const currentCount = Number((await env.EARLY_ACCESS_RATE_LIMIT.get(key)) ?? '0')
    if (!Number.isFinite(currentCount)) return 'allowed'
    if (currentCount >= RATE_LIMIT_MAX_REQUESTS) return 'limited'
    await env.EARLY_ACCESS_RATE_LIMIT.put(key, String(currentCount + 1), {
      expirationTtl: RATE_LIMIT_WINDOW_SECONDS,
    })
    return 'allowed'
  } catch (error) {
    logApiEvent('error', 'rate limit storage unavailable', {
      error: error instanceof Error ? error.message : String(error),
    })
    return 'allowed'
  }
}

async function createSha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

async function enforceProductClickRateLimit(env, clientIp) {
  if (!clientIp) return 'allowed'

  try {
    const clientKey = await createSha256Hex(`${env.SUPABASE_SECRET_KEY}:${clientIp}`)
    const key = `product-click-rate:${clientKey}`
    const currentCount = Number((await env.EARLY_ACCESS_RATE_LIMIT.get(key)) ?? '0')
    if (!Number.isFinite(currentCount)) return 'unavailable'
    if (currentCount >= PRODUCT_CLICK_RATE_LIMIT_MAX) return 'limited'
    await env.EARLY_ACCESS_RATE_LIMIT.put(key, String(currentCount + 1), {
      expirationTtl: PRODUCT_CLICK_RATE_LIMIT_WINDOW_SECONDS,
    })
    return 'allowed'
  } catch (error) {
    logApiEvent('error', 'product click rate limit unavailable', {
      error: error instanceof Error ? error.message : String(error),
    })
    return 'unavailable'
  }
}

function getCookie(request, name) {
  const cookieHeader = request.headers.get('Cookie') ?? ''
  const prefix = `${name}=`
  const match = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
  return match ? match.slice(prefix.length) : ''
}

function createProductClickCookie(visitorId) {
  return [
    `${PRODUCT_CLICK_COOKIE}=${visitorId}`,
    'Path=/',
    `Max-Age=${PRODUCT_CLICK_COOKIE_MAX_AGE}`,
    'Secure',
    'HttpOnly',
    'SameSite=Lax',
  ].join('; ')
}

async function readJsonWithByteLimit(request, maxBytes) {
  const contentLength = Number(request.headers.get('Content-Length') ?? '0')
  if (Number.isFinite(contentLength) && contentLength > maxBytes) return null
  if (!request.body) return null

  const reader = request.body.getReader()
  const chunks = []
  let totalBytes = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      totalBytes += value.byteLength
      if (totalBytes > maxBytes) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }

    const body = new Uint8Array(totalBytes)
    let offset = 0
    for (const chunk of chunks) {
      body.set(chunk, offset)
      offset += chunk.byteLength
    }
    return JSON.parse(new TextDecoder().decode(body))
  } catch {
    try {
      await reader.cancel()
    } catch {
      // The stream may already be closed or errored.
    }
    return null
  }
}

export async function handleProductClick(request, env, fetchImpl = fetch) {
  if (request.method !== 'POST') {
    return createApiResponse(405, { error: 'method_not_allowed' }, { Allow: 'POST' })
  }

  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY || !env.EARLY_ACCESS_RATE_LIMIT) {
    logApiEvent('error', 'product click endpoint is missing server configuration', {
      hasSupabaseUrl: Boolean(env.SUPABASE_URL),
      hasSupabaseSecret: Boolean(env.SUPABASE_SECRET_KEY),
      hasRateLimit: Boolean(env.EARLY_ACCESS_RATE_LIMIT),
    })
    return createApiResponse(503, { error: 'unavailable' }, { 'Retry-After': '300' })
  }

  const requestUrl = new URL(request.url)
  if (request.headers.get('Origin') !== requestUrl.origin) {
    return createApiResponse(403, { error: 'forbidden' })
  }

  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) {
    return createApiResponse(400, { error: 'invalid_request' })
  }

  const payload = await readJsonWithByteLimit(request, PRODUCT_CLICK_MAX_BODY_LENGTH)
  if (!payload) return createApiResponse(400, { error: 'invalid_request' })

  const productId = typeof payload?.productId === 'string' ? payload.productId.trim().toLowerCase() : ''
  if (!UUID_PATTERN.test(productId)) {
    return createApiResponse(400, { error: 'invalid_request' })
  }

  const existingVisitorId = getCookie(request, PRODUCT_CLICK_COOKIE)
  const hasValidVisitorId = UUID_PATTERN.test(existingVisitorId)
  const visitorId = hasValidVisitorId ? existingVisitorId.toLowerCase() : crypto.randomUUID()
  const cookieHeaders = hasValidVisitorId
    ? {}
    : { 'Set-Cookie': createProductClickCookie(visitorId) }

  const clientIp = request.headers.get('CF-Connecting-IP') ?? ''
  const rateLimit = await enforceProductClickRateLimit(env, clientIp)
  if (rateLimit !== 'allowed') {
    return createApiResponse(204, null, cookieHeaders)
  }

  const clickKey = await createSha256Hex(`${visitorId}:${productId}`)

  try {
    const rpcResponse = await fetchImpl(
      `${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/record_product_click`,
      {
        method: 'POST',
        headers: createSupabaseServerHeaders(env.SUPABASE_SECRET_KEY),
        body: JSON.stringify({
          p_product_id: productId,
          p_click_key: clickKey,
        }),
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      },
    )

    if (!rpcResponse.ok) {
      logApiEvent('error', 'product click persistence failed', { status: rpcResponse.status })
      return rpcResponse.status === 400
        ? createApiResponse(400, { error: 'invalid_request' }, cookieHeaders)
        : createApiResponse(502, { error: 'unavailable' }, cookieHeaders)
    }
  } catch (error) {
    logApiEvent('error', 'product click persistence unreachable', {
      error: error instanceof Error ? error.message : String(error),
    })
    return createApiResponse(502, { error: 'unavailable' }, cookieHeaders)
  }

  return createApiResponse(204, null, cookieHeaders)
}

async function verifyTurnstileToken(env, token, clientIp, fetchImpl) {
  try {
    const response = await fetchImpl(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret: env.TURNSTILE_SECRET_KEY,
        response: token,
        ...(clientIp ? { remoteip: clientIp } : {}),
      }),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    })
    if (!response.ok) return false
    const verification = await response.json()
    return verification?.success === true
  } catch (error) {
    logApiEvent('error', 'turnstile verification unavailable', {
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}

export async function handleEarlyAccess(request, env, fetchImpl = fetch) {
  if (request.method !== 'POST') {
    return createApiResponse(405, { error: 'method_not_allowed' }, { Allow: 'POST' })
  }

  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY || !env.TURNSTILE_SECRET_KEY) {
    logApiEvent('error', 'early access endpoint is missing server configuration', {
      hasSupabaseUrl: Boolean(env.SUPABASE_URL),
      hasSupabaseSecret: Boolean(env.SUPABASE_SECRET_KEY),
      hasTurnstileSecret: Boolean(env.TURNSTILE_SECRET_KEY),
    })
    return createApiResponse(503, { error: 'unavailable' }, { 'Retry-After': '300' })
  }

  let payload
  try {
    payload = await request.json()
  } catch {
    return createApiResponse(400, { error: 'invalid_request' })
  }

  const email = typeof payload?.email === 'string' ? payload.email.trim().toLowerCase() : ''
  const reason = typeof payload?.reason === 'string' ? payload.reason.trim() : ''
  const token = typeof payload?.turnstileToken === 'string' ? payload.turnstileToken.trim() : ''

  if (
    email.length < 3
    || email.length > 320
    || !EMAIL_PATTERN.test(email)
    || reason.length < 10
    || reason.length > 1200
  ) {
    return createApiResponse(400, { error: 'invalid_request' })
  }

  if (!token) {
    return createApiResponse(400, { error: 'verification_required' })
  }

  const clientIp = request.headers.get('CF-Connecting-IP') ?? ''

  if ((await enforceRateLimit(env, clientIp)) === 'limited') {
    return createApiResponse(429, { error: 'rate_limited' }, { 'Retry-After': String(RATE_LIMIT_WINDOW_SECONDS) })
  }

  if (!(await verifyTurnstileToken(env, token, clientIp, fetchImpl))) {
    return createApiResponse(400, { error: 'verification_failed' })
  }

  try {
    const rpcResponse = await fetchImpl(
      `${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/request_early_access`,
      {
        method: 'POST',
        headers: createSupabaseServerHeaders(env.SUPABASE_SECRET_KEY),
        body: JSON.stringify({ p_email: email, p_reason: reason }),
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      },
    )

    if (!rpcResponse.ok) {
      logApiEvent('error', 'early access persistence failed', { status: rpcResponse.status })
      return rpcResponse.status === 400
        ? createApiResponse(400, { error: 'invalid_request' })
        : createApiResponse(502, { error: 'unavailable' })
    }
  } catch (error) {
    logApiEvent('error', 'early access persistence unreachable', {
      error: error instanceof Error ? error.message : String(error),
    })
    return createApiResponse(502, { error: 'unavailable' })
  }

  return createApiResponse(204, null)
}

function normalizePathname(pathname) {
  if (pathname === '/') return pathname
  return pathname.replace(/\/+$/, '') || '/'
}

function isSpaRoute(pathname) {
  return SPA_ROUTES.some((pattern) => pattern.test(pathname))
}

function getPageMetadata(pathname) {
  const normalizedPathname = normalizePathname(pathname)
  if (normalizedPathname === '/') return ROOT_METADATA
  if (normalizedPathname === '/privacy') return PRIVACY_METADATA
  if (isSpaRoute(pathname)) {
    return {
      ...PRIVATE_METADATA,
      canonicalUrl: `https://finditviral.com${normalizedPathname}`,
    }
  }
  return null
}

function setText(content) {
  return {
    element(element) {
      element.setInnerContent(content)
    },
  }
}

function setAttribute(name, value) {
  return {
    element(element) {
      element.setAttribute(name, value)
    },
  }
}

function applyPageMetadata(response, metadata) {
  if (!response.headers.get('Content-Type')?.includes('text/html')) {
    return response
  }

  const nonce = createNonce()
  const headers = new Headers(response.headers)
  headers.set('Content-Security-Policy', createContentSecurityPolicy(nonce))
  if (metadata?.robots.startsWith('noindex')) {
    headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive')
  }
  const securedResponse = new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })

  if (!metadata) return securedResponse

  return new HTMLRewriter()
    .on('title', setText(metadata.title))
    .on('link[rel="canonical"]', setAttribute('href', metadata.canonicalUrl))
    .on('meta[name="description"]', setAttribute('content', metadata.description))
    .on('meta[name="robots"]', setAttribute('content', metadata.robots))
    .on('meta[property="og:title"]', setAttribute('content', metadata.title))
    .on('meta[property="og:description"]', setAttribute('content', metadata.description))
    .on('meta[property="og:url"]', setAttribute('content', metadata.canonicalUrl))
    .on('meta[name="twitter:title"]', setAttribute('content', metadata.title))
    .on('meta[name="twitter:description"]', setAttribute('content', metadata.description))
    .on('script:not([src])', setAttribute('nonce', nonce))
    .transform(securedResponse)
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    if (REDIRECT_HOSTS.has(url.hostname)) {
      url.hostname = CANONICAL_HOST
      url.protocol = 'https:'
      return Response.redirect(url.toString(), 301)
    }

    if (url.pathname === EARLY_ACCESS_PATH) {
      return handleEarlyAccess(request, env)
    }

    if (url.pathname === PRODUCT_CLICK_PATH) {
      return handleProductClick(request, env)
    }

    try {
      let response = await env.ASSETS.fetch(request)
      const acceptsHtml = request.headers.get('Accept')?.includes('text/html') ?? false
      const lastPathSegment = url.pathname.split('/').at(-1) ?? ''
      const looksLikeFile = lastPathSegment.includes('.')
      const isDocumentRequest = (
        request.method === 'HEAD'
        || (request.method === 'GET' && (acceptsHtml || !looksLikeFile))
      )

      if (
        response.status === 404
        && isDocumentRequest
        && isSpaRoute(url.pathname)
      ) {
        const indexUrl = new URL('/', url)
        response = await env.ASSETS.fetch(new Request(indexUrl, request))
      }

      return applyPageMetadata(response, getPageMetadata(url.pathname))
    } catch (error) {
      console.error(JSON.stringify({
        message: 'asset request failed',
        path: url.pathname,
        error: error instanceof Error ? error.message : String(error),
      }))

      return new Response('Service temporarily unavailable', {
        status: 503,
        headers: {
          'Cache-Control': 'no-store',
          'Content-Type': 'text/plain; charset=utf-8',
          'Retry-After': '60',
          'Referrer-Policy': 'strict-origin-when-cross-origin',
          'X-Content-Type-Options': 'nosniff',
          'X-Frame-Options': 'DENY',
        },
      })
    }
  },
}
