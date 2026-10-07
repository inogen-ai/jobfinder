import { buildPrompt, DOC_KINDS, KIND_LABEL, MAX_INSTRUCTION, MAX_QUESTIONS, type BuiltPrompt, type DocKind } from '../_shared/prompt.ts'
import { isAllowedUser } from '../_shared/auth.ts'
import { corsHeaders, json } from '../_shared/http.ts'
import { sseEvent } from '../_shared/sse.ts'
import type { Store } from '../_shared/types.ts'

export const HOURLY_LIMIT = 20

export type ModelEvent = { type: 'text'; text: string } | { type: 'reset' }
export interface ModelResult { stopReason: string; text: string; model: string; usage: { input_tokens: number; output_tokens: number } }
export interface ModelRun { events: AsyncIterable<ModelEvent>; final(): Promise<ModelResult> }
export type RunModel = (prompt: BuiltPrompt, signal: AbortSignal) => ModelRun

export interface GenerateDeps {
  store: (authorization: string) => Store
  runModel: RunModel
  now?: () => Date
  log?: (entry: Record<string, unknown>) => void
  /** Keep-alive interval while the model is silent (thinking). */
  pingMs?: number
}

const stamp = (d: Date) => new Intl.DateTimeFormat('en-GB', {
  day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/Amsterdam',
}).format(d)

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Any failure before streaming starts still answers with JSON and CORS headers, so the browser can read it. */
export async function handleGenerate(req: Request, deps: GenerateDeps): Promise<Response> {
  try {
    return await handle(req, deps)
  } catch (e) {
    const err = e as { name?: string; code?: string }
    ;(deps.log ?? ((x: Record<string, unknown>) => console.log(JSON.stringify(x))))({ fn: 'generate', outcome: 'store_error', errorType: err?.name, errorCode: err?.code })
    return json(req, 502, { code: 'upstream' })
  }
}

async function handle(req: Request, deps: GenerateDeps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) })
  if (req.method !== 'POST') return json(req, 405, { code: 'method_not_allowed' })
  const now = deps.now ?? (() => new Date())
  const log = deps.log ?? ((e: Record<string, unknown>) => console.log(JSON.stringify(e)))

  const store = deps.store(req.headers.get('Authorization') ?? '')
  const user = await store.getUser()
  if (!user || !isAllowedUser(user)) return json(req, 401, { code: 'unauthorized' })

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return json(req, 400, { code: 'bad_request', message: 'The request body must be JSON.' }) }
  const roleId = str(body.roleId)
  const kind = str(body.kind) as DocKind
  const instruction = str(body.instruction)
  const questions = str(body.questions)
  const previousId = str(body.previousDocumentId) || null
  if (!roleId || !DOC_KINDS.includes(kind)) return json(req, 400, { code: 'bad_request', message: 'Choose a role and a document type.' })
  if (instruction.length > MAX_INSTRUCTION) return json(req, 400, { code: 'bad_request', message: 'Keep the instruction under 1,000 characters.' })
  if (previousId && !UUID.test(previousId)) return json(req, 400, { code: 'bad_request', message: 'Unknown draft.' })
  if (questions.length > MAX_QUESTIONS) return json(req, 400, { code: 'bad_request', message: 'Keep the questions under 8,000 characters.' })
  if (kind === 'answers' && !questions) return json(req, 400, { code: 'bad_request', message: 'Paste the application questions first.' })

  const [role, profile] = await Promise.all([store.getRole(roleId), store.getProfile()])
  if (!role) return json(req, 404, { code: 'role_not_found' })
  if (!profile || !profile.cvText.trim()) return json(req, 409, { code: 'profile_missing' })

  const previous = previousId ? await store.getDocumentBody(previousId) : null
  const prompt = buildPrompt({ kind, role, profile, instruction, questions, previous })

  // Recorded before the model runs, so stopped, refused and failed runs count against the limit too.
  const retryAt = await store.claimUsage('generate', roleId, HOURLY_LIMIT)
  if (retryAt) return json(req, 429, { code: 'rate_limited', retryAt })

  const controller = new AbortController()
  req.signal?.addEventListener('abort', () => controller.abort())
  const started = now().getTime()

  const stream = new ReadableStream<Uint8Array>({
    async start(out) {
      const send = (name: string, data: unknown) => {
        try { out.enqueue(sseEvent(name, data)) } catch { controller.abort() } // client gone: stop the model
      }
      const ping = setInterval(() => {
        try { out.enqueue(new TextEncoder().encode(': ping\n\n')) } catch { controller.abort() }
      }, deps.pingMs ?? 15_000)
      let outcome = 'ok'
      let error: { errorType?: string; errorStatus?: number } = {}
      let model = ''
      let usage = { input_tokens: 0, output_tokens: 0 }
      try {
        const run = deps.runModel(prompt, controller.signal)
        for await (const ev of run.events) {
          if (ev.type === 'text') send('delta', { text: ev.text })
          else send('reset', {})
        }
        const result = await run.final()
        model = result.model
        usage = result.usage
        if (controller.signal.aborted) { outcome = 'aborted'; return }
        if (result.stopReason === 'refusal' || !result.text) {
          outcome = 'refused'
          send('error', { code: 'refused' })
          return
        }
        const documentId = await store.insertDocument({
          roleId, kind, title: `${KIND_LABEL[kind]} · ${stamp(now())}`, body: result.text, questions, instruction,
          model: result.model, inputTokens: usage.input_tokens, outputTokens: usage.output_tokens,
        })
        send('done', { documentId, model: result.model, usage, truncated: result.stopReason === 'max_tokens', jdTruncated: prompt.jdTruncated })
      } catch (e) {
        outcome = controller.signal.aborted ? 'aborted' : 'upstream'
        const err = e as { name?: string; status?: number }
        error = { errorType: err?.name, errorStatus: typeof err?.status === 'number' ? err.status : undefined }
        if (!controller.signal.aborted) send('error', { code: 'upstream' })
      } finally {
        clearInterval(ping)
        log({ fn: 'generate', user: user.id, kind, model, ...usage, ms: now().getTime() - started, outcome, ...error })
        try { out.close() } catch { /* already closed */ }
      }
    },
    cancel() { controller.abort() },
  })

  return new Response(stream, { headers: { ...corsHeaders(req), 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } })
}
