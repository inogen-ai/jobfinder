import { assert, assertEquals } from 'jsr:@std/assert@1'
import { handleFetchPosting, FETCH_HOURLY_LIMIT, type RunFetch } from './handler.ts'
import type { Store } from '../_shared/types.ts'

function store(over: Partial<Store> = {}) {
  const fetches: Array<[string, string, number]> = []
  const s: Store = {
    getUser: async () => ({ id: 'u1', email: 'mike@inogen.ai', provider: 'azure' }),
    getRole: async () => ({ title: 'T', org: 'O', location: '', remote: '', rate: '', ir35: '', duration: '', url: 'https://www.morganblack.nl/jobs/1', jobDescription: '' }),
    getProfile: async () => null,
    getDocumentBody: async () => null,
    insertDocument: async () => 'x',
    claimUsage: async (action, roleId, limit) => { fetches.push([action, roleId, limit]); return null },
    ...over,
  }
  return { s, fetches }
}
const post = (body: unknown) => new Request('https://fn/fetch-posting', { method: 'POST', headers: { Authorization: 'Bearer jwt' }, body: JSON.stringify(body) })
const runFetch = (r: Awaited<ReturnType<RunFetch>>): RunFetch => async () => r

Deno.test('returns fetched text, capped, claims a fetch slot and logs usage', async () => {
  const { s, fetches } = store()
  const entries: Record<string, unknown>[] = []
  const res = await handleFetchPosting(post({ roleId: 'r1' }), { store: () => s, runFetch: runFetch({ text: 'y'.repeat(30_100), usage: { input_tokens: 900, output_tokens: 400 } }), log: (e) => entries.push(e) })
  assertEquals(res.status, 200)
  assertEquals((await res.json()).text.length, 30_000)
  assertEquals(fetches, [['fetch', 'r1', FETCH_HOURLY_LIMIT]])
  assertEquals(entries.length, 1)
  assertEquals([entries[0].fn, entries[0].outcome, entries[0].input_tokens, entries[0].output_tokens], ['fetch-posting', 'ok', 900, 400])
  assert(!JSON.stringify(entries).includes('yyyy'))
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
  let called = false
  const { s } = store({ claimUsage: async () => '2026-10-07T13:30:00.000Z' })
  const res = await handleFetchPosting(post({ roleId: 'r1' }), { store: () => s, runFetch: async () => { called = true; return { text: 'x' } } })
  assertEquals(res.status, 429)
  assertEquals((await res.json()).retryAt, '2026-10-07T13:30:00.000Z')
  assertEquals(called, false)
})
Deno.test('401 for outsiders, 502 when the model call throws', async () => {
  const { s: outsider } = store({ getUser: async () => ({ id: 'e', email: 'eve@example.com', provider: 'azure' }) })
  assertEquals((await handleFetchPosting(post({ roleId: 'r1' }), { store: () => outsider, runFetch: runFetch({ text: 'x' }) })).status, 401)
  const { s } = store()
  const res = await handleFetchPosting(post({ roleId: 'r1' }), { store: () => s, runFetch: () => Promise.reject(new Error('down')) })
  assertEquals(res.status, 502)
})
Deno.test('store failures return 502 with CORS headers', async () => {
  const { s } = store({ getRole: async () => { throw new Error('db down') } })
  const res = await handleFetchPosting(new Request('https://fn/fetch-posting', { method: 'POST', headers: { Authorization: 'Bearer jwt', Origin: 'https://jobfinder.inogen.ai' }, body: JSON.stringify({ roleId: 'r1' }) }), { store: () => s, runFetch: runFetch({ text: 'x' }) })
  assertEquals(res.status, 502)
  assertEquals(res.headers.get('Access-Control-Allow-Origin'), 'https://jobfinder.inogen.ai')
})
