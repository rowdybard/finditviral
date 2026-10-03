import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const purchaseLink = 'mailto:contact@finditviral.com?subject=Purchase%20finditviral.com'

// Cloudflare may add this exact JavaScript Detections bootstrap at the edge.
// Recognize the known template with only its ray/timestamp values normalized;
// arbitrary scripts (including email decoding and old app bundles) still fail.
const cloudflareJsd = `(function(){function c(){var b=a.contentDocument||(a.contentWindow&&a.contentWindow.document);if(b){var d=b.createElement('script');d.innerHTML="window.__CF$cv$params={r:'RAY_ID',t:'TIMESTAMP'};var a=document.createElement('script');a.src='/cdn-cgi/challenge-platform/scripts/jsd/main.js';document.getElementsByTagName('head')[0].appendChild(a);";b.getElementsByTagName('head')[0].appendChild(d)}}if(document.body){var a=document.createElement('iframe');a.height=1;a.width=1;a.style.position='absolute';a.style.top=0;a.style.left=0;a.style.border='none';a.style.visibility='hidden';document.body.appendChild(a);if('loading'!==document.readyState)c();else if(window.addEventListener)document.addEventListener('DOMContentLoaded',c);else{var e=document.onreadystatechange||function(){};document.onreadystatechange=function(b){e(b);'loading'!==document.readyState&&(document.onreadystatechange=e,c())}}}})();`

function authoredHtmlFromRemote(html) {
  return html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (tag, attributes, body) => {
    const normalized = body.trim().replace(
      /window\.__CF\$cv\$params=\{r:'[0-9a-f]+',t:'[A-Za-z0-9+/=]+'\}/,
      "window.__CF$cv$params={r:'RAY_ID',t:'TIMESTAMP'}",
    )
    if (!attributes.trim() && normalized === cloudflareJsd) return ''

    // Accept only the observed Pages-managed beacon tag, never other telemetry.
    // Analytics is disabled in hosting; this handles an edge response in transit.
    const beacon = attributes.trim().match(/^defer\s+src=(['"])https:\/\/static\.cloudflareinsights\.com\/beacon\.min\.js\1\s+data-cf-beacon=(['"])(.*?)\2$/)
    if (!body.trim() && beacon) {
      try {
        const config = JSON.parse(beacon[3])
        if (Object.keys(config).length === 1 && /^[0-9a-f]{32}$/.test(config.token)) return ''
      } catch { /* Leave an unrecognized tag intact so verification fails. */ }
    }
    return tag
  })
}

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
    verifyHtml(authoredHtmlFromRemote(await response.text()), path)
    console.log(`[pass] ${path} serves the static retirement message`)
  }
} else {
  const output = resolve(root, 'dist')
  const entries = await readdir(output, { withFileTypes: true })
  assert.deepEqual(entries.map(entry => entry.name).sort(), ['404.html', 'index.html'].sort(), 'dist must contain only retirement HTML and its fallback')
  assert.ok(entries.every(entry => entry.isFile()), 'dist must contain no asset directories or workers')
  const html = await readFile(resolve(output, 'index.html'), 'utf8')
  const fallback = await readFile(resolve(output, '404.html'), 'utf8')
  verifyHtml(html, 'index.html')
  assert.match(html, /<!--email_off-->[\s\S]*href="mailto:contact@finditviral\.com\?subject=Purchase%20finditviral\.com"[\s\S]*<!--\/email_off-->/, 'Purchase links must bypass Cloudflare email obfuscation without JavaScript')
  assert.equal(fallback, html, '404 fallback must show the same retirement message')
  assert.equal(html, await readFile(resolve(root, 'index.html'), 'utf8'), 'Built page must match the maintained source')
  console.log('[pass] Static retirement artifact, inquiry link, closure fallback, and absence of app/worker assets')
}
