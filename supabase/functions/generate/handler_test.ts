import { assert, assertEquals } from 'jsr:@std/assert@1'
import { handleGenerate, HOURLY_LIMIT, type ModelEvent, type ModelResult, type RunModel } from './handler.ts'
import type { NewDocumentRow, Store } from '../_shared/types.ts'
import type { BuiltPrompt } from '../_shared/prompt.ts'

function fakeStore(over: Partial<Store> = {}) {
  const inserted: NewDocumentRow[] = []
  const claims: Array<[string, string, number]> = []
  const store: Store = {
    getUser: async () => ({ id: 'u1', email: 'mike@inogen.ai', provider: 'azure' }),
    getRole: async () => ({ title: 'AI Engineer', org: 'Interex', location: '', remote: '', rate: '', ir35: '', duration: '', url: 'https://x', jobDescription: 'Build RAG' }),
    getProfile: async () => ({ headline: '', cvText: 'My CV', rate: '', availableFrom: null, location: '', preferences: '', alwaysMention: '', neverMention: '' }),
    getDocumentBody: async () => 'old draft',
    insertDocument: async (d) => { inserted.push(d); return 'doc-1' },
    claimUsage: async (action, roleId, limit) => { claims.push([action, roleId, limit]); return null },
    ...over,
  }
  return { store, inserted, claims }
}

function scripted(events: ModelEvent[], result: Partial<ModelResult> = {}): { run: RunModel; prompts: BuiltPrompt[] } {
  const prompts: BuiltPrompt[] = []
  const run: RunModel = (prompt) => {
    prompts.push(prompt)
    return {
      events: (async function* () { for (const e of events) yield e })(),
      final: async () => ({ stopReason: 'end_turn', text: 'Dear team', model: 'claude-opus-5-5', usage: { input_tokens: 100, output_tokens: 50 }, ...result }),
    }
  }
  return { run, prompts }
}

