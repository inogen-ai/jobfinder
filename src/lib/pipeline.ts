import { ACTIVE_STATUSES, CONTRACT_END, type Fit, type Market, type Role, type Status } from './types'

export type StageFilter = 'Active' | 'Shortlist' | 'Applied' | 'Interviewing' | 'Offer' | 'Due14' | 'Archive'

export interface Filters {
  stage: StageFilter
  market: Market | 'All'
  fit: Fit | 'Any'
  query: string
}

export const DEFAULT_FILTERS: Filters = { stage: 'Active', market: 'All', fit: 'Any', query: '' }

const DAY_MS = 86_400_000
const STAGE_RANK: Record<Status, number> = {
  Offer: 0, Interviewing: 1, Applied: 2, Shortlist: 3, Won: 4, Rejected: 5, Closed: 6, Parked: 7,
}
const FIT_RANK: Record<Fit, number> = { Strong: 0, Good: 1, Stretch: 2 }

/** Parse a YYYY-MM-DD date as local midnight (never UTC). */
export function parseDay(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function startOfDay(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate())
}

/** Whole calendar days from today to iso. Math.round absorbs 23h/25h DST days. */
export function daysTo(iso: string | null, now: Date = new Date()): number | null {
  if (!iso) return null
  return Math.round((parseDay(iso).getTime() - startOfDay(now).getTime()) / DAY_MS)
}

export function isActive(s: Status): boolean {
  return ACTIVE_STATUSES.includes(s)
}

export function isDueSoon(r: Role, now: Date = new Date()): boolean {
  const d = daysTo(r.deadline, now)
  return isActive(r.status) && d !== null && d >= 0 && d <= 14
}

export function filterRoles(roles: Role[], f: Filters, now: Date = new Date()): Role[] {
  const q = f.query.trim().toLowerCase()
  return roles.filter((r) => {
    if (f.stage === 'Active' && !isActive(r.status)) return false
    if (f.stage === 'Archive' && isActive(r.status)) return false
    if (f.stage === 'Due14' && !isDueSoon(r, now)) return false
    if ((ACTIVE_STATUSES as readonly string[]).includes(f.stage) && r.status !== f.stage) return false
    if (f.market !== 'All' && r.market !== f.market) return false
    if (f.fit !== 'Any' && r.fit !== f.fit) return false
    if (q) {
      const hay = [r.title, r.org, r.location, r.notes, r.why, r.contact, r.nextStep].join(' ').toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

export function sortRoles(roles: Role[], now: Date = new Date()): Role[] {
  const upcoming = (r: Role) => {
    const d = daysTo(r.deadline, now)
    return d !== null && d >= 0 ? d : Number.POSITIVE_INFINITY
  }
  return [...roles].sort((a, b) =>
    STAGE_RANK[a.status] - STAGE_RANK[b.status] ||
    (upcoming(a) === upcoming(b) ? 0 : upcoming(a) < upcoming(b) ? -1 : 1) ||
    FIT_RANK[a.fit] - FIT_RANK[b.fit] ||
    (b.posted ?? '').localeCompare(a.posted ?? ''),
  )
}

export function stageCounts(roles: Role[], now: Date = new Date()): Record<StageFilter, number> {
  const c: Record<StageFilter, number> = { Active: 0, Shortlist: 0, Applied: 0, Interviewing: 0, Offer: 0, Due14: 0, Archive: 0 }
  for (const r of roles) {
    if (isActive(r.status)) {
      c.Active++
      c[r.status as 'Shortlist' | 'Applied' | 'Interviewing' | 'Offer']++
    } else c.Archive++
    if (isDueSoon(r, now)) c.Due14++
  }
  return c
}

export function deadlineTone(iso: string | null, now: Date = new Date()): 'none' | 'normal' | 'soon' | 'passed' {
  const d = daysTo(iso, now)
  if (d === null) return 'none'
  if (d < 0) return 'passed'
  return d <= 7 ? 'soon' : 'normal'
}

export function contractCountdown(now: Date = new Date()): number {
  return Math.max(0, daysTo(CONTRACT_END, now) ?? 0)
}

export function formatDay(iso: string): string {
  return parseDay(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

export function relativeTime(iso: string, now: Date = new Date()): string {
  const mins = Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}
