import type { DocKind } from './documents'

export type GenerateErrorCode =
  | 'unauthorized' | 'bad_request' | 'role_not_found' | 'profile_missing' | 'rate_limited'
  | 'refused' | 'upstream' | 'stopped' | 'network'

export class GenerateError extends Error {
  readonly code: GenerateErrorCode
  readonly retryAt: string | null
  constructor(code: GenerateErrorCode, message = '', retryAt: string | null = null) {
    super(message || code)
    this.name = 'GenerateError'
    this.code = code
    this.retryAt = retryAt
  }
}

export interface GenerateParams { roleId: string; kind: DocKind; instruction?: string; questions?: string; previousDocumentId?: string | null }
export interface GenerateResult { documentId: string; model: string; truncated: boolean; jdTruncated: boolean }
export interface GenerateHandlers { onDelta(text: string): void; onReset(): void; signal?: AbortSignal }
export type FetchPostingResult = { text: string } | { unavailable: true }
export interface GenerateClient {
  generate(p: GenerateParams, h: GenerateHandlers): Promise<GenerateResult>
  fetchPosting(roleId: string): Promise<FetchPostingResult>
}

export interface SSEEvent { event: string; data: string }

/** Incremental SSE parser; TextDecoder in stream mode keeps multibyte characters intact across chunks. */
export class SSEParser {
  private buffer = ''
  private readonly decoder = new TextDecoder()
  push(chunk: Uint8Array): SSEEvent[] {
    this.buffer += this.decoder.decode(chunk, { stream: true })
    const out: SSEEvent[] = []
    let end: number
    while ((end = this.buffer.indexOf('\n\n')) !== -1) {
      const raw = this.buffer.slice(0, end)
      this.buffer = this.buffer.slice(end + 2)
      let event = 'message'
      let fields = 0
      const data: string[] = []
      for (const line of raw.split('\n')) {
        if (line.startsWith('event:')) { event = line.slice(6).trim(); fields++ }
        else if (line.startsWith('data:')) { data.push(line.slice(5).trimStart()); fields++ }
      }
      if (fields) out.push({ event, data: data.join('\n') }) // comment-only blocks are keep-alives
    }
    return out
  }
}

async function errorFrom(res: Response): Promise<GenerateError> {
  let body: { code?: GenerateErrorCode; message?: string; retryAt?: string } = {}
  try { body = await res.json() } catch { /* not JSON */ }
  const code = body.code ?? (res.status === 401 ? 'unauthorized' : 'upstream')
  return new GenerateError(code, body.message ?? '', body.retryAt ?? null)
}

export function createGenerateClient(opts: {
  functionsUrl: string; anonKey: string; getToken: () => Promise<string>; fetchImpl?: typeof fetch
}): GenerateClient {
  const doFetch = opts.fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init))
  const headers = async () => ({ Authorization: `Bearer ${await opts.getToken()}`, apikey: opts.anonKey, 'Content-Type': 'application/json' })

  return {
    async generate(p, h) {
      const failure = () => new GenerateError(h.signal?.aborted ? 'stopped' : 'network')
      let res: Response
      try {
        res = await doFetch(`${opts.functionsUrl}/generate`, { method: 'POST', headers: await headers(), body: JSON.stringify(p), signal: h.signal })
      } catch { throw failure() }
      if (!res.ok || !res.body) throw await errorFrom(res)
      const reader = res.body.getReader()
      const parser = new SSEParser()
      try {
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          for (const ev of parser.push(value)) {
            const data = ev.data ? JSON.parse(ev.data) : {}
            if (ev.event === 'delta') h.onDelta(data.text ?? '')
            else if (ev.event === 'reset') h.onReset()
            else if (ev.event === 'done') return data as GenerateResult
            else if (ev.event === 'error') throw new GenerateError(data.code ?? 'upstream')
          }
        }
      } catch (e) {
        if (e instanceof GenerateError) throw e
        throw failure()
      }
      throw failure()
    },
    async fetchPosting(roleId) {
      let res: Response
      try {
        res = await doFetch(`${opts.functionsUrl}/fetch-posting`, { method: 'POST', headers: await headers(), body: JSON.stringify({ roleId }) })
      } catch { throw new GenerateError('network') }
      if (!res.ok) throw await errorFrom(res)
      const body = await res.json()
      return typeof body.text === 'string' ? { text: body.text } : { unavailable: true }
    },
  }
}

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

export function generateErrorMessage(e: GenerateError): string {
  switch (e.code) {
    case 'profile_missing': return 'Add your CV to your profile first.'
    case 'rate_limited': return `You've generated 20 drafts this hour — try again at ${e.retryAt ? hhmm(e.retryAt) : 'a little later'}.`
    case 'stopped': return 'Generation stopped early.'
    case 'unauthorized': return 'Your session has ended. Sign in again.'
    case 'bad_request': return e.message && e.message !== 'bad_request' ? e.message : "Couldn't generate this draft. Nothing was saved."
    default: return "Couldn't generate this draft. Nothing was saved."
  }
}

export function fetchErrorMessage(e: GenerateError): string {
  switch (e.code) {
    case 'rate_limited': return `You've fetched 20 postings this hour — try again at ${e.retryAt ? hhmm(e.retryAt) : 'a little later'}.`
    case 'bad_request': return e.message && e.message !== 'bad_request' ? e.message : "Couldn't fetch the posting. Paste the job description instead."
    case 'unauthorized': return 'Your session has ended. Sign in again.'
    default: return "Couldn't fetch the posting. Paste the job description instead."
  }
}
