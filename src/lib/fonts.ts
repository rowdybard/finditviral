export type FontOption = {
  id: string
  label: string
  family: string
  load: () => Promise<unknown>
}

export const DEFAULT_FONT_ID = 'bricolage-grotesque'

const FALLBACK_STACK = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"

export const FONT_OPTIONS: FontOption[] = [
  {
    id: 'bricolage-grotesque',
    label: 'Bricolage Grotesque',
    family: `'Bricolage Grotesque Variable', ${FALLBACK_STACK}`,
    load: () => import('@fontsource-variable/bricolage-grotesque'),
  },
  {
    id: 'baloo-2',
    label: 'Baloo 2',
    family: `'Baloo 2 Variable', ${FALLBACK_STACK}`,
    load: () => import('@fontsource-variable/baloo-2'),
  },
  {
    id: 'fredoka',
    label: 'Fredoka',
    family: `'Fredoka Variable', ${FALLBACK_STACK}`,
    load: () => import('@fontsource-variable/fredoka'),
  },
  {
    id: 'nunito',
    label: 'Nunito',
    family: `'Nunito Variable', ${FALLBACK_STACK}`,
    load: () => import('@fontsource-variable/nunito'),
  },
  {
    id: 'quicksand',
    label: 'Quicksand',
    family: `'Quicksand Variable', ${FALLBACK_STACK}`,
    load: () => import('@fontsource-variable/quicksand'),
  },
  {
    id: 'gabarito',
    label: 'Gabarito',
    family: `'Gabarito Variable', ${FALLBACK_STACK}`,
    load: () => import('@fontsource-variable/gabarito'),
  },
  {
    id: 'space-grotesk',
    label: 'Space Grotesk',
    family: `'Space Grotesk Variable', ${FALLBACK_STACK}`,
    load: () => import('@fontsource-variable/space-grotesk'),
  },
  {
    id: 'sora',
    label: 'Sora',
    family: `'Sora Variable', ${FALLBACK_STACK}`,
    load: () => import('@fontsource-variable/sora'),
  },
  {
    id: 'manrope',
    label: 'Manrope',
    family: `'Manrope Variable', ${FALLBACK_STACK}`,
    load: () => import('@fontsource-variable/manrope'),
  },
  {
    id: 'inter',
    label: 'Inter',
    family: `'Inter Variable', ${FALLBACK_STACK}`,
    load: () => import('@fontsource-variable/inter'),
  },
]

const STORAGE_KEY = 'fiv:font'

export function getStoredFontId(): string {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored && FONT_OPTIONS.some((option) => option.id === stored)) return stored
  } catch {
    // Storage can be unavailable (private mode); fall back silently.
  }
  return DEFAULT_FONT_ID
}

export async function applyFont(fontId: string): Promise<void> {
  const option = FONT_OPTIONS.find((candidate) => candidate.id === fontId)
  if (!option) return

  try {
    await option.load()
  } catch {
    // A failed font chunk keeps the current font; no user-facing error needed.
    return
  }

  document.documentElement.style.setProperty('--font-sans', option.family)

  try {
    window.localStorage.setItem(STORAGE_KEY, option.id)
  } catch {
    // Persistence is best-effort.
  }
}

export function initStoredFont(): void {
  const storedId = getStoredFontId()
  if (storedId !== DEFAULT_FONT_ID) void applyFont(storedId)
}
