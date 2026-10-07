import { describe, it, expect } from 'vitest'
import type { Role } from './types'
import { makeRole } from '../test/factories'
import {
  daysTo, filterRoles, sortRoles, stageCounts, deadlineTone,
  contractCountdown, formatDay, relativeTime, DEFAULT_FILTERS,
} from './pipeline'

// Local time in Europe/Amsterdam (tests run with TZ=Europe/Amsterdam)
const at = (y: number, m: number, d: number, h = 9, min = 0) => new Date(y, m - 1, d, h, min)

describe('daysTo', () => {
  it('returns null for no date', () => expect(daysTo(null, at(2026, 10, 6))).toBeNull())
  it('counts whole calendar days', () => expect(daysTo('2026-10-18', at(2026, 10, 6))).toBe(12))
  it('is 0 on the day itself, late at night', () => expect(daysTo('2026-10-06', at(2026, 10, 6, 23, 59))).toBe(0))
  it('is 1 the night before, across the DST change', () => expect(daysTo('2026-10-26', at(2026, 10, 25, 23, 30))).toBe(1))
  it('is 1 for 28 Oct seen at 23:30 on 27 Oct', () => expect(daysTo('2026-10-28', at(2026, 10, 27, 23, 30))).toBe(1))
  it('is negative once passed', () => expect(daysTo('2026-10-05', at(2026, 10, 6))).toBe(-1))
})

describe('deadlineTone', () => {
  const now = at(2026, 10, 6)
  it('none without a deadline', () => expect(deadlineTone(null, now)).toBe('none'))
  it('soon within 7 days', () => expect(deadlineTone('2026-10-13', now)).toBe('soon'))
  it('normal beyond 7 days', () => expect(deadlineTone('2026-10-14', now)).toBe('normal'))
  it('passed before today', () => expect(deadlineTone('2026-10-05', now)).toBe('passed'))
})

describe('filterRoles', () => {
  const now = at(2026, 10, 6)
  const roles = [
    makeRole({ id: 'a', market: 'UK', status: 'Applied', fit: 'Strong', notes: 'called Harnham' }),
    makeRole({ id: 'b', market: 'NL', status: 'Parked' }),
    makeRole({ id: 'c', market: 'NL', status: 'Shortlist', deadline: '2026-10-18' }),
    makeRole({ id: 'd', market: 'EU', status: 'Closed', deadline: '2026-10-10' }),
  ]
  const ids = (rs: Role[]) => rs.map((r) => r.id).sort()
  it('Active hides archived statuses', () => expect(ids(filterRoles(roles, DEFAULT_FILTERS, now))).toEqual(['a', 'c']))
  it('Archive shows only archived', () => expect(ids(filterRoles(roles, { ...DEFAULT_FILTERS, stage: 'Archive' }, now))).toEqual(['b', 'd']))
  it('a single stage', () => expect(ids(filterRoles(roles, { ...DEFAULT_FILTERS, stage: 'Applied' }, now))).toEqual(['a']))
  it('Due14 only counts active roles', () => expect(ids(filterRoles(roles, { ...DEFAULT_FILTERS, stage: 'Due14' }, now))).toEqual(['c']))
  it('market', () => expect(ids(filterRoles(roles, { ...DEFAULT_FILTERS, market: 'UK' }, now))).toEqual(['a']))
  it('fit', () => expect(ids(filterRoles(roles, { ...DEFAULT_FILTERS, fit: 'Strong' }, now))).toEqual(['a']))
  it('search is case-insensitive and covers notes', () => expect(ids(filterRoles(roles, { ...DEFAULT_FILTERS, query: 'HARNHAM' }, now))).toEqual(['a']))
})

describe('sortRoles', () => {
  const now = at(2026, 10, 6)
  it('orders by stage, then deadline, then fit, then posted', () => {
    const roles = [
      makeRole({ id: 'shortlist-late', status: 'Shortlist', deadline: '2026-10-30' }),
      makeRole({ id: 'offer', status: 'Offer' }),
      makeRole({ id: 'shortlist-soon', status: 'Shortlist', deadline: '2026-10-08' }),
      makeRole({ id: 'shortlist-passed', status: 'Shortlist', deadline: '2026-10-01', fit: 'Strong' }),
      makeRole({ id: 'shortlist-strong', status: 'Shortlist', fit: 'Strong', posted: '2026-09-01' }),
      makeRole({ id: 'shortlist-strong-new', status: 'Shortlist', fit: 'Strong', posted: '2026-10-02' }),
      makeRole({ id: 'applied', status: 'Applied' }),
      makeRole({ id: 'parked', status: 'Parked' }),
    ]
    expect(sortRoles(roles, now).map((r) => r.id)).toEqual([
      'offer', 'applied', 'shortlist-soon', 'shortlist-late',
      'shortlist-strong-new', 'shortlist-strong', 'shortlist-passed', 'parked',
    ])
  })
  it('does not mutate its input', () => {
    const roles = [makeRole({ id: 'x', status: 'Parked' }), makeRole({ id: 'y', status: 'Offer' })]
    sortRoles(roles, now)
    expect(roles.map((r) => r.id)).toEqual(['x', 'y'])
  })
})

describe('stageCounts', () => {
  it('counts each bucket', () => {
    const now = at(2026, 10, 6)
    const c = stageCounts([
      makeRole({ status: 'Shortlist', deadline: '2026-10-10' }),
      makeRole({ status: 'Applied' }),
      makeRole({ status: 'Rejected', deadline: '2026-10-10' }),
    ], now)
    expect(c).toEqual({ Active: 2, Shortlist: 1, Applied: 1, Interviewing: 0, Offer: 0, Due14: 1, Archive: 1 })
  })
})

describe('formatting', () => {
  it('contractCountdown counts to 31 Oct and floors at 0', () => {
    expect(contractCountdown(at(2026, 10, 6))).toBe(25)
    expect(contractCountdown(at(2026, 11, 5))).toBe(0)
  })
  it('formatDay', () => expect(formatDay('2026-10-18')).toBe('18 Oct'))
  it('relativeTime', () => {
    const now = new Date('2026-10-06T12:00:00Z')
    expect(relativeTime('2026-10-06T11:59:40Z', now)).toBe('just now')
    expect(relativeTime('2026-10-06T11:15:00Z', now)).toBe('45m ago')
    expect(relativeTime('2026-10-06T09:00:00Z', now)).toBe('3h ago')
    expect(relativeTime('2026-10-03T12:00:00Z', now)).toBe('3d ago')
  })
})
