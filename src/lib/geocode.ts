export type GeoResult = {
  lat: number
  lon: number
  displayName: string
}

const DEFAULT_GEO: GeoResult = {
  lat: 42.73,
  lon: -84.55,
  displayName: 'Lansing, MI',
}

export async function geocode(query: string): Promise<GeoResult | null> {
  const q = query.trim()
  if (q.length < 3) return null

  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1&countrycodes=us`
    const res = await fetch(url, {
      headers: { 'Accept-Language': 'en' },
    })
    if (!res.ok) return null
    const data = (await res.json()) as Array<{ lat: string; lon: string; display_name: string }>
    if (!data || data.length === 0) return null
    const hit = data[0]
    return {
      lat: Number(hit.lat),
      lon: Number(hit.lon),
      displayName: hit.display_name,
    }
  } catch {
    return null
  }
}

export function buildOsmEmbedUrl(geo: GeoResult, delta = 0.1): string {
  const { lat, lon } = geo
  const bbox = `${lon - delta},${lat - delta},${lon + delta},${lat + delta}`
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lon}`
}

export const DEFAULT_GEO_FALLBACK = DEFAULT_GEO
