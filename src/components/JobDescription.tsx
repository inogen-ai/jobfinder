import { useState } from 'react'
import type { Role } from '../lib/types'
import { GenerateError, fetchErrorMessage, type GenerateClient } from '../lib/generate'

export function JobDescription({ role, client, onSave }: {
  role: Role; client: GenerateClient; onSave: (text: string) => Promise<string | null>
}) {
  const [text, setText] = useState(role.jobDescription)
  const [saved, setSaved] = useState(role.jobDescription)
  const [preview, setPreview] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  async function save(value: string) {
    setMsg('Saving…')
    const err = await onSave(value)
    if (!err) setSaved(value)
    setMsg(err ?? 'Saved')
  }

  async function fetchIt() {
    setBusy(true); setMsg('Fetching the posting…')
    try {
      const r = await client.fetchPosting(role.id)
      if ('text' in r) { setPreview(r.text); setMsg('') }
      else setMsg("This site doesn't allow fetching — paste the job description instead.")
    } catch (e) {
      setMsg(fetchErrorMessage(e instanceof GenerateError ? e : new GenerateError('upstream')))
    } finally { setBusy(false) }
  }

  return (
    <div className="jd">
      <label className="full"><span>Job description</span>
        <textarea id={`jd-${role.id}`} value={text} onChange={(e) => setText(e.target.value)}
          placeholder="Paste the full posting here, or fetch it from the link" /></label>
      {preview !== null && (
        <div className="jd-preview">
          <p className="lab">Fetched from the link. Check it before using it.</p>
          <pre>{preview}</pre>
          <div className="actions">
            <button type="button" className="btn primary" onClick={() => { setText(preview); setPreview(null); void save(preview) }}>Use this</button>
            <button type="button" className="btn" onClick={() => setPreview(null)}>Discard</button>
          </div>
        </div>
      )}
      <div className="actions">
        <button type="button" className="btn" disabled={!role.url || busy} onClick={fetchIt}>Fetch from link</button>
        {text !== saved && <button type="button" className="btn primary" onClick={() => save(text)}>Save description</button>}
        <span className="msg" role="status">{msg}</span>
      </div>
    </div>
  )
}
