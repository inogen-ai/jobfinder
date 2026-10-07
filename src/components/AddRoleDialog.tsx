import { useState, type FormEvent } from 'react'
import { FITS, MARKETS, type Fit, type Market } from '../lib/types'
import { newRoleId, type RoleInput } from '../lib/roles'

const TEXT_FIELDS: Array<[keyof RoleInput, string, string?]> = [
  ['title', 'Role title'], ['org', 'Company or agency'], ['location', 'Location'], ['remote', 'Remote terms', 'e.g. Fully remote'],
  ['rate', 'Rate'], ['ir35', 'IR35 / contract type'], ['url', 'Link to posting', 'https://'], ['why', 'Why it fits'],
]

export function AddRoleDialog({ onCreate, onClose }: {
  onCreate: (input: RoleInput) => Promise<string | null>; onClose: () => void
}) {
  const [v, setV] = useState<Record<string, string>>({ market: 'UK', fit: 'Good' })
  const [msg, setMsg] = useState('')
  const set = (k: string) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }))

  async function submit(e: FormEvent) {
    e.preventDefault()
    const title = (v.title ?? '').trim(), org = (v.org ?? '').trim()
    if (!title || !org) { setMsg('Add a role title and a company.'); return }
    setMsg('Adding…')
    const err = await onCreate({
      id: newRoleId(v.market, org, title), title, org, market: v.market as Market, fit: v.fit as Fit, status: 'Shortlist',
      location: v.location ?? '', remote: v.remote ?? '', rate: v.rate ?? '', ir35: v.ir35 ?? '', duration: '',
      posted: v.posted || null, deadline: v.deadline || null, nextDate: null, why: v.why ?? '', caveat: '',
      url: v.url ?? '', contact: '', nextStep: '', notes: '', cv: '',
    })
    if (err) setMsg(err)
  }

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="add-title" onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === 'Escape') onClose() }}>
        <h2 id="add-title">Add a role</h2>
        <form className="form" onSubmit={submit}>
          {TEXT_FIELDS.map(([k, label, ph]) => (
            <label key={k} className={k === 'title' || k === 'url' || k === 'why' ? 'full' : undefined}>
              <span>{label}</span>
              <input id={`add-${k}`} value={v[k] ?? ''} placeholder={ph} onChange={set(k)} autoFocus={k === 'title'} />
            </label>
          ))}
          <label><span>Market</span>
            <select id="add-market" value={v.market} onChange={set('market')}>{MARKETS.map((m) => <option key={m}>{m}</option>)}</select>
          </label>
          <label><span>Fit</span>
            <select id="add-fit" value={v.fit} onChange={set('fit')}>{FITS.map((f) => <option key={f}>{f}</option>)}</select>
          </label>
          <label><span>Posted</span><input id="add-posted" type="date" value={v.posted ?? ''} onChange={set('posted')} /></label>
          <label><span>Deadline</span><input id="add-deadline" type="date" value={v.deadline ?? ''} onChange={set('deadline')} /></label>
          <div className="actions full">
            <button className="btn primary" type="submit">Add role</button>
            <button className="btn" type="button" onClick={onClose}>Cancel</button>
            <span className="msg" role="status">{msg}</span>
          </div>
        </form>
      </div>
    </div>
  )
}
