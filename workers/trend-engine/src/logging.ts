import { ENGINE_SERVICE } from './domain'
import { errorCode, errorMessage } from './errors'

type LogValue = string | number | boolean | null
type LogLevel = 'info' | 'warn' | 'error'

export function logEvent(
  level: LogLevel,
  event: string,
  details: Record<string, LogValue> = {},
): void {
  const entry = JSON.stringify({ service: ENGINE_SERVICE, event, ...details })
  if (level === 'error') console.error(entry)
  else if (level === 'warn') console.warn(entry)
  else console.log(entry)
}

export function logError(event: string, error: unknown, details: Record<string, LogValue> = {}): void {
  logEvent('error', event, {
    ...details,
    error_code: errorCode(error),
    error: errorMessage(error).slice(0, 300),
  })
}
