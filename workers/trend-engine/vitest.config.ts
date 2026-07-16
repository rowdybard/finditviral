import { fileURLToPath } from 'node:url'
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

const root = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig(async () => {
  const migrations = await readD1Migrations(fileURLToPath(new URL('./migrations', import.meta.url)))
  return {
    root,
    plugins: [
      cloudflareTest({
        wrangler: { configPath: fileURLToPath(new URL('./wrangler.jsonc', import.meta.url)) },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            ENGINE_ADMIN_TOKEN: 'test-admin-token-at-least-24-characters',
            ENGINE_READ_TOKEN: 'test-read-token-at-least-24-characters',
            ENGINE_INGEST_TOKEN: 'test-ingest-token-at-least-24-characters',
            ENGINE_PUBLISHER_TOKEN: 'test-publisher-token-at-least-24-characters',
            ENVIRONMENT: 'test',
            AUTOPILOT_MODE: 'review',
            SOURCE_HOST_ALLOWLIST: 'feeds.example.com',
          },
          queueConsumers: {
            'finditviral-trend-source-polls': { maxBatchSize: 1, maxBatchTimeout: 0.05 },
          },
        },
      }),
    ],
    test: {
      setupFiles: [fileURLToPath(new URL('./test/apply-migrations.ts', import.meta.url))],
    },
  }
})