const post = (body: unknown, auth = 'Bearer jwt') =>
  new Request('https://fn/generate', { method: 'POST', headers: { Authorization: auth, Origin: 'https://jobfinder.inogen.ai', 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

function events(text: string) {
  return text.trim().split('\n\n').filter((block) => !block.startsWith(':')).map((block) => {
    const [ev, data] = block.split('\n')
    return { event: ev.replace('event: ', ''), data: JSON.parse(data.replace('data: ', '')) }
  })
}

const ok = { roleId: 'r1', kind: 'cover_letter' }
const quiet = { log: () => {} }

Deno.test('401 for a non-Microsoft or non-InoGen caller', async () => {
  const { store } = fakeStore({ getUser: async () => ({ id: 'u', email: 'a@inogen.ai', provider: 'email' }) })
  const res = await handleGenerate(post(ok), { store: () => store, runModel: scripted([]).run, ...quiet })
  assertEquals(res.status, 401)
})
Deno.test('400 for a bad kind, missing questions, or an over-long instruction', async () => {
  const { store } = fakeStore()
  const deps = { store: () => store, runModel: scripted([]).run, ...quiet }
  assertEquals((await handleGenerate(post({ roleId: 'r1', kind: 'poem' }), deps)).status, 400)
  assertEquals((await handleGenerate(post({ roleId: 'r1', kind: 'answers' }), deps)).status, 400)
  assertEquals((await handleGenerate(post({ ...ok, instruction: 'x'.repeat(1001) }), deps)).status, 400)
})
Deno.test('409 when the profile has no CV', async () => {
  const { store } = fakeStore({ getProfile: async () => null })
  const res = await handleGenerate(post(ok), { store: () => store, runModel: scripted([]).run, ...quiet })
  assertEquals(res.status, 409)
  assertEquals((await res.json()).code, 'profile_missing')
})
Deno.test('429 at the hourly limit, with retryAt, and the model is never called', async () => {
  const { store } = fakeStore({ claimUsage: async () => '2026-10-07T13:10:00.000Z' })
  const { run, prompts } = scripted([])
  const res = await handleGenerate(post(ok), { store: () => store, runModel: run, ...quiet })
  assertEquals(res.status, 429)
  assertEquals(await res.json(), { code: 'rate_limited', retryAt: '2026-10-07T13:10:00.000Z' })
  assertEquals(prompts.length, 0)
})
Deno.test('claims a generate slot before calling the model, even when the run is refused', async () => {
  const { store, claims } = fakeStore()
  const { run } = scripted([], { stopReason: 'refusal', text: '' })
  await (await handleGenerate(post(ok), { store: () => store, runModel: run, ...quiet })).text()
  assertEquals(claims, [['generate', 'r1', HOURLY_LIMIT]])
})
Deno.test('a request abort aborts the model and saves nothing', async () => {
  const { store, inserted } = fakeStore()
  let aborted = false
  let finished!: () => void
  const logged = new Promise<void>((r) => { finished = r })
  const run: RunModel = (_p, signal) => ({
    events: (async function* () {
      yield { type: 'text', text: 'partial' } as ModelEvent
      await new Promise((_, reject) => signal.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')) }))
    })(),
    final: async () => ({ stopReason: 'end_turn', text: 'x', model: 'm', usage: { input_tokens: 0, output_tokens: 0 } }),
  })
  const ctrl = new AbortController()
  const req = new Request('https://fn/generate', { method: 'POST', headers: { Authorization: 'Bearer jwt' }, body: JSON.stringify(ok), signal: ctrl.signal })
  const res = await handleGenerate(req, { store: () => store, runModel: run, log: () => finished() })
  await res.body!.getReader().read()
  ctrl.abort()
  await logged
  assert(aborted)
  assertEquals(inserted.length, 0)
})
Deno.test('an abort that lands after the model finished still saves nothing', async () => {
  const { store, inserted } = fakeStore()
  let release!: () => void
  const gate = new Promise<void>((r) => { release = r })
  let finished!: () => void
  const logged = new Promise<void>((r) => { finished = r })
  const run: RunModel = () => ({
    events: (async function* () { yield { type: 'text', text: 'all' } as ModelEvent })(),
    final: async () => { await gate; return { stopReason: 'end_turn', text: 'all', model: 'm', usage: { input_tokens: 1, output_tokens: 1 } } },
  })
  const res = await handleGenerate(post(ok), { store: () => store, runModel: run, log: () => finished() })
  const reader = res.body!.getReader()
  await reader.read()
  await reader.cancel()
  release()
  await logged
  assertEquals(inserted.length, 0)
})
Deno.test('sends keep-alive comments while the model is silent', async () => {
  const { store } = fakeStore()
  const run: RunModel = () => ({
    events: (async function* () { await new Promise((r) => setTimeout(r, 40)); yield { type: 'text', text: 'Hi' } as ModelEvent })(),
    final: async () => ({ stopReason: 'end_turn', text: 'Hi', model: 'm', usage: { input_tokens: 1, output_tokens: 1 } }),
  })
  const body = await (await handleGenerate(post(ok), { store: () => store, runModel: run, pingMs: 5, ...quiet })).text()
  assert(body.includes(': ping\n\n'))
})
Deno.test('logs the upstream error type and status, never its message', async () => {
  const { store } = fakeStore()
  const entries: Record<string, unknown>[] = []
  const run: RunModel = () => ({
    // oxlint-disable-next-line require-yield -- throws before its first value, by design
    events: (async function* () { throw Object.assign(new Error('secret prompt text'), { name: 'OverloadedError', status: 529 }) })(),
    final: () => Promise.reject(new Error('unused')),
  })
  await (await handleGenerate(post(ok), { store: () => store, runModel: run, log: (e) => entries.push(e) })).text()
  assertEquals(entries[0].outcome, 'upstream')
  assertEquals(entries[0].errorType, 'OverloadedError')
  assertEquals(entries[0].errorStatus, 529)
  assert(!JSON.stringify(entries).includes('secret prompt text'))
})
Deno.test('streams deltas, saves one document with token counts, and reports done', async () => {
  const { store, inserted } = fakeStore()
  const { run, prompts } = scripted([{ type: 'text', text: 'Dear ' }, { type: 'text', text: 'team' }])
  const res = await handleGenerate(post({ ...ok, instruction: 'shorter', previousDocumentId: 'd0' }),
    { store: () => store, runModel: run, now: () => new Date('2026-10-07T12:02:00Z'), ...quiet })
  assertEquals(res.headers.get('Content-Type'), 'text/event-stream')
  const ev = events(await res.text())
  assertEquals(ev.map((e) => e.event), ['delta', 'delta', 'done'])
  assertEquals(ev[2].data, { documentId: 'doc-1', model: 'claude-opus-5-5', usage: { input_tokens: 100, output_tokens: 50 }, truncated: false, jdTruncated: false })
  assertEquals(inserted.length, 1)
  assertEquals(inserted[0].body, 'Dear team')
  assertEquals(inserted[0].title, 'Cover letter · 7 Oct, 14:02')
  assertEquals([inserted[0].inputTokens, inserted[0].outputTokens], [100, 50])
  assert(prompts[0].userMessage.includes('<previous_draft>\nold draft'))
  assert(prompts[0].userMessage.includes('<instruction>\nshorter'))
})
Deno.test('forwards reset and saves only the final text', async () => {
  const { store, inserted } = fakeStore()
  const { run } = scripted([{ type: 'text', text: 'declined…' }, { type: 'reset' }, { type: 'text', text: 'Final' }], { text: 'Final', model: 'claude-opus-4-8' })
  const ev = events(await (await handleGenerate(post(ok), { store: () => store, runModel: run, ...quiet })).text())
  assertEquals(ev.map((e) => e.event), ['delta', 'reset', 'delta', 'done'])
  assertEquals(inserted[0].body, 'Final')
  assertEquals(inserted[0].model, 'claude-opus-4-8')
})
Deno.test('a refusal saves nothing and reports refused', async () => {
  const { store, inserted } = fakeStore()
  const { run } = scripted([], { stopReason: 'refusal', text: '' })
  const ev = events(await (await handleGenerate(post(ok), { store: () => store, runModel: run, ...quiet })).text())
  assertEquals(ev.at(-1), { event: 'error', data: { code: 'refused' } })
  assertEquals(inserted.length, 0)
})
Deno.test('max_tokens saves the draft and flags it truncated', async () => {
  const { store, inserted } = fakeStore()
  const { run } = scripted([{ type: 'text', text: 'Long' }], { stopReason: 'max_tokens', text: 'Long' })
  const ev = events(await (await handleGenerate(post(ok), { store: () => store, runModel: run, ...quiet })).text())
  assertEquals(ev.at(-1)?.data.truncated, true)
  assertEquals(inserted.length, 1)
})
Deno.test('an upstream exception saves nothing and reports upstream', async () => {
  const { store, inserted } = fakeStore()
  const run: RunModel = () => ({ events: (async function* () { yield { type: 'text', text: 'a' } as ModelEvent; throw new Error('boom') })(), final: () => Promise.reject(new Error('boom')) })
  const ev = events(await (await handleGenerate(post(ok), { store: () => store, runModel: run, ...quiet })).text())
  assertEquals(ev.at(-1), { event: 'error', data: { code: 'upstream' } })
  assertEquals(inserted.length, 0)
})
Deno.test('client disconnect aborts the model and saves nothing', async () => {
  const { store, inserted } = fakeStore()
  let aborted = false
  let finished!: () => void
  const logged = new Promise<void>((r) => { finished = r })
  const run: RunModel = (_p, signal) => ({
    events: (async function* () {
      yield { type: 'text', text: 'partial' } as ModelEvent
      await new Promise((_, reject) => signal.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')) }))
    })(),
    final: async () => ({ stopReason: 'end_turn', text: 'x', model: 'm', usage: { input_tokens: 0, output_tokens: 0 } }),
  })
  const res = await handleGenerate(post(ok), { store: () => store, runModel: run, log: () => finished() })
  const reader = res.body!.getReader()
  await reader.read()
  await reader.cancel()
  await logged
  assert(aborted)
  assertEquals(inserted.length, 0)
})
Deno.test('OPTIONS answers CORS preflight', async () => {
  const res = await handleGenerate(new Request('https://fn/generate', { method: 'OPTIONS', headers: { Origin: 'http://localhost:5173' } }), { store: () => fakeStore().store, runModel: scripted([]).run, ...quiet })
  assertEquals(res.headers.get('Access-Control-Allow-Origin'), 'http://localhost:5173')
})
