import { useEffect, useRef, useState } from 'react'
import type { Role } from '../lib/types'
import { DOC_KIND_LABEL, type Doc, type DocKind, type DocumentsApi } from '../lib/documents'
import { GenerateError, generateErrorMessage, type GenerateClient } from '../lib/generate'
import { errorMessage, toRoleError } from '../lib/roles'
import { JobDescription } from './JobDescription'
import { GenerateButtons } from './GenerateButtons'
import { DraftEditor } from './DraftEditor'

export interface DocsContext { api: DocumentsApi; client: GenerateClient; profileReady: boolean; onOpenProfile: () => void; onAuthError?: () => void }

export function DocumentsPanel({ role, ctx, onSaveJobDescription, onCountChange }: {
  role: Role; ctx: DocsContext
  onSaveJobDescription: (text: string) => Promise<string | null>
  onCountChange: (roleId: string, count: number) => void
}) {
  const [docs, setDocs] = useState<Doc[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [live, setLive] = useState<{ kind: DocKind; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [loaded, setLoaded] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const flushJd = useRef<(() => Promise<string | null>) | null>(null)
  const countRef = useRef(onCountChange)
  useEffect(() => { countRef.current = onCountChange })

  useEffect(() => {
    let on = true
    ctx.api.list(role.id)
      .then((d) => { if (on) { setDocs(d); setSelected(d[0]?.id ?? null); setLoaded(true) } })
      .catch(() => { if (on) setNotice("Couldn't load your drafts.") })
    return () => { on = false; abortRef.current?.abort() }
  }, [ctx.api, role.id])

  // The badge follows the list; every change below goes through a functional update, so no stale copies.
  useEffect(() => { if (loaded) countRef.current(role.id, docs.length) }, [loaded, docs.length, role.id])

  async function run(kind: DocKind, opts: { instruction?: string; questions?: string; previousDocumentId?: string | null }) {
    const jdError = await flushJd.current?.()
    if (jdError) { setNotice(jdError); return }
    const controller = new AbortController()
    abortRef.current = controller
    const previouslySelected = selected
    setBusy(true); setNotice(''); setSelected(null); setLive({ kind, text: '' })
    try {
      const res = await ctx.client.generate({ roleId: role.id, kind, ...opts }, {
        signal: controller.signal,
        onDelta: (t) => setLive((l) => (l ? { ...l, text: l.text + t } : l)),
        onReset: () => setLive((l) => (l ? { ...l, text: '' } : l)),
      })
      const saved = await ctx.api.get(res.documentId)
      setDocs((d) => [saved, ...d])
      setLive(null); setSelected(saved.id)
      setNotice(res.truncated ? 'This draft hit the length limit and may be cut off.' : res.jdTruncated ? 'The job description was shortened to fit.' : '')
    } catch (e) {
      const err = e instanceof GenerateError ? e : new GenerateError('upstream')
      if (err.code === 'unauthorized') ctx.onAuthError?.()
      setNotice(generateErrorMessage(err))
      // Keep partial text so it can be copied or saved; with nothing written, go back to the previous draft.
      setLive((l) => (l && l.text ? l : null))
      setSelected((s) => s ?? previouslySelected)
    } finally {
      setBusy(false)
      abortRef.current = null
    }
  }

  async function saveLive(body: string): Promise<string | null> {
    if (!live) return null
    try {
      const created = await ctx.api.create({ roleId: role.id, kind: live.kind, title: `${DOC_KIND_LABEL[live.kind]} · partial`, body })
      setDocs((d) => [created, ...d]); setLive(null); setSelected(created.id); setNotice('')
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
    await run(current.kind, { instruction, questions: current.questions, previousDocumentId: current.id })
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

  return (
    <section className="docs" aria-label="Documents">
      <h3>Documents</h3>
      <JobDescription role={role} client={ctx.client} onSave={onSaveJobDescription} flushRef={flushJd} />
      <GenerateButtons profileReady={ctx.profileReady} busy={busy} onOpenProfile={ctx.onOpenProfile}
        onGenerate={(kind, o) => void run(kind, o)} />
      {notice && <p className="banner" role="status">{notice}</p>}
      {docs.length > 0 && (
        <ul className="draft-list">
          {docs.map((d) => (
            <li key={d.id}>
              <button type="button" disabled={busy} aria-pressed={!live && d.id === current?.id} onClick={() => { setLive(null); setSelected(d.id) }}>{d.title}</button>
            </li>
          ))}
        </ul>
      )}
      {live && (
        <DraftEditor key={busy ? 'live' : 'live-done'} title={`${DOC_KIND_LABEL[live.kind]} · unsaved`} body={live.text} streaming={busy}
          onStop={() => abortRef.current?.abort()} onSave={busy ? undefined : saveLive} />
      )}
      {current && (
        <DraftEditor key={current.id} title={current.title} body={current.body} streaming={false}
          onSave={(b) => saveDoc(current.id, b)} onRegenerate={(i, b) => void regenerate(current, i, b)} onDelete={() => removeDoc(current.id)} />
      )}
    </section>
  )
}
