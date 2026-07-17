import type { CatalogSelection } from '../components/CatalogSearchSelect'

const RADIUS_KEY = 'finditviral:preferences:v1:radius'
const RECENT_STORES_KEY = 'finditviral:preferences:v1:recent-stores'
const RADIUS_OPTIONS = new Set(['10', '25', '50', '100', '250'])

function read(key: string): unknown {
  try { return JSON.parse(window.localStorage.getItem(key) ?? 'null') } catch { return null }
}

function write(key: string, value: unknown) {
  try { window.localStorage.setItem(key, JSON.stringify(value)) } catch { /* storage is optional */ }
}

export function getSavedRadius(): string {
  const value = read(RADIUS_KEY)
  return typeof value === 'string' && RADIUS_OPTIONS.has(value) ? value : '50'
}

export function saveRadius(radius: string) {
  if (RADIUS_OPTIONS.has(radius)) write(RADIUS_KEY, radius)
}

function isStore(value: unknown): value is CatalogSelection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.id === 'string' && typeof candidate.label === 'string' && typeof candidate.detail === 'string'
}

export function getRecentStores(): CatalogSelection[] {
  const value = read(RECENT_STORES_KEY)
  return Array.isArray(value) ? value.filter(isStore).slice(0, 3) : []
}

export function rememberStore(store: CatalogSelection) {
  write(RECENT_STORES_KEY, [store, ...getRecentStores().filter((item) => item.id !== store.id)].slice(0, 3))
}
