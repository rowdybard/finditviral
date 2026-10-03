const purchaseUrl = 'mailto:contact@finditviral.com?subject=Purchase%20finditviral.com'

/** All retired services share this handler; it needs no credentials or bindings. */
export default {
  fetch(request: Request): Response {
    return new Response(request.method === 'HEAD' ? null : JSON.stringify({
      status: 'retired',
      message: 'FindItViral has closed. Thank you for being part of the community. The domain finditviral.com is available for purchase.',
      purchase_url: purchaseUrl,
      website: 'https://finditviral.com',
    }), {
      status: 410,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  },

  // Defensive no-op for an event already in flight when triggers are removed.
  scheduled(): void {},

  // Unexpected late queue deliveries must not restart work or retry forever.
  queue(batch: { ackAll(): void }): void {
    batch.ackAll()
  },
}
