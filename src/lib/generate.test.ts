import { describe, it, expect, vi } from 'vitest'
import { SSEParser, createGenerateClient, GenerateError, generateErrorMessage, fetchErrorMessage } from './generate'

const enc = new TextEncoder()
const sse = (...events: Array<[string, unknown]>) => events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join('')

function streamResponse(chunks: Uint8Array[], init: ResponseInit = { status: 200 }) {
  return new Response(new ReadableStream({ start(c) { chunks.forEach((x) => c.enqueue(x)); c.close() } }), init)
}

describe('SSEParser', () => {
  it('ignores keep-alive comments', () => {
    const p = new SSEParser()
    const out = p.push(enc.encode(': ping\n\n' + sse(['delta', { text: 'a' }])))
    expect(out.map((e) => e.event)).toEqual(['delta'])
  })
  it('reassembles events and multibyte characters split across chunks', () => {
    const bytes = enc.encode(sse(['delta', { text: 'Tarief €100 — café' }], ['done', { documentId: 'd1' }]))
    const p = new SSEParser()
    const out = [...p.push(bytes.slice(0, 7)), ...p.push(bytes.slice(7, 41)), ...p.push(bytes.slice(41))]
    expect(out.map((e) => e.event)).toEqual(['delta', 'done'])
    expect(JSON.parse(out[0].data).text).toBe('Tarief €100 — café')
  })
})

function client(fetchImpl: typeof fetch) {
  return createGenerateClient({ functionsUrl: 'https://x/functions/v1', anonKey: 'anon', getToken: async () => 'jwt', fetchImpl })
}

describe('generate', () => {
  it('sends auth headers and maps delta, reset and done', async () => {
    const fetchImpl = vi.fn(async () => streamResponse([enc.encode(sse(['delta', { text: 'a' }], ['reset', {}], ['delta', { text: 'b' }], ['done', { documentId: 'd1', model: 'm', truncated: false, jdTruncated: true }]))]))
    const seen: string[] = []
    const res = await client(fetchImpl as unknown as typeof fetch).generate({ roleId: 'r1', kind: 'pitch' }, { onDelta: (t) => seen.push(t), onReset: () => seen.push('<reset>') })
    expect(seen).toEqual(['a', '<reset>', 'b'])
    expect(res).toMatchObject({ documentId: 'd1', jdTruncated: true })
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://x/functions/v1/generate')
    expect(init.headers).toMatchObject({ Authorization: 'Bearer jwt', apikey: 'anon' })
  })
  it('turns an error event into a GenerateError', async () => {
    const fetchImpl = async () => streamResponse([enc.encode(sse(['error', { code: 'refused' }]))])
    await expect(client(fetchImpl as unknown as typeof fetch).generate({ roleId: 'r1', kind: 'cv' }, { onDelta: () => {}, onReset: () => {} }))
      .rejects.toMatchObject({ code: 'refused' })
  })
  it('maps 429 with retryAt and 409 profile_missing', async () => {
    const r429 = async () => new Response(JSON.stringify({ code: 'rate_limited', retryAt: '2026-10-07T13:40:00.000Z' }), { status: 429 })
    const e = await client(r429 as unknown as typeof fetch).generate({ roleId: 'r1', kind: 'cv' }, { onDelta: () => {}, onReset: () => {} }).catch((x) => x)
    expect(e).toBeInstanceOf(GenerateError)
    expect(e.code).toBe('rate_limited')
    expect(generateErrorMessage(e)).toBe(`You've generated 20 drafts this hour — try again at ${new Date('2026-10-07T13:40:00.000Z').toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}.`)
    const r409 = async () => new Response(JSON.stringify({ code: 'profile_missing' }), { status: 409 })
    const e2 = await client(r409 as unknown as typeof fetch).generate({ roleId: 'r1', kind: 'cv' }, { onDelta: () => {}, onReset: () => {} }).catch((x) => x)
    expect(generateErrorMessage(e2)).toBe('Add your CV to your profile first.')
  })
  it('a stream that ends without done is a network error; an abort is stopped', async () => {
    const cut = async () => streamResponse([enc.encode(sse(['delta', { text: 'a' }]))])
    await expect(client(cut as unknown as typeof fetch).generate({ roleId: 'r1', kind: 'cv' }, { onDelta: () => {}, onReset: () => {} })).rejects.toMatchObject({ code: 'network' })
    const ctrl = new AbortController(); ctrl.abort()
    const aborted = async () => { throw new DOMException('aborted', 'AbortError') }
    const e = await client(aborted as unknown as typeof fetch).generate({ roleId: 'r1', kind: 'cv' }, { onDelta: () => {}, onReset: () => {}, signal: ctrl.signal }).catch((x) => x)
    expect(e.code).toBe('stopped')
    expect(generateErrorMessage(e)).toBe('Generation stopped early.')
  })
})

describe('fetchPosting', () => {
  it('returns text or unavailable', async () => {
    const ok = async () => new Response(JSON.stringify({ text: 'JD' }))
    expect(await client(ok as unknown as typeof fetch).fetchPosting('r1')).toEqual({ text: 'JD' })
    const no = async () => new Response(JSON.stringify({ code: 'unavailable' }))
    expect(await client(no as unknown as typeof fetch).fetchPosting('r1')).toEqual({ unavailable: true })
  })
  it('explains fetch errors', () => {
    expect(fetchErrorMessage(new GenerateError('upstream'))).toBe("Couldn't fetch the posting. Paste the job description instead.")
  })
})
