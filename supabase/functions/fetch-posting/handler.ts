import { isAllowedUser } from '../_shared/auth.ts'
import { corsHeaders, json } from '../_shared/http.ts'
import { MAX_JOB_DESCRIPTION } from '../_shared/prompt.ts'
import type { Store } from '../_shared/types.ts'

export const FETCH_HOURLY_LIMIT = 20
type Usage = { input_tokens: number; output_tokens: number }
export type RunFetch = (url: string) => Promise<({ text: string } | { unavailable: true }) & { usage?: Usage }>
export interface FetchDeps {
  store: (authorization: string) => Store
  runFetch: RunFetch
  now?: () => Date
  log?: (entry: Record<string, unknown>) => void
}

export async function handleFetchPosting(req: Request, deps: FetchDeps): Promise<Response> {
  try {
    return await handle(req, deps)
  } catch (e) {
    const err = e as { name?: string; code?: string }
    ;(deps.log ?? ((x: Record<string, unknown>) => console.log(JSON.stringify(x))))({ fn: 'fetch-posting', outcome: 'store_error', errorType: err?.name, errorCode: err?.code })
    return json(req, 502, { code: 'upstream' })
  }
}

async function handle(req: Request, deps: FetchDeps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) })
  if (req.method !== 'POST') return json(req, 405, { code: 'method_not_allowed' })
  const now = deps.now ?? (() => new Date())
  const log = deps.log ?? ((e: Record<string, unknown>) => console.log(JSON.stringify(e)))
  const store = deps.store(req.headers.get('Authorization') ?? '')
  const user = await store.getUser()
  if (!user || !isAllowedUser(user)) return json(req, 401, { code: 'unauthorized' })

  let roleId = ''
  try { roleId = String((await req.json()).roleId ?? '').trim() } catch { /* handled below */ }
  if (!roleId) return json(req, 400, { code: 'bad_request', message: 'Choose a role.' })
  const role = await store.getRole(roleId)
  if (!role) return json(req, 404, { code: 'role_not_found' })

  let url: URL
  try { url = new URL(role.url) } catch { return json(req, 400, { code: 'bad_request', message: 'This role has no valid link.' }) }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return json(req, 400, { code: 'bad_request', message: 'This role has no valid link.' })

  const retryAt = await store.claimUsage('fetch', roleId, FETCH_HOURLY_LIMIT)
  if (retryAt) return json(req, 429, { code: 'rate_limited', retryAt })

  const started = now().getTime()
  const entry = (outcome: string, usage: Usage = { input_tokens: 0, output_tokens: 0 }, extra: Record<string, unknown> = {}) =>
    log({ fn: 'fetch-posting', user: user.id, ...usage, ms: now().getTime() - started, outcome, ...extra })
  try {
    const result = await deps.runFetch(url.toString())
    if ('text' in result) {
      entry('ok', result.usage)
      return json(req, 200, { text: result.text.slice(0, MAX_JOB_DESCRIPTION) })
    }
    entry('unavailable', result.usage)
    return json(req, 200, { code: 'unavailable' })
  } catch (e) {
    const err = e as { name?: string; status?: number }
    entry('upstream', undefined, { errorType: err?.name, errorStatus: typeof err?.status === 'number' ? err.status : undefined })
    return json(req, 502, { code: 'upstream' })
  }
}
