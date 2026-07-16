import type { ViralSignalV1 } from './domain'

const MAX_SLUG_LENGTH = 90

export function slugify(value: string): string {
  const normalized = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, '')

  return normalized || 'untitled'
}

export function normalizeGtin(value: string | undefined): string | null {
  if (!value) return null
  const digits = value.replace(/\D/g, '')
  return [8, 12, 13, 14].includes(digits.length) ? digits : null
}

function normalizeIdentityPart(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('en-US').trim().replace(/\s+/g, ' ')
}

export function candidateIdentityKey(signal: ViralSignalV1): string {
  const gtin = normalizeGtin(signal.candidate.gtin)
  if (gtin) return `gtin:${gtin}`

  if (signal.candidate.brand?.trim()) {
    return `brand-name:${normalizeIdentityPart(signal.candidate.brand)}\u0000${normalizeIdentityPart(signal.candidate.name)}`
  }

  return `source:${normalizeIdentityPart(signal.source)}\u0000${normalizeIdentityPart(signal.candidate.external_id)}`
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function stableId(prefix: string, value: string): Promise<string> {
  const digest = await sha256Hex(value)
  return `${prefix}_${digest.slice(0, 24)}`
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`

  const record = value as Record<string, unknown>
  const pairs = Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
  return `{${pairs.join(',')}}`
}
