import { isAllowedUser } from '../_shared/auth.ts'
import { corsHeaders, json, retryAtFrom } from '../_shared/http.ts'
import { MAX_JOB_DESCRIPTION } from '../_shared/prompt.ts'
import type { Store } from '../_shared/types.ts'

export const FETCH_HOURLY_LIMIT = 20
export type RunFetch = (url: string) => Promise<{ text: string } | { unavailable: true }>
export interface FetchDeps { store: (authorization: string) => Store; runFetch: RunFetch; now?: () => Date }

export async function handleFetchPosting(req: Request, deps: FetchDeps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) })
  if (req.method !== 'POST') return json(req, 405, { code: 'method_not_allowed' })
  const now = deps.now ?? (() => new Date())
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

  const recent = await store.countFetchesSince(new Date(now().getTime() - 3_600_000).toISOString())
  if (recent.count >= FETCH_HOURLY_LIMIT) return json(req, 429, { code: 'rate_limited', retryAt: retryAtFrom(recent.oldest, now()) })
  await store.insertFetch(roleId)

  try {
    const result = await deps.runFetch(url.toString())
    if ('text' in result) return json(req, 200, { text: result.text.slice(0, MAX_JOB_DESCRIPTION) })
    return json(req, 200, { code: 'unavailable' })
  } catch {
    return json(req, 502, { code: 'upstream' })
  }
}
