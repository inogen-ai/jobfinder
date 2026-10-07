import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Role, Status } from '../lib/types'
import {
  applyChange, errorMessage, toRoleError, type LiveStatus, type RoleInput, type RolePatch, type RolesApi,
} from '../lib/roles'
import { contractCountdown, filterRoles, sortRoles, stageCounts, type Filters } from '../lib/pipeline'
import { loadFilters, saveFilters } from '../lib/filterStorage'
import { StageStrip } from './StageStrip'
import { FilterBar } from './Filters'
import { RoleRow } from './RoleRow'
import { RoleEditor } from './RoleEditor'
import { AddRoleDialog } from './AddRoleDialog'

export function Pipeline({ api, userEmail, onSignOut, onAuthError, now: nowProp }: {
  api: RolesApi; userEmail: string; onSignOut: () => void; onAuthError: () => void; now?: Date
}) {
  // One clock per mount, so memoised sorting isn't recomputed on every render.
  const [now] = useState(() => nowProp ?? new Date())
  const [roles, setRoles] = useState<Role[]>([])
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [live, setLive] = useState<LiveStatus | 'connecting'>('connecting')
  const [filters, setFilters] = useState<Filters>(() => loadFilters())
  const [openId, setOpenId] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [adding, setAdding] = useState(false)

  const fail = useCallback((e: unknown): string => {
    const err = toRoleError(e)
    if (err.kind === 'auth') onAuthError()
    return errorMessage(err)
  }, [onAuthError])

  const reload = useCallback(async () => {
    try {
      setRoles(await api.list())
      setLoadError('')
    } catch (e) {
      const err = toRoleError(e)
      if (err.kind === 'auth') onAuthError()
      else setLoadError("Couldn't load roles. Check your connection and reload the page.")
    } finally {
      setLoaded(true)
    }
  }, [api, onAuthError])

  useEffect(() => {
    // reload() only sets state after its first await, so this does not render synchronously.
    // oxlint-disable-next-line react/set-state-in-effect
    void reload()
    let wasPaused = false
    return api.subscribe(
      (change) => setRoles((rs) => applyChange(rs, change)),
      (status) => {
        setLive(status)
        if (status === 'paused') wasPaused = true
        else if (wasPaused) { wasPaused = false; void reload() } // catch up on changes missed while offline
      },
    )
  }, [api, reload])

  useEffect(() => { saveFilters(filters) }, [filters])
  // A role deleted by someone else simply stops rendering, which closes its editor.

  const counts = useMemo(() => stageCounts(roles, now), [roles, now])
  const visible = useMemo(() => sortRoles(filterRoles(roles, filters, now), now), [roles, filters, now])

  async function changeStatus(id: string, status: Status) {
    const before = roles.find((r) => r.id === id)
    if (!before) return
    setRoles((rs) => rs.map((r) => (r.id === id ? { ...r, status } : r)))
    try {
      const saved = await api.update(id, { status })
      setRoles((rs) => applyChange(rs, { type: 'upsert', role: saved }))
      setNotice('')
    } catch (e) {
      setRoles((rs) => rs.map((r) => (r.id === id ? { ...r, status: before.status } : r)))
      setNotice(fail(e))
    }
  }

  async function save(id: string, patch: RolePatch): Promise<string | null> {
    try {
      const saved = await api.update(id, patch)
      setRoles((rs) => applyChange(rs, { type: 'upsert', role: saved }))
      return null
    } catch (e) {
      const err = toRoleError(e)
      if (err.kind === 'missing') {
        // Removing the role unmounts its editor, so the message has to live on the page.
        setRoles((rs) => applyChange(rs, { type: 'delete', id }))
        setNotice(errorMessage(err))
      }
      return fail(err)
    }
  }

  async function remove(id: string): Promise<string | null> {
    try {
      await api.remove(id)
      setRoles((rs) => applyChange(rs, { type: 'delete', id }))
      return null
    } catch (e) {
      return fail(e)
    }
  }

  async function create(input: RoleInput): Promise<string | null> {
    try {
      const saved = await api.create(input)
      setRoles((rs) => applyChange(rs, { type: 'upsert', role: saved }))
      setAdding(false)
      setFilters((f) => ({ ...f, stage: 'Active' }))
      setOpenId(saved.id)
      return null
    } catch (e) {
      return fail(e)
    }
  }

  let body
  if (!loaded) body = <div className="empty"><b>Loading roles…</b></div>
  else if (loadError) body = <div className="empty"><b>{loadError}</b></div>
  else if (!roles.length) body = <div className="empty"><b>No roles yet.</b>Use Add role to log the first one.</div>
  else if (!visible.length) body = <div className="empty"><b>Nothing matches these filters.</b>Try All markets or another stage.</div>
  else body = visible.map((r) => (
    <RoleRow key={r.id} role={r} now={now} open={openId === r.id}
      onToggle={() => setOpenId((o) => (o === r.id ? null : r.id))}
      onStatus={(s) => void changeStatus(r.id, s)}>
      <RoleEditor role={r} now={now} onSave={(p) => save(r.id, p)} onDelete={() => remove(r.id)} />
    </RoleRow>
  ))

  return (
    <main className="wrap">
      <header className="top">
        <div>
          <h1>Contract Pipeline</h1>
          <p className="sub">Remote freelance roles across the UK, the Netherlands and wider Europe. Open a row to update its status, next step and notes.</p>
        </div>
        <div className="top-side">
          <div className="countdown"><b className="mono">{contractCountdown(now)}</b><span>days until the current<br />contract ends (31 Oct)</span></div>
          <div className="userbar"><span className="muted">{userEmail}</span><button className="btn" onClick={onSignOut}>Sign out</button></div>
        </div>
      </header>
      <StageStrip counts={counts} value={filters.stage} onChange={(stage) => setFilters((f) => ({ ...f, stage }))} />
      <FilterBar filters={filters} onChange={setFilters} onAdd={() => setAdding(true)} />
      {live === 'paused' && <p className="banner" role="status">Live updates paused. Reconnecting…</p>}
      <div className="ledger">
        <div className="cols" aria-hidden="true"><span>Role</span><span>Market</span><span>Terms</span><span>Deadline</span><span>Fit</span><span>Status</span></div>
        <div>{body}</div>
      </div>
      {notice && <p className="notice" role="alert">{notice}</p>}
      {adding && <AddRoleDialog onCreate={create} onClose={() => setAdding(false)} />}
    </main>
  )
}
