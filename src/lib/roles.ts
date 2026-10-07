import type { SupabaseClient } from '@supabase/supabase-js'
import type { CvVersion, Fit, Market, Role, Status } from './types'

export interface RoleRow {
  id: string; title: string; org: string; market: string; location: string; remote: string; rate: string
  ir35: string; duration: string; posted: string | null; deadline: string | null; next_date: string | null
  fit: string; status: string; why: string; caveat: string; url: string; contact: string; next_step: string
  notes: string; cv: string; created_at: string; updated_at: string; created_by: string | null; updated_by: string | null
}

export type RoleInput = Omit<Role, 'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy'>
export type RolePatch = Partial<Omit<RoleInput, 'id'>>
export type RoleChange = { type: 'upsert'; role: Role } | { type: 'delete'; id: string }
export type LiveStatus = 'live' | 'paused'

const KEY_MAP: Record<keyof RolePatch, keyof RoleRow> = {
  title: 'title', org: 'org', market: 'market', location: 'location', remote: 'remote', rate: 'rate',
  ir35: 'ir35', duration: 'duration', posted: 'posted', deadline: 'deadline', nextDate: 'next_date',
  fit: 'fit', status: 'status', why: 'why', caveat: 'caveat', url: 'url', contact: 'contact',
  nextStep: 'next_step', notes: 'notes', cv: 'cv',
}
const DATE_COLUMNS = new Set<keyof RoleRow>(['posted', 'deadline', 'next_date'])

export function rowToRole(r: RoleRow): Role {
  return {
    id: r.id, title: r.title, org: r.org, market: r.market as Market, location: r.location, remote: r.remote,
    rate: r.rate, ir35: r.ir35, duration: r.duration, posted: r.posted, deadline: r.deadline, nextDate: r.next_date,
    fit: r.fit as Fit, status: r.status as Status, why: r.why, caveat: r.caveat, url: r.url, contact: r.contact,
    nextStep: r.next_step, notes: r.notes, cv: r.cv as CvVersion, createdAt: r.created_at, updatedAt: r.updated_at,
    createdBy: r.created_by, updatedBy: r.updated_by,
  }
}

export function patchToRow(p: RolePatch): Partial<RoleRow> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(p)) {
    if (v === undefined) continue
    const col = KEY_MAP[k as keyof RolePatch]
    if (!col) continue
    out[col] = DATE_COLUMNS.has(col) && v === '' ? null : v
  }
  return out as Partial<RoleRow>
}

export function roleInputToRow(i: RoleInput): Partial<RoleRow> {
  const { id, ...rest } = i
  return { id, ...patchToRow(rest) }
}

export function newRoleId(market: string, org: string, title: string, now: number = Date.now()): string {
  const slug = `${market}-${org}-${title}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
  return `${slug}-${now.toString(36)}`
}

export function applyChange(roles: Role[], c: RoleChange): Role[] {
  if (c.type === 'delete') return roles.some((r) => r.id === c.id) ? roles.filter((r) => r.id !== c.id) : roles
  const i = roles.findIndex((r) => r.id === c.role.id)
  if (i === -1) return [...roles, c.role]
  const next = roles.slice()
  next[i] = c.role
  return next
}

export type RoleErrorKind = 'auth' | 'missing' | 'network' | 'other'

export class RoleError extends Error {
  readonly kind: RoleErrorKind
  constructor(message: string, kind: RoleErrorKind) {
    super(message)
    this.name = 'RoleError'
    this.kind = kind
  }
}

export function toRoleError(e: unknown): RoleError {
  if (e instanceof RoleError) return e
  const { code, message, status } = (e ?? {}) as { code?: string; message?: string; status?: number }
  const msg = message ?? String(e)
  if (code === 'PGRST116') return new RoleError(msg, 'missing')
  if (code === '42501' || code === 'PGRST301' || status === 401 || status === 403) return new RoleError(msg, 'auth')
  if (/failed to fetch|networkerror|load failed/i.test(msg)) return new RoleError(msg, 'network')
  return new RoleError(msg, 'other')
}

export function errorMessage(e: RoleError): string {
  if (e.kind === 'missing') return 'This role was deleted by someone else.'
  if (e.kind === 'auth') return 'Your session has ended. Sign in again.'
  return "Couldn't save. Check your connection and try again."
}

export interface RolesApi {
  list(): Promise<Role[]>
  create(input: RoleInput): Promise<Role>
  update(id: string, patch: RolePatch): Promise<Role>
  remove(id: string): Promise<void>
  subscribe(onChange: (c: RoleChange) => void, onStatus: (s: LiveStatus) => void): () => void
}

export function createRolesApi(sb: SupabaseClient): RolesApi {
  return {
    async list() {
      const { data, error } = await sb.from('roles').select('*')
      if (error) throw toRoleError(error)
      return (data as RoleRow[]).map(rowToRole)
    },
    async create(input) {
      const { data, error } = await sb.from('roles').insert(roleInputToRow(input)).select().single()
      if (error) throw toRoleError(error)
      return rowToRole(data as RoleRow)
    },
    async update(id, patch) {
      const { data, error } = await sb.from('roles').update(patchToRow(patch)).eq('id', id).select().single()
      if (error) throw toRoleError(error)
      return rowToRole(data as RoleRow)
    },
    async remove(id) {
      const { error } = await sb.from('roles').delete().eq('id', id)
      if (error) throw toRoleError(error)
    },
    subscribe(onChange, onStatus) {
      const channel = sb
        .channel('roles-changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'roles' }, (payload: {
          eventType: 'INSERT' | 'UPDATE' | 'DELETE'; new: unknown; old: unknown
        }) => {
          if (payload.eventType === 'DELETE') onChange({ type: 'delete', id: (payload.old as { id: string }).id })
          else onChange({ type: 'upsert', role: rowToRole(payload.new as RoleRow) })
        })
        .subscribe((status: string) => onStatus(status === 'SUBSCRIBED' ? 'live' : 'paused'))
      return () => { void sb.removeChannel(channel) }
    },
  }
}
