import type { ViralSignalV1 } from '../src/domain'

export function makeSignal(input: {
  source: string
  observationId?: string
  runId?: string
  value?: number
  velocity?: number
  type?: ViralSignalV1['signal']['type']
  now?: Date
}): ViralSignalV1 {
  const now = input.now ?? new Date()
  return {
    schema_version: 1,
    kind: 'viral_signal',
    source: input.source,
    external_observation_id: input.observationId ?? `${input.source}-observation-1`,
    source_run_id: input.runId ?? `${input.source}-run-1`,
    observed_at: new Date(now.getTime() - 5 * 60 * 1000).toISOString(),
    expires_at: new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString(),
    candidate: {
      external_id: `${input.source}-product-1`,
      name: 'Galaxy Glow Mini Printer',
      brand: 'Nova Toys',
      category: 'Tech toys',
      topic: {
        name: 'Pocket Creativity',
        slug: 'pocket-creativity',
        description: 'Small creative gadgets accelerating across search and social sources.',
      },
      product_url: 'https://products.example.com/galaxy-glow-mini-printer',
      search_terms: ['mini printer', 'viral pocket printer'],
      availability_status: 'available',
    },
    signal: {
      type: input.type ?? 'social_velocity',
      value: input.value ?? 92,
      velocity: input.velocity ?? 0.5,
      sample_size: 5000,
    },
    confidence: 0.95,
    evidence_url: `https://evidence.example.com/${input.source}/galaxy-glow-mini-printer`,
  }
}
