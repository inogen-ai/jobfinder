import type { Role } from '../lib/types'

export function makeRole(over: Partial<Role> = {}): Role {
  return {
    id: 'r1', title: 'AI Engineer', org: 'Acme', market: 'NL', location: '', remote: '', rate: '',
    ir35: '', duration: '', posted: null, deadline: null, nextDate: null, fit: 'Good',
    status: 'Shortlist', why: '', caveat: '', url: '', contact: '', nextStep: '', notes: '', cv: '', jobDescription: '',
    createdAt: '2026-10-05T12:00:00Z', updatedAt: '2026-10-05T12:00:00Z', createdBy: null, updatedBy: null,
    ...over,
  }
}
