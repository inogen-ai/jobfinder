import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { Role } from '../lib/types'
import { DOC_KIND_LABEL, type Doc, type DocKind, type DocumentsApi } from '../lib/documents'
import { GenerateError, generateErrorMessage, type GenerateClient } from '../lib/generate'
import type { RunStore } from '../lib/runStore'
import { errorMessage, toRoleError } from '../lib/roles'
import { JobDescription } from './JobDescription'
import { GenerateButtons } from './GenerateButtons'
import { DraftEditor } from './DraftEditor'

export interface DocsContext {
  api: DocumentsApi
  client: GenerateClient
  /** Generations in progress; they outlive this panel so closing a role never loses a draft. */
  runs: RunStore
  profileReady: boolean
  onOpenProfile: () => void
  onAuthError?: () => void
}

export function DocumentsPanel({ role, ctx, onSaveJobDescription, onCountChange }: {
  role: Role; ctx: DocsContext
  onSaveJobDescription: (text: string) => Promise<string | null>
  onCountChange: (roleId: string, count: number) => void
}) {
  const [docs, setDocs] = useState<Doc[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [loaded, setLoaded] = useState(false)
  const flushJd = useRef<(() => Promise<string | null>) | null>(null)
  const countRef = useRef(onCountChange)
  useEffect(() => { countRef.current = onCountChange })

  const run = useSyncExternalStore(ctx.runs.subscribe, () => ctx.runs.get(role.id))
  const busy = run?.busy ?? false
  // A run is shown while it streams, or after it failed with text worth keeping.
  const live = run && (run.busy || (run.outcome === 'failed' && run.text)) ? run : null
  const runNotice = run?.outcome === 'failed' && run.error ? generateErrorMessage(run.error) : ''

  useEffect(() => {
    let on = true
    ctx.api.list(role.id)
      .then((d) => {
        if (!on) return
        setDocs(d); setSelected(d[0]?.id ?? null); setLoaded(true)
        // A run that finished while the panel was closed is already in the list.
        if (ctx.runs.get(role.id)?.outcome === 'done') ctx.runs.clear(role.id)
      })
      .catch(() => { if (on) setNotice("Couldn't load your drafts.") })
    return () => { on = false }
  }, [ctx.api, ctx.runs, role.id])

  // The badge follows the list; every change below goes through a functional update, so no stale copies.
  useEffect(() => { if (loaded) countRef.current(role.id, docs.length) }, [loaded, docs.length, role.id])

  async function start(kind: DocKind, opts: { instruction?: string; questions?: string; previousDocumentId?: string | null }) {
    const jdError = await flushJd.current?.()
    if (jdError) { setNotice(jdError); return }
    setNotice(''); setSelected(null)
    let res
    try {
      res = await ctx.runs.start(role.id, { kind, ...opts })
    } catch (e) {
      if (e instanceof GenerateError && e.code === 'unauthorized') ctx.onAuthError?.()
      return // the run keeps its error and any partial text for display
    }
    let saved: Doc | null = null
    try {
      saved = await ctx.api.get(res.documentId)
    } catch {
      try {
        const fresh = await ctx.api.list(role.id)
        setDocs(fresh)
        saved = fresh.find((d) => d.id === res.documentId) ?? null
      } catch { /* handled below */ }
    }
    ctx.runs.clear(role.id)
    if (!saved) { setNotice('Draft saved. Reload the page to see it.'); return }
    const doc = saved
    setDocs((d) => (d.some((x) => x.id === doc.id) ? d : [doc, ...d]))
    setSelected(doc.id)
    setNotice(res.truncated ? 'This draft hit the length limit and may be cut off.' : res.jdTruncated ? 'The job description was shortened to fit.' : '')
  }

  async function saveLive(body: string): Promise<string | null> {
    if (!live) return null
    try {
      const created = await ctx.api.create({ roleId: role.id, kind: live.kind, title: `${DOC_KIND_LABEL[live.kind]} · partial`, body })
      ctx.runs.clear(role.id)
      setDocs((d) => [created, ...d]); setSelected(created.id); setNotice('')
      return null
    } catch (e) { return errorMessage(toRoleError(e)) }
  }

  async function saveDoc(id: string, body: string): Promise<string | null> {
    try {
      const updated = await ctx.api.update(id, { body })
      setDocs((d) => d.map((x) => (x.id === id ? updated : x)))
      return null
    } catch (e) { return errorMessage(toRoleError(e)) }
  }

  async function regenerate(current: Doc, instruction: string, body: string) {
    if (body !== current.body) {
      const err = await saveDoc(current.id, body)
      if (err) { setNotice(err); return }
    }
    await start(current.kind, { instruction, questions: current.questions, previousDocumentId: current.id })
  }

  async function removeDoc(id: string): Promise<string | null> {
    try {
      await ctx.api.remove(id)
      setDocs((d) => d.filter((x) => x.id !== id))
      setSelected((s) => (s === id ? null : s))
      return null
    } catch (e) { return errorMessage(toRoleError(e)) }
  }

  const current = live ? null : docs.find((d) => d.id === selected) ?? docs[0] ?? null
  const shownNotice = notice || runNotice

  return (
    <section className="docs" aria-label="Documents">
      <h3>Documents</h3>
      <JobDescription role={role} client={ctx.client} onSave={onSaveJobDescription} flushRef={flushJd} />
      <GenerateButtons profileReady={ctx.profileReady} busy={busy} onOpenProfile={ctx.onOpenProfile}
        onGenerate={(kind, o) => void start(kind, o)} />
      {shownNotice && <p className="banner" role="status">{shownNotice}</p>}
      {docs.length > 0 && (
        <ul className="draft-list">
          {docs.map((d) => (
            <li key={d.id}>
              <button type="button" disabled={busy} aria-pressed={!live && d.id === current?.id}
                onClick={() => { ctx.runs.clear(role.id); setNotice(''); setSelected(d.id) }}>{d.title}</button>
            </li>
          ))}
        </ul>
      )}
      {live && (
        <DraftEditor key={busy ? 'live' : 'live-done'} title={`${DOC_KIND_LABEL[live.kind]} · unsaved`} body={live.text} streaming={busy}
          onStop={() => ctx.runs.stop(role.id)} onSave={busy ? undefined : saveLive} />
      )}
      {current && (
        <DraftEditor key={current.id} title={current.title} body={current.body} streaming={false}
          onSave={(b) => saveDoc(current.id, b)} onRegenerate={(i, b) => void regenerate(current, i, b)} onDelete={() => removeDoc(current.id)} />
      )}
    </section>
  )
}
