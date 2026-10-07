import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import { CV_VERSIONS, FITS, type CvVersion, type Fit, type Role } from '../lib/types'
import type { RolePatch } from '../lib/roles'
import { displayName } from '../lib/auth'
import { relativeTime } from '../lib/pipeline'

interface Draft { nextStep: string; nextDate: string; rate: string; deadline: string; cv: string; fit: string; notes: string }

const draftFrom = (r: Role): Draft => ({
  nextStep: r.nextStep, nextDate: r.nextDate ?? '', rate: r.rate, deadline: r.deadline ?? '', cv: r.cv, fit: r.fit, notes: r.notes,
})

const toPatch = (d: Draft): RolePatch => ({
  nextStep: d.nextStep.trim(), nextDate: d.nextDate || null, rate: d.rate.trim(),
  deadline: d.deadline || null, cv: d.cv as CvVersion, fit: d.fit as Fit, notes: d.notes,
})

/** Only the fields this user changed, so concurrent edits to other fields are not overwritten. */
function changedFields(draft: Draft, initial: Draft): RolePatch {
  const now = toPatch(draft), before = toPatch(initial)
  return Object.fromEntries(
    Object.entries(now).filter(([k, v]) => v !== before[k as keyof RolePatch]),
  ) as RolePatch
}

export function RoleEditor({ role, now, onSave, onDelete }: {
  role: Role; now: Date; onSave: (p: RolePatch) => Promise<string | null>; onDelete: () => Promise<string | null>
}) {
  const [draft, setDraft] = useState<Draft>(() => draftFrom(role))
  const [initial, setInitial] = useState<Draft>(() => draftFrom(role))
  const [msg, setMsg] = useState('')
  const [confirming, setConfirming] = useState(false)

  // Reset only when a different role is shown, so a colleague's live edit never wipes this draft.
  useEffect(() => {
    setDraft(draftFrom(role))
    setInitial(draftFrom(role))
    setMsg('')
    setConfirming(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role.id])

  const field = (k: keyof Draft) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setDraft((d) => ({ ...d, [k]: e.target.value }))

  async function submit(e: FormEvent) {
    e.preventDefault()
    const patch = changedFields(draft, initial)
    if (Object.keys(patch).length === 0) { setMsg('No changes to save'); return }
    setMsg('Saving…')
    const err = await onSave(patch)
    if (!err) setInitial(draft)
    setMsg(err ?? 'Saved')
  }

  async function remove() {
    const err = await onDelete()
    if (err) setMsg(err)
  }

  const id = (k: string) => `ed-${role.id}-${k}`
  return (
    <div className="detail">
      <div className="facts">
        {role.why && <p><span className="lab">Why it fits</span>{role.why}</p>}
        {role.caveat && <p className="caveat"><span className="lab">Watch out</span>{role.caveat}</p>}
        <p><span className="lab">Terms</span>{[role.location, role.remote, role.rate, role.ir35, role.duration].filter(Boolean).join(' · ') || 'Not stated'}</p>
        {role.contact && <p><span className="lab">Contact</span><span className="mono selectable">{role.contact}</span></p>}
        {role.url && <p><a href={role.url} target="_blank" rel="noopener noreferrer">Open the posting ↗</a></p>}
        <p className="who">Updated by {displayName(role.updatedBy)}, {relativeTime(role.updatedAt, now)}</p>
      </div>
      <form className="form" onSubmit={submit}>
        <label><span>Next step</span>
          <input id={id('next')} value={draft.nextStep} onChange={field('nextStep')} placeholder="e.g. Call the recruiter" /></label>
        <label><span>Next step date</span>
          <input id={id('nextDate')} type="date" value={draft.nextDate} onChange={field('nextDate')} /></label>
        <label><span>Rate</span>
          <input id={id('rate')} value={draft.rate} onChange={field('rate')} /></label>
        <label><span>Deadline</span>
          <input id={id('deadline')} type="date" value={draft.deadline} onChange={field('deadline')} /></label>
        <label><span>CV version</span>
          <select id={id('cv')} value={draft.cv} onChange={field('cv')}>
            {CV_VERSIONS.map((c) => <option key={c} value={c}>{c ? `CV ${c}` : 'Not set'}</option>)}
          </select></label>
        <label><span>Fit</span>
          <select id={id('fit')} value={draft.fit} onChange={field('fit')}>
            {FITS.map((f) => <option key={f}>{f}</option>)}
          </select></label>
        <label className="full"><span>Notes</span>
          <textarea id={id('notes')} value={draft.notes} onChange={field('notes')} placeholder="Calls, rate discussed, who you spoke to" /></label>
        <div className="actions full">
          <button className="btn primary" type="submit">Save</button>
          {confirming
            ? <span className="confirm">Delete this role?
                <button type="button" className="btn danger" onClick={remove}>Delete role</button>
                <button type="button" className="btn" onClick={() => setConfirming(false)}>Keep</button>
              </span>
            : <button type="button" className="btn danger" onClick={() => setConfirming(true)}>Delete</button>}
          <span className="msg" role="status">{msg}</span>
        </div>
      </form>
    </div>
  )
}
