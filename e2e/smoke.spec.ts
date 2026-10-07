import { test, expect } from '@playwright/test'

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
const exp = Math.floor(Date.now() / 1000) + 3600
const user = { id: 'u1', aud: 'authenticated', role: 'authenticated', email: 'michael.snow@inogen.ai', app_metadata: {}, user_metadata: {}, created_at: '2026-10-01T00:00:00Z' }
const session = {
  access_token: `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'u1', email: user.email, role: 'authenticated', exp })}.sig`,
  refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: exp, user,
}
const row = {
  id: 'nl-x', title: 'AI Engineer', org: 'Interex', market: 'NL', location: 'Den Haag', remote: '', rate: '', ir35: '',
  duration: '', posted: '2026-09-18', deadline: null, next_date: null, fit: 'Strong', status: 'Shortlist', why: '',
  caveat: '', url: '', contact: '', next_step: '', notes: '', cv: 'A', job_description: '', created_at: '2026-10-06T10:00:00Z',
  updated_at: '2026-10-06T10:00:00Z', created_by: 'claude-script', updated_by: 'claude-script',
}

test('signed-out visitors see only the sign-in screen', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Sign in with Microsoft' })).toBeVisible()
  await expect(page.getByText('AI Engineer')).toHaveCount(0)
})

test('a signed-in inogen.ai user sees the pipeline', async ({ page }) => {
  await page.addInitScript((s) => localStorage.setItem('sb-e2etest-auth-token', s), JSON.stringify(session))
  await page.route('https://e2etest.supabase.co/rest/v1/roles**', (r) => r.fulfill({ json: [row] }))
  await page.route('https://e2etest.supabase.co/auth/v1/**', (r) => r.fulfill({ json: user }))
  await page.goto('/')
  await expect(page.getByText('AI Engineer')).toBeVisible()
  await expect(page.getByLabel('Status for AI Engineer')).toHaveValue('Shortlist')
})
