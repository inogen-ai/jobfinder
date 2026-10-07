import { test, expect, type Page } from '@playwright/test'

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
const exp = Math.floor(Date.now() / 1000) + 3600
const user = { id: 'u1', aud: 'authenticated', role: 'authenticated', email: 'michael.snow@inogen.ai', app_metadata: { provider: 'azure' }, user_metadata: {}, created_at: '2026-10-01T00:00:00Z' }
const session = {
  access_token: `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'u1', email: user.email, role: 'authenticated', exp })}.sig`,
  refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: exp, user,
}
const row = (i: number) => ({
  id: `r${i}`, title: `Senior AI Engineer number ${i}`, org: 'Interex Professionals', market: 'NL', location: 'Den Haag', remote: 'Hybrid',
  rate: '€100/h', ir35: 'Contract', duration: '', posted: '2026-09-18', deadline: i === 0 ? '2026-10-18' : null, next_date: null,
  fit: 'Strong', status: 'Shortlist', why: 'RAG, agents and GCP.', caveat: 'Confirm on-site days.', url: 'https://example.com/job',
  contact: '', next_step: '', notes: '', cv: 'A', job_description: '', created_at: '2026-10-06T10:00:00Z',
  updated_at: '2026-10-06T10:00:00Z', created_by: 'claude-script', updated_by: 'claude-script',
})

async function signedIn(page: Page) {
  await page.addInitScript((s) => localStorage.setItem('sb-e2etest-auth-token', s), JSON.stringify(session))
  await page.route('https://e2etest.supabase.co/rest/v1/roles**', (r) => r.fulfill({ json: Array.from({ length: 12 }, (_, i) => row(i)) }))
  await page.route('https://e2etest.supabase.co/rest/v1/profiles**', (r) => r.fulfill({ json: null }))
  await page.route('https://e2etest.supabase.co/rest/v1/documents**', (r) => r.fulfill({ json: [{
    id: 'd1', user_id: 'u1', role_id: 'r0', kind: 'cover_letter', title: 'Cover letter · 7 Oct, 15:10', body: '# Dear team\n\nHello.',
    questions: '', instruction: '', model: 'claude-opus-5-5', input_tokens: 1, output_tokens: 1,
    created_at: '2026-10-07T13:10:00Z', updated_at: '2026-10-07T13:10:00Z', deleted_at: null,
  }] }))
  await page.route('https://e2etest.supabase.co/rest/v1/rpc/**', (r) => r.fulfill({ json: [] }))
  await page.route('https://e2etest.supabase.co/auth/v1/**', (r) => r.fulfill({ json: user }))
  await page.goto('/')
  await expect(page.locator('.role-t').first()).toBeVisible()
}

/** Visible controls a finger has to hit, with their size and font size. */
async function controls(page: Page) {
  return page.evaluate(() => [...document.querySelectorAll('button, select, input, textarea')]
    .filter((el) => {
      const r = el.getBoundingClientRect(); const s = getComputedStyle(el)
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && !el.classList.contains('linkish') && !el.closest('.sr-only')
    })
    .map((el) => ({
      name: (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || el.tagName).trim().slice(0, 30),
      tag: el.tagName, h: el.getBoundingClientRect().height, font: parseFloat(getComputedStyle(el).fontSize),
    })))
}

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('roles start on the first screen, chip rows stay one line, nothing scrolls sideways', async ({ page }) => {
    await signedIn(page)
    const firstRow = await page.locator('.row').first().boundingBox()
    expect(firstRow!.y).toBeLessThan(844 - 80)
    expect((await page.locator('.stages').boundingBox())!.height).toBeLessThan(80)
    expect((await page.locator('#mkSeg, .seg').first().boundingBox())!.height).toBeLessThan(60)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    for (const name of ['My profile', 'Sign out']) {
      expect((await page.getByRole('button', { name, exact: true }).boundingBox())!.height).toBeLessThan(52) // one line
    }
  })

  test('every control is finger-sized and inputs never trigger iPhone zoom', async ({ page }) => {
    await signedIn(page)
    await page.locator('.role-t').first().click()
    await expect(page.getByLabel('Notes')).toBeVisible()
    const all = await controls(page)
    expect(all.filter((c) => c.h < 44).map((c) => `${c.name} ${Math.round(c.h)}px`)).toEqual([])
    expect(all.filter((c) => c.tag !== 'BUTTON' && c.font < 16).map((c) => `${c.name} ${c.font}px`)).toEqual([])
  })

  test('the draft editor and the profile page are finger-sized too', async ({ page }) => {
    await signedIn(page)
    await page.locator('.role-t').first().click()
    await expect(page.getByLabel('Draft')).toBeVisible()
    expect((await page.getByLabel('Draft').boundingBox())!.height).toBeGreaterThan(200) // text areas keep their size
    const editor = await controls(page)
    expect(editor.filter((c) => c.h < 44).map((c) => `${c.name} ${Math.round(c.h)}px`)).toEqual([])
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.getByRole('button', { name: 'My profile', exact: true }).click()
    await expect(page.getByLabel('CV')).toBeVisible()
    const profile = await controls(page)
    expect(profile.filter((c) => c.h < 44).map((c) => `${c.name} ${Math.round(c.h)}px`)).toEqual([])
    expect(profile.filter((c) => c.tag !== 'BUTTON' && c.font < 16).map((c) => `${c.name} ${c.font}px`)).toEqual([])
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  })

  test('Add role is always reachable and its dialog shows Add and Cancel without scrolling', async ({ page }) => {
    await signedIn(page)
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2))
    const fab = page.getByRole('button', { name: 'Add role' })
    await expect(fab).toBeInViewport()
    await fab.click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('button', { name: 'Add role' })).toBeInViewport()
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeInViewport()
    await expect(dialog.getByRole('heading', { name: 'Add a role' })).toBeInViewport()
    await expect(page.locator('.fab')).toHaveCount(0) // the floating button never covers the dialog's own buttons
  })

  test('an open role keeps its title and status pinned while scrolling, and closes from there', async ({ page }) => {
    await signedIn(page)
    await page.locator('.role-t').first().click()
    await expect(page.getByLabel('Notes')).toBeVisible()
    await page.mouse.wheel(0, 900)
    await page.evaluate(() => window.scrollBy(0, 900))
    const head = page.locator('.row.open .row-head')
    await expect(head).toBeInViewport()
    expect((await head.boundingBox())!.y).toBeLessThan(10)
    expect((await head.boundingBox())!.height).toBeLessThan(150) // pinned header stays compact
    await head.locator('.role-t').click()
    await expect(page.getByLabel('Notes')).toHaveCount(0)
  })
})

test.describe('on a desktop', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('keeps the full header, stage tiles and toolbar button', async ({ page }) => {
    await signedIn(page)
    await expect(page.locator('header.top .sub')).toBeVisible()
    await expect(page.locator('.toolbar').getByRole('button', { name: 'Add role' })).toBeVisible()
    expect((await page.locator('.stages').boundingBox())!.height).toBeGreaterThan(60)
  })
})
