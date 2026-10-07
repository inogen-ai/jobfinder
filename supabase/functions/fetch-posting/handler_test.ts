import { assertEquals } from 'jsr:@std/assert@1'
import { handleFetchPosting, FETCH_HOURLY_LIMIT, type RunFetch } from './handler.ts'
import type { Store } from '../_shared/types.ts'

function store(over: Partial<Store> = {}) {
  const fetches: string[] = []
  const s: Store = {
    getUser: async () => ({ id: 'u1', email: 'mike@inogen.ai', provider: 'azure' }),
    getRole: async () => ({ title: 'T', org: 'O', location: '', remote: '', rate: '', ir35: '', duration: '', url: 'https://www.morganblack.nl/jobs/1', jobDescription: '' }),
    getProfile: async () => null,
    getDocumentBody: async () => null,
    countDocumentsSince: async () => ({ count: 0, oldest: null }),
    insertDocument: async () => 'x',
    countFetchesSince: async () => ({ count: 0, oldest: null }),
    insertFetch: async (id) => { fetches.push(id) },
    ...over,
  }
  return { s, fetches }
}
const post = (body: unknown) => new Request('https://fn/fetch-posting', { method: 'POST', headers: { Authorization: 'Bearer jwt' }, body: JSON.stringify(body) })
const runFetch = (r: Awaited<ReturnType<RunFetch>>): RunFetch => async () => r

Deno.test('returns fetched text, capped, and logs the fetch', async () => {
  const { s, fetches } = store()
  const res = await handleFetchPosting(post({ roleId: 'r1' }), { store: () => s, runFetch: runFetch({ text: 'y'.repeat(30_100) }) })
  assertEquals(res.status, 200)
  assertEquals((await res.json()).text.length, 30_000)
  assertEquals(fetches, ['r1'])
})
Deno.test('unavailable is a 200 with a code', async () => {
  const { s } = store()
  const res = await handleFetchPosting(post({ roleId: 'r1' }), { store: () => s, runFetch: runFetch({ unavailable: true }) })
  assertEquals(await res.json(), { code: 'unavailable' })
})
Deno.test('a role without an http(s) link is a 400', async () => {
  const { s } = store({ getRole: async () => ({ title: 'T', org: 'O', location: '', remote: '', rate: '', ir35: '', duration: '', url: 'javascript:alert(1)', jobDescription: '' }) })
  assertEquals((await handleFetchPosting(post({ roleId: 'r1' }), { store: () => s, runFetch: runFetch({ text: 'x' }) })).status, 400)
})
Deno.test('429 at the hourly fetch limit', async () => {
  const { s, fetches } = store({ countFetchesSince: async () => ({ count: FETCH_HOURLY_LIMIT, oldest: '2026-10-07T12:30:00.000Z' }) })
  const res = await handleFetchPosting(post({ roleId: 'r1' }), { store: () => s, runFetch: runFetch({ text: 'x' }), now: () => new Date('2026-10-07T13:00:00Z') })
  assertEquals(res.status, 429)
  assertEquals((await res.json()).retryAt, '2026-10-07T13:30:00.000Z')
  assertEquals(fetches, [])
})
Deno.test('401 for outsiders, 502 when the model call throws', async () => {
  const { s: outsider } = store({ getUser: async () => ({ id: 'e', email: 'eve@example.com', provider: 'azure' }) })
  assertEquals((await handleFetchPosting(post({ roleId: 'r1' }), { store: () => outsider, runFetch: runFetch({ text: 'x' }) })).status, 401)
  const { s } = store()
  const res = await handleFetchPosting(post({ roleId: 'r1' }), { store: () => s, runFetch: () => Promise.reject(new Error('down')) })
  assertEquals(res.status, 502)
})
