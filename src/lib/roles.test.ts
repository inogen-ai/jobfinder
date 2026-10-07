import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  rowToRole, patchToRow, roleInputToRow, newRoleId, applyChange, toRoleError, errorMessage,
  createRolesApi, RoleError, type RoleRow,
} from './roles'

const row: RoleRow = {
  id: 'nl-x', title: 'AI Engineer', org: 'Interex', market: 'NL', location: 'Den Haag', remote: '', rate: '',
  ir35: '', duration: '', posted: '2026-09-18', deadline: '2026-10-18', next_date: null, fit: 'Strong',
  status: 'Shortlist', why: 'RAG', caveat: '', url: 'https://x', contact: '', next_step: 'Send CV', notes: '',
  cv: 'A', created_at: '2026-10-06T10:00:00Z', updated_at: '2026-10-06T11:00:00Z',
  created_by: 'claude-script', updated_by: 'michael.snow@inogen.ai',
}

describe('mapping', () => {
  it('rowToRole camel-cases', () => {
    const r = rowToRole(row)
    expect(r.nextStep).toBe('Send CV')
    expect(r.nextDate).toBeNull()
    expect(r.updatedBy).toBe('michael.snow@inogen.ai')
  })
  it('patchToRow snake-cases and turns empty dates into null', () => {
    expect(patchToRow({ nextStep: 'Call', deadline: '', nextDate: '', posted: '2026-10-01', status: 'Applied' }))
      .toEqual({ next_step: 'Call', deadline: null, next_date: null, posted: '2026-10-01', status: 'Applied' })
  })
  it('patchToRow drops undefined keys', () => expect(patchToRow({ notes: undefined })).toEqual({}))
  it('roleInputToRow keeps the id and ignores audit fields', () => {
    const out = roleInputToRow({ ...rowToRole(row) })
    expect(out).toMatchObject({ id: 'nl-x', next_step: 'Send CV' })
    expect(out).not.toHaveProperty('created_at')
  })
})

describe('newRoleId', () => {
  it('slugs market, org and title with a time suffix', () =>
    expect(newRoleId('NL', 'Morgan Black', 'GCP Data/AI Engineer', 1_760_000_000_000)).toBe('nl-morgan-black-gcp-data-ai-engineer-mgj6k3cw'))
})

describe('applyChange', () => {
  const a = rowToRole(row)
  it('inserts new roles', () => expect(applyChange([], { type: 'upsert', role: a })).toEqual([a]))
  it('replaces existing roles', () => {
    const b = { ...a, notes: 'x' }
    expect(applyChange([a], { type: 'upsert', role: b })).toEqual([b])
  })
  it('deletes', () => expect(applyChange([a], { type: 'delete', id: 'nl-x' })).toEqual([]))
  it('ignores deletes of unknown ids', () => expect(applyChange([a], { type: 'delete', id: 'zz' })).toEqual([a]))
})

describe('toRoleError', () => {
  it.each([
    [{ code: 'PGRST116', message: '0 rows' }, 'missing'],
    [{ code: '42501', message: 'row-level security' }, 'auth'],
    [{ code: 'PGRST301', message: 'JWT expired' }, 'auth'],
    [{ status: 401, message: 'unauthorised' }, 'auth'],
    [new TypeError('Failed to fetch'), 'network'],
    [{ code: '23505', message: 'duplicate' }, 'other'],
  ])('%o → %s', (e, kind) => expect(toRoleError(e).kind).toBe(kind))
  it('messages', () => {
    expect(errorMessage(new RoleError('x', 'missing'))).toBe('This role was deleted by someone else.')
    expect(errorMessage(new RoleError('x', 'network'))).toBe("Couldn't save. Check your connection and try again.")
  })
})

/** Chainable fake of supabase.from(...): every method returns the builder; awaiting it yields `result`. */
function fakeSb(result: { data: unknown; error: unknown }) {
  const calls: Array<[string, unknown[]]> = []
  const builder: unknown = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'then') return (resolve: (v: unknown) => void) => resolve(result)
      return (...args: unknown[]) => { calls.push([String(prop), args]); return builder }
    },
  })
  const client = { from: (t: string) => { calls.push(['from', [t]]); return builder } } as unknown as SupabaseClient
  return { client, calls }
}

describe('createRolesApi', () => {
  it('list maps rows', async () => {
    const { client } = fakeSb({ data: [row], error: null })
    expect((await createRolesApi(client).list())[0].id).toBe('nl-x')
  })
  it('update sends snake_case and filters by id', async () => {
    const { client, calls } = fakeSb({ data: row, error: null })
    await createRolesApi(client).update('nl-x', { nextStep: 'Call' })
    expect(calls).toContainEqual(['update', [{ next_step: 'Call' }]])
    expect(calls).toContainEqual(['eq', ['id', 'nl-x']])
  })
  it('update of a deleted role throws missing', async () => {
    const { client } = fakeSb({ data: null, error: { code: 'PGRST116', message: '0 rows' } })
    await expect(createRolesApi(client).update('gone', { notes: 'x' })).rejects.toMatchObject({ kind: 'missing' })
  })
  it('subscribe maps realtime events and status', () => {
    let handler: (p: unknown) => void = () => {}
    let statusCb: (s: string) => void = () => {}
    const channel = {
      on: vi.fn((_e, _f, h) => { handler = h; return channel }),
      subscribe: vi.fn((cb) => { statusCb = cb; return channel }),
    }
    const removeChannel = vi.fn()
    const client = { channel: () => channel, removeChannel } as unknown as SupabaseClient
    const onChange = vi.fn(), onStatus = vi.fn()
    const unsub = createRolesApi(client).subscribe(onChange, onStatus)
    handler({ eventType: 'UPDATE', new: row, old: {} })
    handler({ eventType: 'DELETE', new: {}, old: { id: 'nl-x' } })
    statusCb('SUBSCRIBED'); statusCb('CHANNEL_ERROR')
    expect(onChange).toHaveBeenNthCalledWith(1, { type: 'upsert', role: rowToRole(row) })
    expect(onChange).toHaveBeenNthCalledWith(2, { type: 'delete', id: 'nl-x' })
    expect(onStatus.mock.calls).toEqual([['live'], ['paused']])
    unsub()
    expect(removeChannel).toHaveBeenCalledWith(channel)
  })
})
