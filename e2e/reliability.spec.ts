import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('fiv-mascot-onboarding-done', '1')
    window.localStorage.setItem('fiv-mascot-prefs', JSON.stringify({ muted: true, hidden: true, reduceMotion: true }))
  })
})

async function signIn(page: Page, returnTo = '/home') {
  await page.goto(`/auth?returnTo=${encodeURIComponent(returnTo)}`)
  await page.getByLabel('Email address').fill('demo@finditviral.com')
  await page.getByLabel('Password', { exact: true }).fill('password123')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(returnTo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
}

test('public sighting response returns through authentication to the same card', async ({ page }) => {
  await page.goto('/products/needoh-nice-cube')
  const card = page.getByTestId('sighting-card').first()
  await expect(card.getByRole('button', { name: 'Verify' })).toBeVisible()
  const id = await card.getAttribute('id')
  await card.getByRole('button', { name: 'Verify' }).click()
  await expect(page).toHaveURL(new RegExp(`/auth\\?.*returnTo=.*${id}`))
})

test('authenticated navigation and community controls fit the viewport', async ({ page }) => {
  await signIn(page)
  await expect(page.getByRole('link', { name: 'Drafts', exact: true })).toHaveCount(0)
  await expect(page.getByTestId('sighting-card').first()).toBeVisible()

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)

  const controls = page.getByTestId('sighting-card').filter({ has: page.getByRole('button', { name: 'Verify' }) }).first()
  const verifyBox = await controls.getByRole('button', { name: 'Verify' }).boundingBox()
  const notFoundBox = await controls.getByRole('button', { name: 'Not found' }).boundingBox()
  expect(verifyBox?.height ?? 0).toBeGreaterThanOrEqual(44)
  expect(notFoundBox?.height ?? 0).toBeGreaterThanOrEqual(44)
})

test('primary authenticated surface has no serious accessibility violations', async ({ page }) => {
  await signIn(page)
  const results = await new AxeBuilder({ page }).disableRules(['color-contrast']).analyze()
  expect(results.violations.filter((violation) => violation.impact === 'critical' || violation.impact === 'serious')).toEqual([])
})

test('session and exact return path survive offline auth recovery in place', async ({ page }) => {
  const returnTo = '/leads/new?scope=region#lead-draft'
  await signIn(page, returnTo)
  await page.evaluate(() => window.localStorage.setItem('finditviral:e2e:auth-retryable', '1'))
  await page.reload()
  await expect(page).toHaveURL(new RegExp(`${returnTo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`))
  await expect(page.getByRole('heading', { name: 'Having trouble reconnecting' })).toBeVisible()
  await page.evaluate(() => {
    window.localStorage.removeItem('finditviral:e2e:auth-retryable')
    window.dispatchEvent(new Event('online'))
  })
  await expect(page.getByRole('heading', { name: 'Share a Restock Lead' })).toBeVisible()
})

test('pagehide flushes a local draft that appears in My Drafts', async ({ page }) => {
  await signIn(page, '/leads/new')
  await page.getByLabel('Headline *').fill('Expected restock after closing')
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')))
  await page.goto('/drafts')
  await expect(page.getByRole('heading', { name: 'My Drafts' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Expected restock after closing' })).toBeVisible()
})

test('account menu exposes profile, drafts, and mobile admin review', async ({ page }) => {
  await signIn(page)
  await page.reload()
  await page.getByRole('button', { name: 'DemoHunter' }).click()
  await expect(page.getByRole('menuitem', { name: 'Profile' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'My Drafts' })).toBeVisible()
  await page.getByRole('menuitem', { name: 'Admin' }).click()
  await expect(page.getByRole('heading', { name: 'Review queues' })).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
})

test('community response uses authoritative totals and disables optimism', async ({ page }) => {
  await signIn(page, '/sightings')
  const card = page.getByTestId('sighting-card').filter({ has: page.getByRole('button', { name: 'Verify' }) }).first()
  const verify = card.getByRole('button', { name: 'Verify' })
  await verify.click()
  await expect(verify).toHaveAttribute('aria-pressed', 'true')
  await expect(card.getByText(/1 verified/)).toBeVisible()
})

test('completed private photo paths restore without browser File objects', async ({ page }) => {
  await signIn(page, '/sightings/new')
  const now = Date.now()
  await page.addInitScript(({ now }) => {
    const submissionId = '11111111-1111-4111-8111-111111111111'
    const payload = {
      version: 1,
      submissionId,
      product: null,
      selectedStores: [],
      seenAt: new Date(now).toISOString().slice(0, 16),
      whenSeen: 'today',
      olderDate: '',
      availability: 'in_stock',
      quantity: '',
      notes: 'Recovered media',
      photoUrls: [`u1/drafts/${submissionId}/photo.jpg`],
      suggestion: null,
      suggestionValues: null,
      serverDraftId: null,
    }
    window.localStorage.setItem('finditviral:draft:v1:u1:sighting:new', JSON.stringify({
      version: 1,
      userId: 'u1',
      formType: 'sighting',
      entityId: 'new',
      createdAt: now,
      updatedAt: now,
      expiresAt: now + 90 * 24 * 60 * 60 * 1000,
      payload,
      metadata: {
        title: 'Recovered sighting',
        destination: '/sightings/new',
        submissionId,
        mediaPaths: payload.photoUrls,
      },
    }))
  }, { now })
  await page.reload()
  await expect(page.getByText('Uploaded photos were restored with this draft.')).toBeVisible()
  await expect(page.getByAltText('Photo 1')).toBeVisible()
})
