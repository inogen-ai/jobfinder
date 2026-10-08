import { assert, assertEquals } from 'jsr:@std/assert@1'
import { handleIngest, type AdminStore, type RoleRecord } from './handler.ts'

const base: RoleRecord = {
  id: 'nl-acme-ai-engineer', title: 'AI Engineer', org: 'Acme', market: 'NL', url: 'https://www.acme.nl/jobs/1/',
  status: 'Shortlist', deadline: null, notes: '', next_step: '',
}

function fakeStore(roles: RoleRecord[]) {
  const inserted: Record<string, unknown>[] = []
  const closed: Array<{ id: string; notes: string }> = []
  const store: AdminStore = {
    listRoles: async () => roles,
    insertRoles: async (rows) => { inserted.push(...rows) },
    closeRole: async (id, notes) => { closed.push({ id, notes }) },
  }
  return { store, inserted, closed }
}

const req = (body: unknown, token = 'secret-token') =>
  new Request('https://fn/ingest-roles', { method: 'POST', headers: { 'x-ingest-token': token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const deps = (store: AdminStore) => ({ store, token: 'secret-token', today: () => '2026-10-09' })

Deno.test('rejects a missing or wrong ingest token, and refuses to run unconfigured', async () => {
  const { store } = fakeStore([])
  assertEquals((await handleIngest(req({ action: 'list' }, 'nope'), deps(store))).status, 401)
  assertEquals((await handleIngest(new Request('https://fn', { method: 'POST', body: '{}' }), deps(store))).status, 401)
  assertEquals((await handleIngest(req({ action: 'list' }), { store, token: '', today: () => 'x' })).status, 500)
})

Deno.test('list returns titles and links only, and marks roles the user has worked on', async () => {
  const { store } = fakeStore([base, { ...base, id: 'b', notes: 'called them' }, { ...base, id: 'c', status: 'Applied' }])
  const body = await (await handleIngest(req({ action: 'list' }), deps(store))).json()
  assertEquals(body.roles.map((r: { id: string; touched: boolean }) => [r.id, r.touched]), [['nl-acme-ai-engineer', false], ['b', true], ['c', true]])
  assert(!('notes' in body.roles[0]) && !('contact' in body.roles[0]))
})

Deno.test('add validates, skips duplicates of existing roles and of each other, and makes unique ids', async () => {
  const { store, inserted } = fakeStore([base])
  const body = await (await handleIngest(req({ action: 'add', roles: [
    { title: 'AI Engineer', org: 'Acme', market: 'NL', fit: 'Good', url: 'https://acme.nl/jobs/1' },          // same url as existing
    { title: 'ML Engineer', org: 'Beta', market: 'UK', fit: 'Strong', url: 'https://beta.co.uk/ml', rate: '£600/day', posted: '2026-10-08' },
    { title: 'ML Engineer', org: 'Beta', market: 'UK', fit: 'Strong', url: 'https://other-board.com/beta-ml' }, // same org+title
    { title: 'Bad', org: 'X', market: 'Mars', fit: 'Good', url: 'https://x' },                                // bad market
    { title: 'No link', org: 'Y', market: 'EU', fit: 'Good', url: 'javascript:alert(1)' },                   // bad url
    { title: 'AI Engineer', org: 'Acme NL', market: 'NL', fit: 'Good', url: 'https://acme2.nl/x', posted: 'last week' },
  ] }), deps(store))).json()
  assertEquals(body.added, ['uk-beta-ml-engineer', 'nl-acme-nl-ai-engineer'])
  assertEquals(body.skipped.map((s: { index: number }) => s.index), [0, 2, 3, 4])
  assertEquals(inserted[0], {
    id: 'uk-beta-ml-engineer', title: 'ML Engineer', org: 'Beta', market: 'UK', fit: 'Strong', url: 'https://beta.co.uk/ml',
    location: '', remote: '', rate: '£600/day', ir35: '', duration: '', posted: '2026-10-08', deadline: null,
    why: '', caveat: '', contact: '', status: 'Shortlist',
  })
  assertEquals(inserted[1].posted, null) // non-ISO dates are dropped, not guessed
})

Deno.test('add refuses oversized batches', async () => {
  const { store } = fakeStore([])
  const roles = Array.from({ length: 51 }, (_, i) => ({ title: `T${i}`, org: 'O', market: 'EU', fit: 'Good', url: `https://o.eu/${i}` }))
  assertEquals((await handleIngest(req({ action: 'add', roles }), deps(store))).status, 400)
})

Deno.test('close only touches untouched Shortlist roles and records why', async () => {
  const { store, closed } = fakeStore([base, { ...base, id: 'worked', next_step: 'Call recruiter' }, { ...base, id: 'applied', status: 'Applied' }])
  const body = await (await handleIngest(req({ action: 'close', items: [
    { id: 'nl-acme-ai-engineer', reason: 'Posting returns 404' }, { id: 'worked', reason: 'gone' }, { id: 'applied', reason: 'gone' }, { id: 'missing', reason: 'gone' },
  ] }), deps(store))).json()
  assertEquals(body.closed, ['nl-acme-ai-engineer'])
  assertEquals(body.refused.map((r: { id: string }) => r.id), ['worked', 'applied', 'missing'])
  assertEquals(closed, [{ id: 'nl-acme-ai-engineer', notes: 'Auto-closed 2026-10-09: Posting returns 404' }])
})

Deno.test('unknown actions and non-POST are rejected', async () => {
  const { store } = fakeStore([])
  assertEquals((await handleIngest(req({ action: 'delete' }), deps(store))).status, 400)
  assertEquals((await handleIngest(new Request('https://fn', { method: 'GET', headers: { 'x-ingest-token': 'secret-token' } }), deps(store))).status, 405)
})
