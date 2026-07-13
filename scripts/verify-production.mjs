const args = new Set(process.argv.slice(2))
const webOnly = args.has('--web-only')
const baseUrl = new URL(process.env.LAUNCH_BASE_URL || 'https://finditviral.com')
const isCanonicalProduction = baseUrl.origin === 'https://finditviral.com'

let failures = 0

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function check(name, operation) {
  try {
    await operation()
    console.log(`[pass] ${name}`)
  } catch (error) {
    failures += 1
    console.error(`[fail] ${name}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function getTags(html, name) {
  return html.match(new RegExp(`<${name}\\b[^>]*>`, 'gi')) ?? []
}

function getAttributes(tag) {
  const attributes = new Map()
  for (const match of tag.matchAll(/([:\w-]+)\s*=\s*(["'])(.*?)\2/g)) {
    attributes.set(match[1].toLowerCase(), match[3])
  }
  return attributes
}

function getMetaContent(html, attribute, value) {
  for (const tag of getTags(html, 'meta')) {
    const attributes = getAttributes(tag)
    if (attributes.get(attribute) === value) return attributes.get('content') ?? ''
  }
  return ''
}

function getCanonical(html) {
  for (const tag of getTags(html, 'link')) {
    const attributes = getAttributes(tag)
    if (attributes.get('rel') === 'canonical') return attributes.get('href') ?? ''
  }
  return ''
}

function getTitle(html) {
  return html.match(/<title>(.*?)<\/title>/i)?.[1] ?? ''
}

async function fetchFromBase(pathname, init = {}) {
  return fetch(new URL(pathname, baseUrl), init)
}

let rootHtml = ''
let rootResponse
let privacyHtml = ''
let privateHtml = ''
let assetPath = ''
let assetText = ''
let supabaseUrl = ''
let supabaseKey = ''

await check('landing page returns HTML', async () => {
  rootResponse = await fetchFromBase('/', { headers: { Accept: 'text/html' } })
  rootHtml = await rootResponse.text()
  assert(rootResponse.status === 200, `expected 200, received ${rootResponse.status}`)
  assert(rootResponse.headers.get('content-type')?.includes('text/html'), 'missing HTML content type')
  assert(getTitle(rootHtml) === 'FindItViral - Greater Lansing Early Access', 'unexpected landing title')
  assert(getCanonical(rootHtml) === 'https://finditviral.com/', 'unexpected landing canonical URL')
})

await check('privacy route supports GET without content negotiation', async () => {
  const response = await fetchFromBase('/privacy')
  privacyHtml = await response.text()
  assert(response.status === 200, `expected 200, received ${response.status}`)
  assert(response.headers.get('content-type')?.includes('text/html'), 'missing HTML content type')
})

await check('privacy route supports HEAD', async () => {
  const response = await fetchFromBase('/privacy', { method: 'HEAD' })
  assert(response.status === 200, `expected 200, received ${response.status}`)
})

await check('privacy route has distinct indexable metadata', async () => {
  assert(getTitle(privacyHtml) === 'Privacy Notice - FindItViral', 'unexpected privacy title')
  assert(getCanonical(privacyHtml) === 'https://finditviral.com/privacy', 'unexpected privacy canonical URL')
  assert(getMetaContent(privacyHtml, 'name', 'robots') === 'index, follow', 'unexpected privacy robots value')
  assert(getMetaContent(privacyHtml, 'property', 'og:url') === 'https://finditviral.com/privacy', 'unexpected privacy Open Graph URL')
})

await check('private route is served but excluded from search', async () => {
  const response = await fetchFromBase('/home', { headers: { Accept: 'text/html' } })
  privateHtml = await response.text()
  assert(response.status === 200, `expected 200, received ${response.status}`)
  assert(getMetaContent(privateHtml, 'name', 'robots') === 'noindex, nofollow', 'missing private noindex metadata')
  assert(response.headers.get('x-robots-tag') === 'noindex, nofollow, noarchive', 'missing private X-Robots-Tag')
})

await check('unknown route returns a real 404', async () => {
  const response = await fetchFromBase('/definitely-not-a-route', { headers: { Accept: 'text/html' } })
  assert(response.status === 404, `expected 404, received ${response.status}`)
})

await check('missing JavaScript asset returns a real 404', async () => {
  const response = await fetchFromBase('/assets/definitely-missing.js')
  assert(response.status === 404, `expected 404, received ${response.status}`)
})

await check('crawler files are real static resources', async () => {
  const [robots, sitemap] = await Promise.all([
    fetchFromBase('/robots.txt'),
    fetchFromBase('/sitemap.xml'),
  ])
  assert(robots.status === 200 && robots.headers.get('content-type')?.includes('text/plain'), 'robots.txt is not plain text')
  assert(sitemap.status === 200 && sitemap.headers.get('content-type')?.includes('xml'), 'sitemap.xml is not XML')
})

await check('security headers support Cloudflare analytics and nonce injection', async () => {
  assert(rootResponse, 'landing response was unavailable')
  const csp = rootResponse.headers.get('content-security-policy') ?? ''
  const nonce = csp.match(/'nonce-([^']+)'/)?.[1] ?? ''
  assert(nonce.length >= 16, 'CSP nonce is missing')
  assert(csp.includes('https://static.cloudflareinsights.com'), 'analytics script origin is missing from CSP')
  assert(csp.includes('https://cloudflareinsights.com'), 'analytics beacon origin is missing from CSP')
  assert(rootResponse.headers.get('strict-transport-security')?.includes('max-age='), 'HSTS is missing')
  assert(rootResponse.headers.get('x-content-type-options') === 'nosniff', 'MIME sniffing protection is missing')
  assert(rootResponse.headers.get('x-frame-options') === 'DENY', 'frame protection is missing')

  const scripts = getTags(rootHtml, 'script').map((tag) => getAttributes(tag))
  const analyticsScript = scripts.find((attributes) => attributes.get('src')?.includes('static.cloudflareinsights.com'))
  assert(Boolean(analyticsScript), 'Cloudflare Web Analytics is not injected')
  for (const script of scripts.filter((attributes) => !attributes.has('src'))) {
    assert(script.get('nonce') === nonce, 'an inline Cloudflare script is missing the response nonce')
  }
})

await check('hashed module asset has JavaScript MIME and immutable caching', async () => {
  const moduleScript = getTags(rootHtml, 'script')
    .map((tag) => getAttributes(tag))
    .find((attributes) => attributes.get('type') === 'module')
  assetPath = moduleScript?.get('src') ?? ''
  assert(assetPath.startsWith('/assets/'), 'hashed module asset path was not found')
  const response = await fetchFromBase(assetPath)
  assetText = await response.text()
  assert(response.status === 200, `expected 200, received ${response.status}`)
  assert(response.headers.get('content-type')?.includes('javascript'), 'module asset has the wrong MIME type')
  assert(response.headers.get('cache-control')?.includes('immutable'), 'module asset is not cached immutably')
})

await check('public bundle contains only browser-safe Supabase configuration', async () => {
  const allJsUrls = [
    assetPath,
    ...getTags(rootHtml, 'link')
      .map((tag) => getAttributes(tag))
      .filter((attributes) => attributes.get('rel') === 'modulepreload' && attributes.get('href')?.startsWith('/assets/'))
      .map((attributes) => attributes.get('href')),
  ].filter(Boolean)

  const allJsTexts = [assetText]
  for (const jsUrl of allJsUrls) {
    if (jsUrl === assetPath) continue
    try {
      const resp = await fetchFromBase(jsUrl)
      allJsTexts.push(await resp.text())
    } catch { /* ignore fetch errors for preloaded chunks */ }
  }

  const dynamicChunkMatch = assetText.match(/["'`]((?:\.\/|\/assets\/)PrivateApp-[^"'`]+\.js)["'`]/)
  if (dynamicChunkMatch) {
    try {
      const dynamicChunkUrl = new URL(dynamicChunkMatch[1], new URL(assetPath, baseUrl))
      const resp = await fetch(dynamicChunkUrl)
      allJsTexts.push(await resp.text())
    } catch { /* ignore */ }
  }

  const combinedText = allJsTexts.join('\n')

  supabaseUrl = combinedText.match(/https:\/\/[a-z0-9]+\.supabase\.co/)?.[0]
    || process.env.VITE_SUPABASE_URL
    || ''
  supabaseKey = combinedText.match(/sb_publishable_[A-Za-z0-9_-]+/)?.[0]
    || process.env.VITE_SUPABASE_ANON_KEY
    || ''
  assert(Boolean(supabaseUrl), 'Supabase project URL is missing')
  assert(Boolean(supabaseKey), 'Supabase publishable key is missing')
  assert(!combinedText.includes('sb_secret_'), 'a Supabase secret key appears in the browser bundle')
})

if (isCanonicalProduction) {
  await check('Pages hostname redirects to the canonical domain', async () => {
    const response = await fetch('https://finditviral.pages.dev/privacy?source=smoke', { redirect: 'manual' })
    assert(response.status === 301, `expected 301, received ${response.status}`)
    assert(response.headers.get('location') === 'https://finditviral.com/privacy?source=smoke', 'redirect did not preserve path and query')
  })

  await check('www hostname redirects to the canonical domain', async () => {
    const response = await fetch('https://www.finditviral.com/privacy?source=smoke', { redirect: 'manual' })
    assert(response.status === 301, `expected 301, received ${response.status}`)
    assert(response.headers.get('location') === 'https://finditviral.com/privacy?source=smoke', 'redirect did not preserve path and query')
  })
}

if (webOnly) {
  console.log('[skip] Supabase database and owner-auth gates (--web-only)')
} else {
  await check('listing embeds resolve through declared database relationships', async () => {
    const relationQueries = [
      ['products', '*,trend:trends(*)'],
      ['bounties', '*,product:products(*),profile:profiles(id,username)'],
      ['sightings', '*,product:products(*),profile:profiles(id,username)'],
      ['bounty_claims', '*,bounty:bounties(*,product:products(*)),finder:profiles(id,username)'],
    ]

    for (const [table, select] of relationQueries) {
      const response = await fetch(
        `${supabaseUrl}/rest/v1/${table}?select=${encodeURIComponent(select)}&limit=1`,
        { headers: { apikey: supabaseKey } },
      )
      const body = await response.json().catch(() => ({}))
      assert(
        body.code !== 'PGRST200',
        `${table} has an unresolved embedded relationship: ${body.message ?? 'unknown error'}`,
      )
    }
  })

  await check('waitlist RPC rejects anonymous calls', async () => {
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/request_early_access`, {
      method: 'POST',
      headers: { apikey: supabaseKey, 'content-type': 'application/json' },
      body: JSON.stringify({ p_email: '', p_reason: '' }),
    })
    assert(response.status === 401 || response.status === 403, `expected 401/403 for anon RPC call, received ${response.status}`)
  })

  await check('anonymous users cannot read the waitlist table', async () => {
    const response = await fetch(`${supabaseUrl}/rest/v1/early_access_requests?select=id&limit=1`, {
      headers: { apikey: supabaseKey },
    })
    const body = await response.json().catch(() => ({}))
    assert(response.status === 401 || response.status === 403, `expected 401/403, received ${response.status}/${body.code ?? 'no-code'}`)
  })

  await check('public Supabase Auth signup is disabled', async () => {
    const response = await fetch(`${supabaseUrl}/auth/v1/settings`, { headers: { apikey: supabaseKey } })
    const body = await response.json()
    assert(response.status === 200, `expected 200, received ${response.status}`)
    assert(body.disable_signup === true, 'disable_signup is not true')
  })

  await check('owner gate RPC exists but is not anonymous', async () => {
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/is_app_owner`, {
      method: 'POST',
      headers: { apikey: supabaseKey, 'content-type': 'application/json' },
      body: '{}',
    })
    const body = await response.json().catch(() => ({}))
    assert(!(response.status === 404 && body.code === 'PGRST202'), 'owner RPC is missing')
    assert(response.status === 401 || response.status === 403, `expected 401/403, received ${response.status}/${body.code ?? 'no-code'}`)
  })
}

if (failures > 0) {
  console.error(`\n${failures} launch verification check(s) failed.`)
  process.exitCode = 1
} else {
  console.log('\nAll selected launch verification checks passed.')
}
