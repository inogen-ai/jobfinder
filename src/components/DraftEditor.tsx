import { useState, type ReactElement } from 'react'
import { docxFilename, markdownToDocx, parseMarkdown, saveBlob, type Inline } from '../lib/markdownDocx'

function renderInlines(inlines: Inline[]) {
  return inlines.map((i, k) => i.link
    ? <a key={k} href={i.link} target="_blank" rel="noopener noreferrer">{i.text}</a>
    : i.bold ? <strong key={k}>{i.text}</strong> : i.italic ? <em key={k}>{i.text}</em> : <span key={k}>{i.text}</span>)
}

/** Markdown preview built from parsed blocks: no HTML injection. */
function Preview({ markdown }: { markdown: string }) {
  const blocks = parseMarkdown(markdown)
  const out: ReactElement[] = []
  let list: { ordered: boolean; items: Inline[][] } | null = null
  const flush = () => {
    if (!list) return
    const items = list.items.map((it, k) => <li key={k}>{renderInlines(it)}</li>)
    out.push(list.ordered ? <ol key={out.length}>{items}</ol> : <ul key={out.length}>{items}</ul>)
    list = null
  }
  for (const b of blocks) {
    if (b.type === 'bullet' || b.type === 'numbered') {
      const ordered = b.type === 'numbered'
      if (!list || list.ordered !== ordered) { flush(); list = { ordered, items: [] } }
      list.items.push(b.inlines)
      continue
    }
    flush()
    if (b.type === 'heading') {
      const H = (`h${b.level + 2}`) as 'h3' | 'h4' | 'h5'
      out.push(<H key={out.length}>{renderInlines(b.inlines)}</H>)
    } else out.push(<p key={out.length}>{renderInlines(b.inlines)}</p>)
  }
  flush()
  return <div className="preview">{out}</div>
}

export function DraftEditor({ title, body, streaming, onStop, onSave, onRegenerate, onDelete }: {
  title: string; body: string; streaming: boolean
  onStop?: () => void
  onSave?: (body: string) => Promise<string | null>
  onRegenerate?: (instruction: string, currentBody: string) => void
  onDelete?: () => Promise<string | null>
}) {
  const [text, setText] = useState(body)
  const [tab, setTab] = useState<'edit' | 'preview'>('edit')
  const [instruction, setInstruction] = useState('')
  const [msg, setMsg] = useState('')
  const [confirming, setConfirming] = useState(false)
  const value = streaming ? body : text

  async function copy() {
    try { await navigator.clipboard.writeText(value); setMsg('Copied') }
    catch { setMsg('Select the text and copy it manually.') }
  }
  async function download() {
    saveBlob(await markdownToDocx(value, title), docxFilename(title))
  }

  return (
    <div className="draft">
      <div className="draft-head">
        <strong>{title}</strong>
        <div className="tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'edit'} onClick={() => setTab('edit')}>Edit</button>
          <button type="button" role="tab" aria-selected={tab === 'preview'} onClick={() => setTab('preview')}>Preview</button>
        </div>
      </div>
      {tab === 'edit'
        ? <label className="full"><span className="sr-only">Draft</span>
            <textarea className="draft-text" aria-label="Draft" readOnly={streaming} value={value} onChange={(e) => setText(e.target.value)} /></label>
        : <Preview markdown={value} />}
      <div className="actions">
        {streaming ? <button type="button" className="btn" onClick={onStop}>Stop</button> : (
          <>
            {onSave && <button type="button" className="btn primary" onClick={async () => { setMsg('Saving…'); setMsg((await onSave(text)) ?? 'Saved') }}>Save</button>}
            <button type="button" className="btn" onClick={copy}>Copy</button>
            <button type="button" className="btn" onClick={download}>Download .docx</button>
            {onDelete && (confirming
              ? <span className="confirm">Delete this draft?
                  <button type="button" className="btn danger" onClick={async () => setMsg((await onDelete()) ?? '')}>Delete draft</button>
                  <button type="button" className="btn" onClick={() => setConfirming(false)}>Keep</button></span>
              : <button type="button" className="btn danger" onClick={() => setConfirming(true)}>Delete</button>)}
          </>
        )}
        <span className="msg" role="status">{msg}</span>
      </div>
      {!streaming && onRegenerate && (
        <div className="actions regen">
          <label><span className="sr-only">Regenerate instruction</span>
            <input aria-label="Regenerate instruction" value={instruction} maxLength={1000} onChange={(e) => setInstruction(e.target.value)} placeholder="What should change? e.g. shorter, more on GCP" /></label>
          <button type="button" className="btn" onClick={() => onRegenerate(instruction, text)}>Regenerate</button>
        </div>
      )}
    </div>
  )
}
