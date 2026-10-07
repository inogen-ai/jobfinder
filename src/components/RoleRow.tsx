import type { ReactNode } from 'react'
import { STATUSES, type Role, type Status } from '../lib/types'
import { daysTo, deadlineTone, formatDay } from '../lib/pipeline'

export function RoleRow({ role, open, now, onToggle, onStatus, children, docCount }: {
  role: Role; open: boolean; now: Date; onToggle: () => void; onStatus: (s: Status) => void; children?: ReactNode; docCount?: number
}) {
  const tone = deadlineTone(role.deadline, now)
  const d = daysTo(role.deadline, now)
  return (
    <div className={`row${open ? ' open' : ''}`}>
      <div className="row-head" role="button" tabIndex={0} aria-expanded={open} onClick={onToggle}
        onKeyDown={(e) => {
          if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onToggle() }
        }}>
        <div className="c-role">
          <div className="role-t">{role.title}</div>
          <div className="role-o">
            {role.org}
            {docCount ? <span className="docs-badge">{docCount} docs</span> : null}
            {role.nextStep && <> · <span className="next">Next: {role.nextStep}{role.nextDate ? ` (${formatDay(role.nextDate)})` : ''}</span></>}
          </div>
        </div>
        <span className="mk c-mk">{role.market}</span>
        <div className="terms c-terms">
          <div className="rate">{role.rate || 'Rate not stated'}</div>
          <div className="muted">{[role.remote, role.ir35].filter(Boolean).join(' · ')}</div>
        </div>
        <div className="when c-when">
          {role.deadline
            ? <div className={tone === 'soon' ? 'soon' : tone === 'passed' ? 'over' : undefined}>
                {formatDay(role.deadline)}{tone === 'passed' ? ' · passed' : d !== null && d <= 14 ? ` · ${d}d` : ''}
              </div>
            : <div className="muted">none</div>}
          {role.posted && <div className="muted">posted {formatDay(role.posted)}</div>}
        </div>
        <span className={`fit c-fit ${role.fit}`}><i />{role.fit}</span>
        <div className="c-status" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          <select className={`pill st-${role.status}`} aria-label={`Status for ${role.title}`} value={role.status}
            onChange={(e) => onStatus(e.target.value as Status)}>
            {STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>
      </div>
      {open && children}
    </div>
  )
}
