import { EngineError } from './errors'

export type EngineRole = 'read' | 'admin' | 'ingest' | 'publisher'

function bearerToken(request: Request): string | null {
  const value = request.headers.get('Authorization')
  if (!value?.startsWith('Bearer ')) return null
  const token = value.slice('Bearer '.length).trim()
  return token || null
}

async function secureEquals(left: string, right: string): Promise<boolean> {
  const encoder = new TextEncoder()
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(left)),
    crypto.subtle.digest('SHA-256', encoder.encode(right)),
  ])
  return crypto.subtle.timingSafeEqual(leftHash, rightHash)
}

function requireSecret(value: string | undefined, name: string): string {
  if (!value || value.length < 24) {
    throw new EngineError('ENGINE_CONFIGURATION_INVALID', `${name} is missing or too short`, 500)
  }
  return value
}

export async function authorize(request: Request, env: Env, required: EngineRole): Promise<void> {
  const provided = bearerToken(request)
  if (!provided) throw new EngineError('UNAUTHORIZED', 'A bearer token is required.', 401)

  const admin = requireSecret(env.ENGINE_ADMIN_TOKEN, 'ENGINE_ADMIN_TOKEN')
  const read = requireSecret(env.ENGINE_READ_TOKEN, 'ENGINE_READ_TOKEN')
  const ingest = requireSecret(env.ENGINE_INGEST_TOKEN, 'ENGINE_INGEST_TOKEN')
  const publisher = requireSecret(env.ENGINE_PUBLISHER_TOKEN, 'ENGINE_PUBLISHER_TOKEN')
  if (new Set([admin, read, ingest, publisher]).size !== 4) {
    throw new EngineError('ENGINE_CONFIGURATION_INVALID', 'Engine role tokens must be distinct.', 500)
  }
  const [isAdmin, isRead, isIngest, isPublisher] = await Promise.all([
    secureEquals(provided, admin),
    secureEquals(provided, read),
    secureEquals(provided, ingest),
    secureEquals(provided, publisher),
  ])

  const allowed = isAdmin
    || (required === 'read' && (isRead || isPublisher))
    || (required === 'ingest' && isIngest)
    || (required === 'publisher' && isPublisher)
  if (!allowed) throw new EngineError('FORBIDDEN', 'The bearer token does not have the required role.', 403)
}
