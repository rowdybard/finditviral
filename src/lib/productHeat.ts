export type ProductHeat = {
  heatPercent: number
  totalClicks: number
  productCount: number
  hasSignal: boolean
}

type ProductHeatRow = {
  product_id?: unknown
  heat_percent?: unknown
  total_clicks?: unknown
  product_count?: unknown
  has_signal?: unknown
}

function toNonNegativeInteger(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0
}

export function mapProductHeat(rows: unknown): Record<string, ProductHeat> {
  if (!Array.isArray(rows)) return {}

  return rows.reduce<Record<string, ProductHeat>>((heatByProduct, rawRow) => {
    if (!rawRow || typeof rawRow !== 'object') return heatByProduct

    const row = rawRow as ProductHeatRow
    if (typeof row.product_id !== 'string' || !row.product_id) return heatByProduct

    heatByProduct[row.product_id] = {
      heatPercent: Math.min(100, toNonNegativeInteger(row.heat_percent)),
      totalClicks: toNonNegativeInteger(row.total_clicks),
      productCount: toNonNegativeInteger(row.product_count),
      hasSignal: row.has_signal === true,
    }
    return heatByProduct
  }, {})
}

export async function trackProductOpen(
  productId: string,
  fetchImpl: typeof fetch = fetch,
) {
  try {
    await fetchImpl('/api/product-click', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      keepalive: true,
      body: JSON.stringify({ productId }),
    })
  } catch {
    // Interest tracking must never interrupt product navigation.
  }
}
