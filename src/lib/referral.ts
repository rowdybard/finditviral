const REFERRAL_KEY = 'fiv_referrer'

export function captureReferrer() {
  const params = new URLSearchParams(window.location.search)
  const ref = params.get('ref')
  if (ref && /^[a-z0-9_]{3,20}$/.test(ref)) {
    localStorage.setItem(REFERRAL_KEY, ref)
  }
}

export function getStoredReferrer(): string | null {
  return localStorage.getItem(REFERRAL_KEY)
}

export function clearStoredReferrer() {
  localStorage.removeItem(REFERRAL_KEY)
}

export function buildReferralLink(username: string): string {
  return `https://finditviral.com/?ref=${username}`
}
