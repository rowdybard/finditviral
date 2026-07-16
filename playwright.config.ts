import { defineConfig } from '@playwright/test'

const viewports = [320, 360, 390, 412, 768]

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  // Projects otherwise start together. On CI that races five fresh mobile
  // pages through the mock-auth bootstrap and makes the first test flaky.
  workers: process.env.CI ? 1 : undefined,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    browserName: 'chromium',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: viewports.map((width) => ({
    name: `chromium-${width}`,
    use: {
      viewport: { width, height: width <= 412 ? 844 : 1024 },
      isMobile: width <= 412,
      hasTouch: width <= 412,
    },
  })),
  webServer: {
    command: 'npm run dev -- --mode e2e --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
