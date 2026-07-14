import { useSyncExternalStore } from 'react'

export type MascotPrefs = {
  muted: boolean
  hidden: boolean
  reduceMotion: boolean
}

const STORAGE_KEY = 'fiv-mascot-prefs'
const DEFAULTS: MascotPrefs = { muted: false, hidden: false, reduceMotion: false }

function load(): MascotPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<MascotPrefs>) }
  } catch {
    // ignore
  }
  return { ...DEFAULTS }
}

let cached: MascotPrefs = load()
const listeners = new Set<() => void>()

export function getMascotPrefs(): MascotPrefs {
  return cached
}

export function setMascotPrefs(patch: Partial<MascotPrefs>) {
  cached = { ...cached, ...patch }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cached))
  } catch {
    // ignore
  }
  listeners.forEach((cb) => cb())
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

export function useMascotPrefs(): MascotPrefs {
  return useSyncExternalStore(subscribe, getMascotPrefs)
}
