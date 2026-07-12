const SPA_ROUTES = [
  /^\/privacy\/?$/,
  /^\/home\/?$/,
  /^\/trends\//,
  /^\/products\//,
  /^\/bounties(?:\/|$)/,
  /^\/sightings(?:\/|$)/,
  /^\/profile\//,
]

export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    if (url.hostname === 'finditviral.pages.dev') {
      url.hostname = 'finditviral.com'
      url.protocol = 'https:'
      return Response.redirect(url.toString(), 301)
    }

    const response = await env.ASSETS.fetch(request)
    const acceptsHtml = request.headers.get('Accept')?.includes('text/html') ?? false
    const isSpaRoute = SPA_ROUTES.some((pattern) => pattern.test(url.pathname))

    if (
      response.status !== 404
      || request.method !== 'GET'
      || !acceptsHtml
      || !isSpaRoute
    ) {
      return response
    }

    const indexUrl = new URL('/', url)
    return env.ASSETS.fetch(new Request(indexUrl, request))
  },
}
