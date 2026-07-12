export type EarlyAccessConfig = {
  supabaseUrl: string
  publishableKey: string
}

export class EarlyAccessConfigurationError extends Error {
  constructor() {
    super('Early access is not configured.')
    this.name = 'EarlyAccessConfigurationError'
  }
}

export class EarlyAccessSubmissionError extends Error {
  constructor() {
    super('The early-access request could not be saved.')
    this.name = 'EarlyAccessSubmissionError'
  }
}

export function getEarlyAccessConfig(): EarlyAccessConfig {
  return {
    supabaseUrl: (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() ?? '',
    publishableKey: (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() ?? '',
  }
}

export async function submitEarlyAccess(
  email: string,
  reason: string,
  config = getEarlyAccessConfig(),
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 12_000,
): Promise<void> {
  if (!config.supabaseUrl || !config.publishableKey) {
    throw new EarlyAccessConfigurationError()
  }

  const controller = new AbortController()
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetchImpl(
      `${config.supabaseUrl.replace(/\/$/, '')}/rest/v1/rpc/request_early_access`,
      {
        method: 'POST',
        headers: {
          apikey: config.publishableKey,
          Authorization: `Bearer ${config.publishableKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ p_email: email, p_reason: reason }),
        signal: controller.signal,
      },
    )

    if (!response.ok) throw new EarlyAccessSubmissionError()
  } catch (error) {
    if (error instanceof EarlyAccessConfigurationError || error instanceof EarlyAccessSubmissionError) {
      throw error
    }
    throw new EarlyAccessSubmissionError()
  } finally {
    globalThis.clearTimeout(timeout)
  }
}
