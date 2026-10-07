import { buildPrompt, DOC_KINDS, KIND_LABEL, MAX_INSTRUCTION, MAX_QUESTIONS, type BuiltPrompt, type DocKind } from '../_shared/prompt.ts'
import { isAllowedUser } from '../_shared/auth.ts'
import { corsHeaders, json, retryAtFrom } from '../_shared/http.ts'
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
}

const stamp = (d: Date) => new Intl.DateTimeFormat('en-GB', {
  day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/Amsterdam',
}).format(d)

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

export async function handleGenerate(req: Request, deps: GenerateDeps): Promise<Response> {
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
  if (questions.length > MAX_QUESTIONS) return json(req, 400, { code: 'bad_request', message: 'Keep the questions under 8,000 characters.' })
  if (kind === 'answers' && !questions) return json(req, 400, { code: 'bad_request', message: 'Paste the application questions first.' })

  const [role, profile] = await Promise.all([store.getRole(roleId), store.getProfile()])
  if (!role) return json(req, 404, { code: 'role_not_found' })
  if (!profile || !profile.cvText.trim()) return json(req, 409, { code: 'profile_missing' })

  const recent = await store.countDocumentsSince(new Date(now().getTime() - 3_600_000).toISOString())
  if (recent.count >= HOURLY_LIMIT) return json(req, 429, { code: 'rate_limited', retryAt: retryAtFrom(recent.oldest, now()) })

  const previous = previousId ? await store.getDocumentBody(previousId) : null
  const prompt = buildPrompt({ kind, role, profile, instruction, questions, previous })
  const controller = new AbortController()
  const started = now().getTime()

  const stream = new ReadableStream<Uint8Array>({
    async start(out) {
      const send = (name: string, data: unknown) => { try { out.enqueue(sseEvent(name, data)) } catch { /* client gone */ } }
      let outcome = 'ok'
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
      } catch {
        outcome = controller.signal.aborted ? 'aborted' : 'upstream'
        if (!controller.signal.aborted) send('error', { code: 'upstream' })
      } finally {
        log({ fn: 'generate', user: user.id, kind, model, ...usage, ms: now().getTime() - started, outcome })
        try { out.close() } catch { /* already closed */ }
      }
    },
    cancel() { controller.abort() },
  })

  return new Response(stream, { headers: { ...corsHeaders(req), 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } })
}
