import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const purchaseLink = 'mailto:contact@finditviral.com?subject=Purchase%20finditviral.com'

function verifyHtml(html, label) {
  assert.match(html, /<h1\b[^>]*>FindItViral has closed\.<\/h1>/, `${label}: missing closure message`)
  assert.match(html, /Thank you to everyone who joined our beta community\./, `${label}: missing community thanks`)
  assert.match(html, /domain is available for purchase/, `${label}: missing domain offer`)
  assert.ok(html.includes(`href="${purchaseLink}">Buy this domain`), `${label}: incorrect purchase button`)
  assert.doesNotMatch(html, /<(?:script|iframe|form|object|embed)\b/i, `${label}: executable or app content remains`)
  assert.doesNotMatch(html, /\bon\w+\s*=|javascript:|\burl\s*\(/i, `${label}: executable handler or fetched CSS resource remains`)
  assert.doesNotMatch(html, /\b(?:src|srcset)\s*=|rel\s*=\s*["'](?:manifest|stylesheet|preload|modulepreload|preconnect)["']/i, `${label}: runtime asset remains`)
  assert.doesNotMatch(html, /supabase|googletagmanager|google-analytics|cloudflareinsights|turnstile|\/src\/main|\/assets\//i, `${label}: active integration remains`)
  for (const match of html.matchAll(/<a\b[^>]*\bhref\s*=\s*"([^"]+)"/gi)) {
    assert.equal(match[1], purchaseLink, `${label}: unexpected interactive destination`)
  }
}

if (process.argv.includes('--remote')) {
  const base = new URL(process.env.LAUNCH_BASE_URL || 'https://finditviral.com')
  assert.ok(['https:', 'http:'].includes(base.protocol), 'Smoke URL must use HTTP or HTTPS')
  for (const path of ['/', '/home', '/privacy', '/api/health', '/api/early-access', '/assets/retirement-check.js', '/service-worker.js', '/retirement-check/unknown']) {
    const response = await fetch(new URL(path, base), {
      headers: { Accept: 'text/html', 'Cache-Control': 'no-cache' },
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
    })
    assert.ok([200, 404].includes(response.status), `${path}: unexpected HTTP ${response.status}`)
    assert.match(response.headers.get('content-type') || '', /text\/html/i, `${path}: app or API response still active`)
    verifyHtml(await response.text(), path)
    console.log(`[pass] ${path} serves the static retirement message`)
  }
} else {
  const output = resolve(root, 'dist')
  const entries = await readdir(output, { withFileTypes: true })
  assert.deepEqual(entries.map(entry => entry.name).sort(), ['404.html', '_redirects', 'index.html'].sort(), 'dist must contain only retirement HTML and redirects')
  assert.ok(entries.every(entry => entry.isFile()), 'dist must contain no asset directories or workers')
  const html = await readFile(resolve(output, 'index.html'), 'utf8')
  const fallback = await readFile(resolve(output, '404.html'), 'utf8')
  verifyHtml(html, 'index.html')
  assert.equal(fallback, html, '404 fallback must show the same retirement message')
  assert.equal(html, await readFile(resolve(root, 'index.html'), 'utf8'), 'Built page must match the maintained source')
  assert.equal(await readFile(resolve(output, '_redirects'), 'utf8'), '/* /index.html 200\n', 'All former routes must resolve to the retirement page')
  console.log('[pass] Static retirement artifact, inquiry link, catch-all routes, and absence of app/worker assets')
}
