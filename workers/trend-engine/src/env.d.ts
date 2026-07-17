interface Env {
  ENGINE_ADMIN_TOKEN: string
  ENGINE_READ_TOKEN: string
  ENGINE_INGEST_TOKEN: string
  ENGINE_PUBLISHER_TOKEN: string
  OPENAI_API_KEY: string
}

declare namespace Cloudflare {
  interface Env {
    ENGINE_ADMIN_TOKEN: string
    ENGINE_READ_TOKEN: string
    ENGINE_INGEST_TOKEN: string
    ENGINE_PUBLISHER_TOKEN: string
    OPENAI_API_KEY: string
  }
}
