/**
 * ingest-roles: the narrow door the daily search routine uses. It holds its own token (INGEST_TOKEN),
 * not a user login and never the service key, and can only: list role titles/links, add new roles,
 * and close Shortlist roles the user has not worked on.
 */
export const MARKETS = ['UK', 'NL', 'EU', 'Global'] as const
export const FITS = ['Strong', 'Good', 'Stretch'] as const
export const MAX_ADD = 50
export const MAX_CLOSE = 100

export interface RoleRecord {
  id: string; title: string; org: string; market: string; url: string; status: string
  deadline: string | null; notes: string; next_step: string
}

export interface AdminStore {
  listRoles(): Promise<RoleRecord[]>
  insertRoles(rows: Record<string, unknown>[]): Promise<void>
  closeRole(id: string, notes: string): Promise<void>
}

export interface IngestDeps { store: AdminStore; token: string; today?: () => string }

const TEXT_FIELDS = ['location', 'remote', 'rate', 'ir35', 'duration', 'why', 'caveat', 'contact'] as const
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/** Constant-time comparison so the token can't be guessed byte by byte from timings. */
function sameToken(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b)
  let diff = x.length ^ y.length
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0)
  return diff === 0
}

export function normUrl(u: string): string {
  try {
    const p = new URL(u.trim())
    return `${p.protocol}//${p.hostname.toLowerCase().replace(/^www\./, '')}${p.pathname.replace(/\/+$/, '')}${p.search}`
  } catch { return u.trim().toLowerCase() }
}
const normText = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const slug = (...parts: string[]) => parts.join('-').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80)
const str = (v: unknown, max = 2000) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const isUntouched = (r: RoleRecord) => r.status === 'Shortlist' && !r.notes && !r.next_step

export async function handleIngest(req: Request, deps: IngestDeps): Promise<Response> {
  if (!deps.token) return json(500, { code: 'not_configured' })
  if (!sameToken(req.headers.get('x-ingest-token') ?? '', deps.token)) return json(401, { code: 'unauthorized' })
  if (req.method !== 'POST') return json(405, { code: 'method_not_allowed' })
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return json(400, { code: 'bad_request', message: 'Body must be JSON.' }) }

  const existing = await deps.store.listRoles()

  if (body.action === 'list') {
    return json(200, {
      roles: existing.map((r) => ({ id: r.id, title: r.title, org: r.org, market: r.market, url: r.url, status: r.status, deadline: r.deadline, touched: !isUntouched(r) })),
    })
  }

  if (body.action === 'add') {
    const input = Array.isArray(body.roles) ? body.roles : []
    if (input.length > MAX_ADD) return json(400, { code: 'bad_request', message: `At most ${MAX_ADD} roles per call.` })
    const urls = new Set(existing.map((r) => normUrl(r.url)).filter(Boolean))
    const keys = new Set(existing.map((r) => `${normText(r.org)}|${normText(r.title)}`))
    const ids = new Set(existing.map((r) => r.id))
    const rows: Record<string, unknown>[] = []
    const skipped: Array<{ index: number; reason: string }> = []
    input.forEach((raw, index) => {
      const r = (raw ?? {}) as Record<string, unknown>
      const title = str(r.title, 300), org = str(r.org, 200), url = str(r.url, 1000)
      const market = str(r.market), fit = str(r.fit)
      if (!title || !org) return skipped.push({ index, reason: 'title and org are required' })
      if (!(MARKETS as readonly string[]).includes(market)) return skipped.push({ index, reason: 'invalid market' })
      if (!(FITS as readonly string[]).includes(fit)) return skipped.push({ index, reason: 'invalid fit' })
      if (!/^https?:\/\//i.test(url)) return skipped.push({ index, reason: 'url must be http(s)' })
      const u = normUrl(url), key = `${normText(org)}|${normText(title)}`
      if (urls.has(u) || keys.has(key)) return skipped.push({ index, reason: 'duplicate' })
      urls.add(u); keys.add(key)
      let id = slug(market, org, title), n = 2
      while (ids.has(id)) id = `${slug(market, org, title)}-${n++}`
      ids.add(id)
      const row: Record<string, unknown> = { id, title, org, market, fit, url }
      for (const f of TEXT_FIELDS) row[f] = str(r[f])
      for (const f of ['posted', 'deadline'] as const) row[f] = typeof r[f] === 'string' && ISO_DATE.test(r[f] as string) ? r[f] : null
      row.status = 'Shortlist'
      rows.push({
        id: row.id, title, org, market, fit, url, location: row.location, remote: row.remote, rate: row.rate, ir35: row.ir35,
        duration: row.duration, posted: row.posted, deadline: row.deadline, why: row.why, caveat: row.caveat, contact: row.contact, status: 'Shortlist',
      })
    })
    if (rows.length) await deps.store.insertRoles(rows)
    return json(200, { added: rows.map((r) => r.id), skipped })
  }

  if (body.action === 'close') {
    const items = Array.isArray(body.items) ? body.items : []
    if (items.length > MAX_CLOSE) return json(400, { code: 'bad_request', message: `At most ${MAX_CLOSE} items per call.` })
    const byId = new Map(existing.map((r) => [r.id, r]))
    const today = (deps.today ?? (() => new Date().toISOString().slice(0, 10)))()
    const closed: string[] = []
    const refused: Array<{ id: string; reason: string }> = []
    for (const raw of items) {
      const it = (raw ?? {}) as Record<string, unknown>
      const id = str(it.id, 200), reason = str(it.reason, 200) || 'posting closed'
      const role = byId.get(id)
      if (!role) { refused.push({ id, reason: 'not found' }); continue }
      if (!isUntouched(role)) { refused.push({ id, reason: 'the user has worked on this role' }); continue }
      await deps.store.closeRole(id, `Auto-closed ${today}: ${reason}`)
      closed.push(id)
    }
    return json(200, { closed, refused })
  }

  return json(400, { code: 'bad_request', message: 'action must be list, add or close.' })
}
