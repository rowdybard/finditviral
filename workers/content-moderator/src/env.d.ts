// Wrangler deliberately excludes secret values from generated bindings. Declare
// their names here so runtime code stays typed without committing any values.
interface Env {
  SUPABASE_SECRET_KEY: string
  OPENAI_API_KEY: string
}

declare namespace Cloudflare {
  interface Env {
    SUPABASE_SECRET_KEY: string
    OPENAI_API_KEY: string
  }
}
