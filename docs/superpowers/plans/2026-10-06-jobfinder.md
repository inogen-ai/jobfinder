# jobfinder.inogen.ai Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A shared freelance-role tracker at `jobfinder.inogen.ai`, open only to `@inogen.ai` Microsoft accounts. It replaces the claude.ai Contract Pipeline artifact.

**Architecture:**
- A static Vite + React + TypeScript app, served by GitHub Pages.
- Supabase provides Postgres, Auth (Azure/Entra provider) and Realtime.
- Security comes from a single-tenant Entra app plus a row-level security (RLS) policy that only admits `@inogen.ai` emails.
- `src/lib/roles.ts` is the only module that talks to the database. UI components get data through a `RolesApi` interface so they can be tested with fakes.
- Python scripts use the service key, for migration and for Claude adding roles.

**Tech Stack:** Node 22, Vite, React 18+, TypeScript, `@supabase/supabase-js` v2, Vitest + Testing Library + jsdom, Playwright, Supabase CLI + pgTAP, Python 3.11+ via `uv` (standard library only), GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-06-jobfinder-design.md`

## Global Constraints

- **Domain and hosting:** `jobfinder.inogen.ai`. Repo `inogen-ai/jobfinder`, GitHub Pages deployed by GitHub Actions. `public/CNAME` contains exactly `jobfinder.inogen.ai`.
- **Supabase:** project `jobfinder` in region `eu-central-1` (Frankfurt).
- **Sign-in:** Supabase Azure provider with `scopes: 'email'`. Only emails whose domain is exactly `inogen.ai` (case-insensitive) are allowed.
- **RLS:** enabled on `public.roles`. No anonymous access. All four operations are gated on an `@inogen.ai` JWT email.
- **Fixed values:**
  - Markets: `UK`, `NL`, `EU`, `Global`.
  - Fits: `Strong`, `Good`, `Stretch`.
  - Statuses: `Shortlist`, `Applied`, `Interviewing`, `Offer`, `Won`, `Rejected`, `Closed`, `Parked`.
  - Active statuses: `Shortlist`, `Applied`, `Interviewing`, `Offer`.
  - CV versions: `''`, `A`, `B`.
- **Contract end date** for the countdown: `2026-10-31`.
- **Sort order:** stage (Offer → Interviewing → Applied → Shortlist → Won → Rejected → Closed → Parked), then nearest non-passed deadline, then fit (Strong → Good → Stretch), then most recently posted.
- **Deadline colours:** within 7 days = amber (`soon`); passed = red (`over`).
- **Copy strings, used verbatim:**
  - "Couldn't save. Check your connection and try again."
  - "This tracker is limited to InoGen accounts."
  - "Live updates paused. Reconnecting…"
  - "Sign in with Microsoft"
- **Never deploy to, or create resources with, a client's cloud account or project; use InoGen accounts only.**
- **The repo is public:** the anon key is public by design. `seed/` (exported roles, which contain recruiter contacts) and `.env` (service key) must be git-ignored and never committed.
- **Service key:** `SUPABASE_SERVICE_ROLE_KEY` lives only in a local `.env`.
- **Tests run with `TZ=Europe/Amsterdam`.**

## Review Focus

1. **Dates near midnight and across the DST change (clocks go back on 25 Oct 2026 in Europe/Amsterdam).** A deadline of "2026-10-26" viewed at 23:30 on 25 Oct must read as 1 day, not 0 or 2. The test lives in Task 1.
2. **Look-alike and mixed-case emails.** `Mike@InoGen.AI` must be allowed. `eve@inogen.ai.evil.com`, `eve@notinogen.ai` and `eve@example.com` must be refused, in both the client and the database. Tests are in Tasks 2 and 4.
3. **Clearing a date field.** Emptying "Deadline" must save `null`, not `''` (Postgres rejects `''` for a date). Tests are in Tasks 3 and 7.
4. **A colleague's live edit arrives while your editor is open.** Your unsaved draft must survive; only switching to a different role resets the form. The test is in Task 7.
5. **Saving a role someone else just deleted.** You should see "This role was deleted by someone else." and the editor should close, with no crash. Tests are in Tasks 3 and 7.

---

## File structure

```
jobfinder/
  index.html                       fonts + title
  package.json, vite.config.ts, tsconfig*.json, eslint.config.js (from Vite template)
  playwright.config.ts
  .env.example  .env.e2e  .gitignore
  public/CNAME
  src/
    main.tsx                       React root, imports styles.css
    App.tsx                        session gate: SignIn vs Pipeline
    styles.css                     tokens + layout (ported from docs/reference/contract-pipeline.html)
    lib/types.ts                   Role type + fixed-value constants
    lib/pipeline.ts                pure: dates, filter, sort, counts, formatting
    lib/filterStorage.ts           localStorage load/save with validation
    lib/auth.ts                    isAllowedEmail, displayName
    lib/roles.ts                   row mapping, applyChange, RoleError, createRolesApi
    lib/supabase.ts                client singleton
    hooks/useSession.ts            session state + sign-in/out
    components/SignIn.tsx
    components/StageStrip.tsx
    components/Filters.tsx         FilterBar
    components/RoleRow.tsx
    components/RoleEditor.tsx
    components/AddRoleDialog.tsx
    components/Pipeline.tsx        page; owns roles state + realtime
    test/setup.ts                  jest-dom
    test/factories.ts              makeRole test factory
  e2e/smoke.spec.ts
  supabase/migrations/20261006120000_roles.sql
  supabase/tests/rls.test.sql
  scripts/supabase_rest.py         env loading + REST upsert
  scripts/migrate_from_artifact.py
  scripts/add_role.py
  scripts/tests/test_rows.py
  .github/workflows/ci.yml
  .github/workflows/pages.yml
  README.md
```

---

### Task 1: Scaffold, domain types and pipeline logic

**Files:**
- Create: the Vite template files, `src/lib/types.ts`, `src/lib/pipeline.ts`, `src/lib/pipeline.test.ts`, `src/test/setup.ts`, `src/test/factories.ts`, `.gitignore`, `.env.example`
- Modify: `vite.config.ts`, `package.json`

**Interfaces:**
- Produces (`src/test/factories.ts`): `makeRole(over?: Partial<Role>): Role`.
- Produces (`src/lib/types.ts`): `MARKETS`, `Market`, `FITS`, `Fit`, `STATUSES`, `Status`, `ACTIVE_STATUSES`, `CV_VERSIONS`, `CvVersion`, `CONTRACT_END`, `interface Role`.
- Produces (`src/lib/pipeline.ts`):
  - `StageFilter`, `Filters`, `DEFAULT_FILTERS`
  - `parseDay(iso: string): Date`, `daysTo(iso: string | null, now?: Date): number | null`
  - `isActive(s: Status): boolean`, `isDueSoon(r: Role, now?: Date): boolean`
  - `filterRoles(roles: Role[], f: Filters, now?: Date): Role[]`, `sortRoles(roles: Role[], now?: Date): Role[]`
  - `stageCounts(roles: Role[], now?: Date): Record<StageFilter, number>`
  - `deadlineTone(iso: string | null, now?: Date): 'none' | 'normal' | 'soon' | 'passed'`
  - `contractCountdown(now?: Date): number`, `formatDay(iso: string): string`, `relativeTime(iso: string, now?: Date): string`

- [ ] **Step 1: Scaffold the Vite app into the existing repo**

```bash
cd /Users/mike/Documents/Projects/jobfinder
npm create vite@latest jobfinder-tmp -- --template react-ts
rsync -a jobfinder-tmp/ ./ && rm -rf jobfinder-tmp
rm -rf src/assets src/App.css src/index.css public/vite.svg
npm install
npm install @supabase/supabase-js
npm install -D vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event @playwright/test
```
If `create vite` asks whether to install and start the app, answer **No**.

- [ ] **Step 2: Configure Vitest, scripts and ignores**

Replace `vite.config.ts`:

```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
```

Create `src/test/setup.ts`:

```ts
import '@testing-library/jest-dom/vitest'
```

In `package.json`, set `"scripts"` to:

```json
{
  "dev": "vite",
  "build": "tsc -b && vite build",
  "preview": "vite preview",
  "lint": "eslint .",
  "typecheck": "tsc -b",
  "test": "TZ=Europe/Amsterdam vitest run",
  "test:watch": "TZ=Europe/Amsterdam vitest",
  "e2e": "playwright test"
}
```

Append to `.gitignore`:

```
.env
.env.local
seed/
playwright-report/
test-results/
__pycache__/
```

Create `.env.example`:

```
# Browser app (public by design)
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>
# Local scripts only. NEVER commit.
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service role key>
```

- [ ] **Step 3: Write `src/lib/types.ts`**

```ts
export const MARKETS = ['UK', 'NL', 'EU', 'Global'] as const
export type Market = (typeof MARKETS)[number]

export const FITS = ['Strong', 'Good', 'Stretch'] as const
export type Fit = (typeof FITS)[number]

export const STATUSES = ['Shortlist', 'Applied', 'Interviewing', 'Offer', 'Won', 'Rejected', 'Closed', 'Parked'] as const
export type Status = (typeof STATUSES)[number]
export const ACTIVE_STATUSES: readonly Status[] = ['Shortlist', 'Applied', 'Interviewing', 'Offer']

export const CV_VERSIONS = ['', 'A', 'B'] as const
export type CvVersion = (typeof CV_VERSIONS)[number]

export const CONTRACT_END = '2026-10-31'

export interface Role {
  id: string
  title: string
  org: string
  market: Market
  location: string
  remote: string
  rate: string
  ir35: string
  duration: string
  posted: string | null
  deadline: string | null
  nextDate: string | null
  fit: Fit
  status: Status
  why: string
  caveat: string
  url: string
  contact: string
  nextStep: string
  notes: string
  cv: CvVersion
  createdAt: string
  updatedAt: string
  createdBy: string | null
  updatedBy: string | null
}
```

- [ ] **Step 4: Write the test factory and the failing tests**

`src/test/factories.ts` (shared by all component and lib tests):

```ts
import type { Role } from '../lib/types'

export function makeRole(over: Partial<Role> = {}): Role {
  return {
    id: 'r1', title: 'AI Engineer', org: 'Acme', market: 'NL', location: '', remote: '', rate: '',
    ir35: '', duration: '', posted: null, deadline: null, nextDate: null, fit: 'Good',
    status: 'Shortlist', why: '', caveat: '', url: '', contact: '', nextStep: '', notes: '', cv: '',
    createdAt: '2026-10-05T12:00:00Z', updatedAt: '2026-10-05T12:00:00Z', createdBy: null, updatedBy: null,
    ...over,
  }
}
```

`src/lib/pipeline.test.ts`:

```ts
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
```

- [ ] **Step 5: Run the tests and confirm they fail**

Run: `npm test -- src/lib/pipeline.test.ts`
Expected: FAIL with "Failed to resolve import "./pipeline"".

- [ ] **Step 6: Write `src/lib/pipeline.ts`**

```ts
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
```

The sort tie-breaks: `shortlist-passed` has a passed deadline, which counts as "no upcoming deadline". Among the Strong-fit Shortlist roles with no upcoming deadline, the newest posted date comes first: 2026-10-02, then 2026-09-01, then no date.

- [ ] **Step 7: Run the tests and confirm they pass**

Run: `npm test -- src/lib/pipeline.test.ts`
Expected: PASS (all tests).

- [ ] **Step 8: Lint, typecheck and commit**

```bash
npm run lint && npm run typecheck
git add -A
git commit -m "feat: scaffold Vite app with pipeline domain logic

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Auth and filter-storage helpers

**Files:**
- Create: `src/lib/auth.ts`, `src/lib/auth.test.ts`, `src/lib/filterStorage.ts`, `src/lib/filterStorage.test.ts`

**Interfaces:**
- Consumes: `Filters`, `DEFAULT_FILTERS`, `StageFilter` from `src/lib/pipeline.ts`; `MARKETS`, `FITS` from `src/lib/types.ts`.
- Produces:
  - `ALLOWED_DOMAIN = 'inogen.ai'`
  - `isAllowedEmail(email: string | null | undefined): boolean`
  - `displayName(who: string | null | undefined): string`
  - `loadFilters(storage?: Storage): Filters`, `saveFilters(f: Filters, storage?: Storage): void`

- [ ] **Step 1: Write the failing tests**

`src/lib/auth.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { isAllowedEmail, displayName } from './auth'

describe('isAllowedEmail', () => {
  it.each(['michael.snow@inogen.ai', 'Mike@InoGen.AI'])('allows %s', (e) => expect(isAllowedEmail(e)).toBe(true))
  it.each([
    'eve@inogen.ai.evil.com', 'eve@notinogen.ai', 'eve@example.com', 'inogen.ai', '@inogen.ai', '', null, undefined,
  ])('refuses %s', (e) => expect(isAllowedEmail(e)).toBe(false))
})

describe('displayName', () => {
  it('uses the first name of an email', () => expect(displayName('herman.wigge@inogen.ai')).toBe('Herman'))
  it('labels the script writer', () => expect(displayName('claude-script')).toBe('Claude'))
  it('falls back', () => expect(displayName(null)).toBe('Someone'))
})
```

`src/lib/filterStorage.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { loadFilters, saveFilters } from './filterStorage'
import { DEFAULT_FILTERS } from './pipeline'

describe('filterStorage', () => {
  beforeEach(() => localStorage.clear())
  it('returns defaults when empty', () => expect(loadFilters()).toEqual(DEFAULT_FILTERS))
  it('round-trips', () => {
    const f = { stage: 'Applied', market: 'UK', fit: 'Strong', query: 'rag' } as const
    saveFilters(f)
    expect(loadFilters()).toEqual(f)
  })
  it('ignores corrupt JSON', () => {
    localStorage.setItem('jobfinder-filters', '{nope')
    expect(loadFilters()).toEqual(DEFAULT_FILTERS)
  })
  it('replaces unknown values field by field', () => {
    localStorage.setItem('jobfinder-filters', JSON.stringify({ stage: 'Bogus', market: 'NL', fit: 7, query: 'x' }))
    expect(loadFilters()).toEqual({ ...DEFAULT_FILTERS, market: 'NL', query: 'x' })
  })
  it('survives storage that throws', () => {
    const broken = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } } as unknown as Storage
    expect(loadFilters(broken)).toEqual(DEFAULT_FILTERS)
    expect(() => saveFilters(DEFAULT_FILTERS, broken)).not.toThrow()
  })
})
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm test -- src/lib/auth.test.ts src/lib/filterStorage.test.ts`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement**

`src/lib/auth.ts`:

```ts
export const ALLOWED_DOMAIN = 'inogen.ai'

export function isAllowedEmail(email: string | null | undefined): boolean {
  if (!email) return false
  const at = email.lastIndexOf('@')
  return at > 0 && email.slice(at + 1).toLowerCase() === ALLOWED_DOMAIN
}

export function displayName(who: string | null | undefined): string {
  if (!who) return 'Someone'
  if (who === 'claude-script') return 'Claude'
  const local = who.split('@')[0]
  const first = local.split(/[._-]/)[0]
  return first ? first[0].toUpperCase() + first.slice(1) : 'Someone'
}
```

`src/lib/filterStorage.ts`:

```ts
import { FITS, MARKETS } from './types'
import { DEFAULT_FILTERS, type Filters, type StageFilter } from './pipeline'

const KEY = 'jobfinder-filters'
const STAGES: readonly StageFilter[] = ['Active', 'Shortlist', 'Applied', 'Interviewing', 'Offer', 'Due14', 'Archive']

function defaultStorage(): Storage | undefined {
  try { return window.localStorage } catch { return undefined }
}

export function loadFilters(storage: Storage | undefined = defaultStorage()): Filters {
  let raw: unknown
  try { raw = JSON.parse(storage?.getItem(KEY) ?? 'null') } catch { return { ...DEFAULT_FILTERS } }
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_FILTERS }
  const r = raw as Record<string, unknown>
  return {
    stage: STAGES.includes(r.stage as StageFilter) ? (r.stage as StageFilter) : DEFAULT_FILTERS.stage,
    market: r.market === 'All' || (MARKETS as readonly unknown[]).includes(r.market) ? (r.market as Filters['market']) : DEFAULT_FILTERS.market,
    fit: r.fit === 'Any' || (FITS as readonly unknown[]).includes(r.fit) ? (r.fit as Filters['fit']) : DEFAULT_FILTERS.fit,
    query: typeof r.query === 'string' ? r.query : DEFAULT_FILTERS.query,
  }
}

export function saveFilters(f: Filters, storage: Storage | undefined = defaultStorage()): void {
  try { storage?.setItem(KEY, JSON.stringify(f)) } catch { /* per-browser convenience only */ }
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm test -- src/lib/auth.test.ts src/lib/filterStorage.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth.ts src/lib/auth.test.ts src/lib/filterStorage.ts src/lib/filterStorage.test.ts
git commit -m "feat: add email allow-list and filter persistence helpers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Roles data layer

**Files:**
- Create: `src/lib/roles.ts`, `src/lib/roles.test.ts`

**Interfaces:**
- Consumes: `Role` and the constants from `types.ts`.
- Produces:
  - `RoleRow` (snake_case DB row), `RoleInput = Omit<Role, 'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy'>`, `RolePatch = Partial<Omit<RoleInput, 'id'>>`
  - `rowToRole(r: RoleRow): Role`, `patchToRow(p: RolePatch): Partial<RoleRow>`, `roleInputToRow(i: RoleInput): Partial<RoleRow>`
  - `newRoleId(market: string, org: string, title: string, now?: number): string`
  - `RoleChange = { type: 'upsert'; role: Role } | { type: 'delete'; id: string }`, `applyChange(roles: Role[], c: RoleChange): Role[]`
  - `RoleErrorKind = 'auth' | 'missing' | 'network' | 'other'`, `class RoleError`, `toRoleError(e: unknown): RoleError`, `errorMessage(e: RoleError): string`
  - `LiveStatus = 'live' | 'paused'`
  - `interface RolesApi { list(); create(input); update(id, patch); remove(id); subscribe(onChange, onStatus): () => void }`
  - `createRolesApi(sb: SupabaseClient): RolesApi`

- [ ] **Step 1: Write the failing tests `src/lib/roles.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  rowToRole, patchToRow, roleInputToRow, newRoleId, applyChange, toRoleError, errorMessage,
  createRolesApi, RoleError, type RoleRow,
} from './roles'

const row: RoleRow = {
  id: 'nl-x', title: 'AI Engineer', org: 'Interex', market: 'NL', location: 'Den Haag', remote: '', rate: '',
  ir35: '', duration: '', posted: '2026-09-18', deadline: '2026-10-18', next_date: null, fit: 'Strong',
  status: 'Shortlist', why: 'RAG', caveat: '', url: 'https://x', contact: '', next_step: 'Send CV', notes: '',
  cv: 'A', created_at: '2026-10-06T10:00:00Z', updated_at: '2026-10-06T11:00:00Z',
  created_by: 'claude-script', updated_by: 'michael.snow@inogen.ai',
}

describe('mapping', () => {
  it('rowToRole camel-cases', () => {
    const r = rowToRole(row)
    expect(r.nextStep).toBe('Send CV')
    expect(r.nextDate).toBeNull()
    expect(r.updatedBy).toBe('michael.snow@inogen.ai')
  })
  it('patchToRow snake-cases and turns empty dates into null', () => {
    expect(patchToRow({ nextStep: 'Call', deadline: '', nextDate: '', posted: '2026-10-01', status: 'Applied' }))
      .toEqual({ next_step: 'Call', deadline: null, next_date: null, posted: '2026-10-01', status: 'Applied' })
  })
  it('patchToRow drops undefined keys', () => expect(patchToRow({ notes: undefined })).toEqual({}))
  it('roleInputToRow keeps the id and ignores audit fields', () => {
    const out = roleInputToRow({ ...rowToRole(row) })
    expect(out).toMatchObject({ id: 'nl-x', next_step: 'Send CV' })
    expect(out).not.toHaveProperty('created_at')
  })
})

describe('newRoleId', () => {
  it('slugs market, org and title with a time suffix', () =>
    expect(newRoleId('NL', 'Morgan Black', 'GCP Data/AI Engineer', 1_760_000_000_000)).toBe('nl-morgan-black-gcp-data-ai-engineer-mgj6k3cw'))
})

describe('applyChange', () => {
  const a = rowToRole(row)
  it('inserts new roles', () => expect(applyChange([], { type: 'upsert', role: a })).toEqual([a]))
  it('replaces existing roles', () => {
    const b = { ...a, notes: 'x' }
    expect(applyChange([a], { type: 'upsert', role: b })).toEqual([b])
  })
  it('deletes', () => expect(applyChange([a], { type: 'delete', id: 'nl-x' })).toEqual([]))
  it('ignores deletes of unknown ids', () => expect(applyChange([a], { type: 'delete', id: 'zz' })).toEqual([a]))
})

describe('toRoleError', () => {
  it.each([
    [{ code: 'PGRST116', message: '0 rows' }, 'missing'],
    [{ code: '42501', message: 'row-level security' }, 'auth'],
    [{ code: 'PGRST301', message: 'JWT expired' }, 'auth'],
    [{ status: 401, message: 'unauthorised' }, 'auth'],
    [new TypeError('Failed to fetch'), 'network'],
    [{ code: '23505', message: 'duplicate' }, 'other'],
  ])('%o → %s', (e, kind) => expect(toRoleError(e).kind).toBe(kind))
  it('messages', () => {
    expect(errorMessage(new RoleError('x', 'missing'))).toBe('This role was deleted by someone else.')
    expect(errorMessage(new RoleError('x', 'network'))).toBe("Couldn't save. Check your connection and try again.")
  })
})

/** Chainable fake of supabase.from(...): every method returns the builder; awaiting it yields `result`. */
function fakeSb(result: { data: unknown; error: unknown }) {
  const calls: Array<[string, unknown[]]> = []
  const builder: unknown = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'then') return (resolve: (v: unknown) => void) => resolve(result)
      return (...args: unknown[]) => { calls.push([String(prop), args]); return builder }
    },
  })
  const client = { from: (t: string) => { calls.push(['from', [t]]); return builder } } as unknown as SupabaseClient
  return { client, calls }
}

describe('createRolesApi', () => {
  it('list maps rows', async () => {
    const { client } = fakeSb({ data: [row], error: null })
    expect((await createRolesApi(client).list())[0].id).toBe('nl-x')
  })
  it('update sends snake_case and filters by id', async () => {
    const { client, calls } = fakeSb({ data: row, error: null })
    await createRolesApi(client).update('nl-x', { nextStep: 'Call' })
    expect(calls).toContainEqual(['update', [{ next_step: 'Call' }]])
    expect(calls).toContainEqual(['eq', ['id', 'nl-x']])
  })
  it('update of a deleted role throws missing', async () => {
    const { client } = fakeSb({ data: null, error: { code: 'PGRST116', message: '0 rows' } })
    await expect(createRolesApi(client).update('gone', { notes: 'x' })).rejects.toMatchObject({ kind: 'missing' })
  })
  it('subscribe maps realtime events and status', () => {
    let handler: (p: unknown) => void = () => {}
    let statusCb: (s: string) => void = () => {}
    const channel = {
      on: vi.fn((_e, _f, h) => { handler = h; return channel }),
      subscribe: vi.fn((cb) => { statusCb = cb; return channel }),
    }
    const removeChannel = vi.fn()
    const client = { channel: () => channel, removeChannel } as unknown as SupabaseClient
    const onChange = vi.fn(), onStatus = vi.fn()
    const unsub = createRolesApi(client).subscribe(onChange, onStatus)
    handler({ eventType: 'UPDATE', new: row, old: {} })
    handler({ eventType: 'DELETE', new: {}, old: { id: 'nl-x' } })
    statusCb('SUBSCRIBED'); statusCb('CHANNEL_ERROR')
    expect(onChange).toHaveBeenNthCalledWith(1, { type: 'upsert', role: rowToRole(row) })
    expect(onChange).toHaveBeenNthCalledWith(2, { type: 'delete', id: 'nl-x' })
    expect(onStatus.mock.calls).toEqual([['live'], ['paused']])
    unsub()
    expect(removeChannel).toHaveBeenCalledWith(channel)
  })
})
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm test -- src/lib/roles.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/lib/roles.ts`**

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { CvVersion, Fit, Market, Role, Status } from './types'

export interface RoleRow {
  id: string; title: string; org: string; market: string; location: string; remote: string; rate: string
  ir35: string; duration: string; posted: string | null; deadline: string | null; next_date: string | null
  fit: string; status: string; why: string; caveat: string; url: string; contact: string; next_step: string
  notes: string; cv: string; created_at: string; updated_at: string; created_by: string | null; updated_by: string | null
}

export type RoleInput = Omit<Role, 'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy'>
export type RolePatch = Partial<Omit<RoleInput, 'id'>>
export type RoleChange = { type: 'upsert'; role: Role } | { type: 'delete'; id: string }
export type LiveStatus = 'live' | 'paused'

const KEY_MAP: Record<keyof RolePatch, keyof RoleRow> = {
  title: 'title', org: 'org', market: 'market', location: 'location', remote: 'remote', rate: 'rate',
  ir35: 'ir35', duration: 'duration', posted: 'posted', deadline: 'deadline', nextDate: 'next_date',
  fit: 'fit', status: 'status', why: 'why', caveat: 'caveat', url: 'url', contact: 'contact',
  nextStep: 'next_step', notes: 'notes', cv: 'cv',
}
const DATE_COLUMNS = new Set<keyof RoleRow>(['posted', 'deadline', 'next_date'])

export function rowToRole(r: RoleRow): Role {
  return {
    id: r.id, title: r.title, org: r.org, market: r.market as Market, location: r.location, remote: r.remote,
    rate: r.rate, ir35: r.ir35, duration: r.duration, posted: r.posted, deadline: r.deadline, nextDate: r.next_date,
    fit: r.fit as Fit, status: r.status as Status, why: r.why, caveat: r.caveat, url: r.url, contact: r.contact,
    nextStep: r.next_step, notes: r.notes, cv: r.cv as CvVersion, createdAt: r.created_at, updatedAt: r.updated_at,
    createdBy: r.created_by, updatedBy: r.updated_by,
  }
}

export function patchToRow(p: RolePatch): Partial<RoleRow> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(p)) {
    if (v === undefined) continue
    const col = KEY_MAP[k as keyof RolePatch]
    if (!col) continue
    out[col] = DATE_COLUMNS.has(col) && v === '' ? null : v
  }
  return out as Partial<RoleRow>
}

export function roleInputToRow(i: RoleInput): Partial<RoleRow> {
  const { id, ...rest } = i
  return { id, ...patchToRow(rest) }
}

export function newRoleId(market: string, org: string, title: string, now: number = Date.now()): string {
  const slug = `${market}-${org}-${title}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
  return `${slug}-${now.toString(36)}`
}

export function applyChange(roles: Role[], c: RoleChange): Role[] {
  if (c.type === 'delete') return roles.some((r) => r.id === c.id) ? roles.filter((r) => r.id !== c.id) : roles
  const i = roles.findIndex((r) => r.id === c.role.id)
  if (i === -1) return [...roles, c.role]
  const next = roles.slice()
  next[i] = c.role
  return next
}

export type RoleErrorKind = 'auth' | 'missing' | 'network' | 'other'

export class RoleError extends Error {
  constructor(message: string, readonly kind: RoleErrorKind) {
    super(message)
    this.name = 'RoleError'
  }
}

export function toRoleError(e: unknown): RoleError {
  if (e instanceof RoleError) return e
  const { code, message, status } = (e ?? {}) as { code?: string; message?: string; status?: number }
  const msg = message ?? String(e)
  if (code === 'PGRST116') return new RoleError(msg, 'missing')
  if (code === '42501' || code === 'PGRST301' || status === 401 || status === 403) return new RoleError(msg, 'auth')
  if (/failed to fetch|networkerror|load failed/i.test(msg)) return new RoleError(msg, 'network')
  return new RoleError(msg, 'other')
}

export function errorMessage(e: RoleError): string {
  if (e.kind === 'missing') return 'This role was deleted by someone else.'
  if (e.kind === 'auth') return 'Your session has ended. Sign in again.'
  return "Couldn't save. Check your connection and try again."
}

export interface RolesApi {
  list(): Promise<Role[]>
  create(input: RoleInput): Promise<Role>
  update(id: string, patch: RolePatch): Promise<Role>
  remove(id: string): Promise<void>
  subscribe(onChange: (c: RoleChange) => void, onStatus: (s: LiveStatus) => void): () => void
}

export function createRolesApi(sb: SupabaseClient): RolesApi {
  return {
    async list() {
      const { data, error } = await sb.from('roles').select('*')
      if (error) throw toRoleError(error)
      return (data as RoleRow[]).map(rowToRole)
    },
    async create(input) {
      const { data, error } = await sb.from('roles').insert(roleInputToRow(input)).select().single()
      if (error) throw toRoleError(error)
      return rowToRole(data as RoleRow)
    },
    async update(id, patch) {
      const { data, error } = await sb.from('roles').update(patchToRow(patch)).eq('id', id).select().single()
      if (error) throw toRoleError(error)
      return rowToRole(data as RoleRow)
    },
    async remove(id) {
      const { error } = await sb.from('roles').delete().eq('id', id)
      if (error) throw toRoleError(error)
    },
    subscribe(onChange, onStatus) {
      const channel = sb
        .channel('roles-changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'roles' }, (payload: {
          eventType: 'INSERT' | 'UPDATE' | 'DELETE'; new: unknown; old: unknown
        }) => {
          if (payload.eventType === 'DELETE') onChange({ type: 'delete', id: (payload.old as { id: string }).id })
          else onChange({ type: 'upsert', role: rowToRole(payload.new as RoleRow) })
        })
        .subscribe((status: string) => onStatus(status === 'SUBSCRIBED' ? 'live' : 'paused'))
      return () => { void sb.removeChannel(channel) }
    },
  }
}
```

If `tsc` rejects the `.on(...)` callback's payload type annotation, change it to `(payload) =>` and cast inside the function body with `const p = payload as unknown as { eventType: string; new: unknown; old: unknown }`.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm test -- src/lib/roles.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/roles.ts src/lib/roles.test.ts
git commit -m "feat: add roles data layer with realtime and error mapping

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Database schema, RLS and policy tests

**Files:**
- Create: `supabase/config.toml` (via `supabase init`), `supabase/migrations/20261006120000_roles.sql`, `supabase/tests/rls.test.sql`

**Interfaces:**
- Produces: table `public.roles` with the columns used by `RoleRow` (Task 3); function `public.is_inogen()`; trigger `roles_audit`; `roles` in publication `supabase_realtime`.

**Prerequisites:** Docker running and the Supabase CLI installed (`brew install supabase/tap/supabase`).

- [ ] **Step 1: Initialise Supabase locally and write the policy test first**

```bash
supabase init   # answer No to the VS Code / Deno prompts
```

`supabase/tests/rls.test.sql`:

```sql
begin;
select plan(11);

insert into public.roles (id, title, org, market, fit) values ('seed', 'T', 'O', 'NL', 'Good');

-- anonymous
set local role anon;
select is((select count(*)::int from public.roles), 0, 'anon reads nothing');
select throws_ok($$insert into public.roles (id, title, org, market, fit) values ('a1','T','O','NL','Good')$$, '42501', null, 'anon cannot insert');
reset role;

-- outsider
set local role authenticated;
set local request.jwt.claims = '{"email":"eve@example.com","role":"authenticated"}';
select is((select count(*)::int from public.roles), 0, 'outsider reads nothing');
select throws_ok($$insert into public.roles (id, title, org, market, fit) values ('e1','T','O','NL','Good')$$, '42501', null, 'outsider cannot insert');
update public.roles set notes = 'hacked' where id = 'seed';
reset role;
select is((select notes from public.roles where id = 'seed'), '', 'outsider update changed nothing');

-- look-alike domains
set local role authenticated;
set local request.jwt.claims = '{"email":"eve@inogen.ai.evil.com","role":"authenticated"}';
select is((select count(*)::int from public.roles), 0, 'suffix look-alike reads nothing');
set local request.jwt.claims = '{"email":"eve@notinogen.ai","role":"authenticated"}';
select is((select count(*)::int from public.roles), 0, 'prefix look-alike reads nothing');

-- insider, mixed case
set local request.jwt.claims = '{"email":"Mike@InoGen.AI","role":"authenticated"}';
select is((select count(*)::int from public.roles), 1, 'inogen user reads');
select lives_ok($$insert into public.roles (id, title, org, market, fit) values ('m1','T','O','UK','Strong')$$, 'inogen user inserts');
select is((select updated_by from public.roles where id = 'm1'), 'Mike@InoGen.AI', 'audit trigger records the editor');
select throws_ok($$insert into public.roles (id, title, org, market, fit) values ('m2','T','O','Mars','Good')$$, '23514', null, 'market check constraint');
reset role;

select * from finish();
rollback;
```

- [ ] **Step 2: Run the test and confirm it fails**

```bash
supabase start
supabase test db
```
Expected: FAIL with "relation "public.roles" does not exist".

- [ ] **Step 3: Write the migration `supabase/migrations/20261006120000_roles.sql`**

```sql
create table public.roles (
  id          text primary key,
  title       text not null,
  org         text not null,
  market      text not null check (market in ('UK','NL','EU','Global')),
  location    text not null default '',
  remote      text not null default '',
  rate        text not null default '',
  ir35        text not null default '',
  duration    text not null default '',
  posted      date,
  deadline    date,
  next_date   date,
  fit         text not null check (fit in ('Strong','Good','Stretch')),
  status      text not null default 'Shortlist'
              check (status in ('Shortlist','Applied','Interviewing','Offer','Won','Rejected','Closed','Parked')),
  why         text not null default '',
  caveat      text not null default '',
  url         text not null default '',
  contact     text not null default '',
  next_step   text not null default '',
  notes       text not null default '',
  cv          text not null default '' check (cv in ('','A','B')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  text,
  updated_by  text
);

-- Exact domain match, case-insensitive. Rejects "x@inogen.ai.evil.com" and "x@notinogen.ai".
create or replace function public.is_inogen() returns boolean
language sql stable
as $$
  select lower(split_part(coalesce(auth.jwt() ->> 'email', ''), '@', 2)) = 'inogen.ai'
$$;

alter table public.roles enable row level security;

create policy roles_select on public.roles for select to authenticated using (public.is_inogen());
create policy roles_insert on public.roles for insert to authenticated with check (public.is_inogen());
create policy roles_update on public.roles for update to authenticated using (public.is_inogen()) with check (public.is_inogen());
create policy roles_delete on public.roles for delete to authenticated using (public.is_inogen());

create or replace function public.roles_audit() returns trigger
language plpgsql
as $$
declare
  who text := coalesce(auth.jwt() ->> 'email', 'claude-script');
begin
  if tg_op = 'INSERT' then
    new.created_by := who;
    new.created_at := now();
  end if;
  new.updated_by := who;
  new.updated_at := now();
  return new;
end
$$;

create trigger roles_audit before insert or update on public.roles
  for each row execute function public.roles_audit();

alter publication supabase_realtime add table public.roles;
```

- [ ] **Step 4: Apply it and run the tests**

```bash
supabase db reset
supabase test db
```
Expected: `rls.test.sql .. ok`, All tests successful (11 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase
git commit -m "feat: add roles table with inogen.ai RLS, audit trigger and pgTAP tests

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Service-key scripts (migration and add role)

**Files:**
- Create: `scripts/supabase_rest.py`, `scripts/migrate_from_artifact.py`, `scripts/add_role.py`, `scripts/tests/test_rows.py`

**Interfaces:**
- Consumes: the `public.roles` columns from Task 4.
- Produces:
  - `supabase_rest.load_env(root: Path) -> dict[str, str]`, `supabase_rest.upsert_roles(rows: list[dict], env: dict) -> None`, `supabase_rest.COLUMNS`
  - `migrate_from_artifact.artifact_doc_to_row(doc_id: str, data: dict) -> dict`, `migrate_from_artifact.load_export(path: Path) -> list[dict]`
  - `add_role.build_row(fields: dict) -> dict`, `add_role.slugify(*parts: str) -> str`

- [ ] **Step 1: Write the failing tests `scripts/tests/test_rows.py`**

```python
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from add_role import build_row, slugify  # noqa: E402
from migrate_from_artifact import artifact_doc_to_row, load_export  # noqa: E402


def test_artifact_doc_maps_camel_fields_and_empty_dates():
    row = artifact_doc_to_row("nl-x", {
        "title": "AI Engineer", "org": "Interex", "market": "NL", "fit": "Strong", "status": "Shortlist",
        "next": "Send CV", "nextDate": "2026-10-07", "deadline": "", "posted": None,
        "created": "2026-10-05T12:00:00Z", "updated": "x",
    })
    assert row["id"] == "nl-x"
    assert row["next_step"] == "Send CV"
    assert row["next_date"] == "2026-10-07"
    assert row["deadline"] is None and row["posted"] is None
    assert "created" not in row and "updated" not in row and "next" not in row


def test_load_export_reads_both_shapes(tmp_path: Path):
    (tmp_path / "roles").mkdir()
    (tmp_path / "roles" / "a.json").write_text(json.dumps({"id": "a", "data": {"title": "A", "org": "O", "market": "UK", "fit": "Good"}, "version": 1}))
    (tmp_path / "roles" / "b.json").write_text(json.dumps({"title": "B", "org": "O", "market": "EU", "fit": "Good"}))
    rows = sorted(load_export(tmp_path), key=lambda r: r["id"])
    assert [r["id"] for r in rows] == ["a", "b"]
    assert rows[1]["title"] == "B"


def test_slugify():
    assert slugify("NL", "Morgan Black", "GCP Data/AI Engineer") == "nl-morgan-black-gcp-data-ai-engineer"


def test_build_row_defaults_and_validation():
    row = build_row({"title": "T", "org": "O", "market": "NL", "fit": "Good"})
    assert row["id"] == "nl-o-t" and row["status"] == "Shortlist"
    with pytest.raises(ValueError, match="market"):
        build_row({"title": "T", "org": "O", "market": "Mars", "fit": "Good"})
    with pytest.raises(ValueError, match="title"):
        build_row({"org": "O", "market": "NL", "fit": "Good"})
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `uv run --with pytest pytest scripts/tests -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'add_role'`.

- [ ] **Step 3: Implement the shared module `scripts/supabase_rest.py`**

```python
"""Minimal Supabase REST client for local scripts (service key, bypasses RLS). Standard library only."""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from pathlib import Path

COLUMNS = {
    "id", "title", "org", "market", "location", "remote", "rate", "ir35", "duration", "posted", "deadline",
    "next_date", "fit", "status", "why", "caveat", "url", "contact", "next_step", "notes", "cv",
}
DATE_COLUMNS = {"posted", "deadline", "next_date"}
MARKETS = {"UK", "NL", "EU", "Global"}
FITS = {"Strong", "Good", "Stretch"}
STATUSES = {"Shortlist", "Applied", "Interviewing", "Offer", "Won", "Rejected", "Closed", "Parked"}


def load_env(root: Path) -> dict[str, str]:
    env: dict[str, str] = {}
    dotenv = root / ".env"
    if dotenv.exists():
        for line in dotenv.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                env[key.strip()] = value.strip().strip('"').strip("'")
    env.update({k: v for k, v in os.environ.items() if k.startswith("SUPABASE_")})
    for key in ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"):
        if not env.get(key):
            raise SystemExit(f"Missing {key}. Add it to .env (see .env.example).")
    return env


def upsert_roles(rows: list[dict], env: dict[str, str]) -> None:
    if not rows:
        return
    req = urllib.request.Request(
        f"{env['SUPABASE_URL'].rstrip('/')}/rest/v1/roles?on_conflict=id",
        data=json.dumps(rows).encode(),
        method="POST",
        headers={
            "apikey": env["SUPABASE_SERVICE_ROLE_KEY"],
            "Authorization": f"Bearer {env['SUPABASE_SERVICE_ROLE_KEY']}",
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates,return=minimal",
        },
    )
    try:
        with urllib.request.urlopen(req) as resp:
            if resp.status not in (200, 201, 204):
                raise SystemExit(f"Upsert failed: HTTP {resp.status}")
    except urllib.error.HTTPError as e:
        raise SystemExit(f"Upsert failed: HTTP {e.code}: {e.read().decode()[:500]}") from e
```

- [ ] **Step 4: Implement `scripts/migrate_from_artifact.py`**

```python
# /// script
# requires-python = ">=3.11"
# ///
"""Upsert roles exported from the claude.ai Contract Pipeline into Supabase.

Usage: uv run scripts/migrate_from_artifact.py seed/
The export directory holds one JSON file per document, either the artifact store's
{"id", "data", "version"} shape or a bare document body (id = file stem).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from supabase_rest import COLUMNS, DATE_COLUMNS, load_env, upsert_roles

FIELD_MAP = {"next": "next_step", "nextDate": "next_date"}


def artifact_doc_to_row(doc_id: str, data: dict) -> dict:
    row: dict = {"id": doc_id}
    for key, value in data.items():
        col = FIELD_MAP.get(key, key)
        if col not in COLUMNS or col == "id":
            continue
        row[col] = (value or None) if col in DATE_COLUMNS else ("" if value is None else value)
    return row


def load_export(path: Path) -> list[dict]:
    rows = []
    for f in sorted(path.rglob("*.json")):
        obj = json.loads(f.read_text())
        if isinstance(obj, dict) and isinstance(obj.get("data"), dict):
            rows.append(artifact_doc_to_row(str(obj.get("id") or f.stem), obj["data"]))
        elif isinstance(obj, dict):
            rows.append(artifact_doc_to_row(f.stem, obj))
    return rows


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("Usage: uv run scripts/migrate_from_artifact.py <export-dir>")
    rows = load_export(Path(sys.argv[1]))
    upsert_roles(rows, load_env(Path(__file__).resolve().parents[1]))
    print(f"Upserted {len(rows)} roles.")


if __name__ == "__main__":
    main()
```

- [ ] **Step 5: Implement `scripts/add_role.py`**

```python
# /// script
# requires-python = ">=3.11"
# ///
"""Add or update one role. Used by Claude to log newly found roles.

Usage:
  uv run scripts/add_role.py --title "AI Engineer" --org "Acme" --market NL --fit Strong \
      --url https://... --why "..." [--rate ...] [--deadline 2026-10-31] [--id custom-id]
  uv run scripts/add_role.py --json role.json
Re-running with the same market/org/title updates the same row.
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

from supabase_rest import COLUMNS, DATE_COLUMNS, FITS, MARKETS, STATUSES, load_env, upsert_roles


def slugify(*parts: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", "-".join(parts).lower()).strip("-")[:80]


def build_row(fields: dict) -> dict:
    for required in ("title", "org", "market", "fit"):
        if not fields.get(required):
            raise ValueError(f"{required} is required")
    if fields["market"] not in MARKETS:
        raise ValueError(f"market must be one of {sorted(MARKETS)}")
    if fields["fit"] not in FITS:
        raise ValueError(f"fit must be one of {sorted(FITS)}")
    status = fields.get("status") or "Shortlist"
    if status not in STATUSES:
        raise ValueError(f"status must be one of {sorted(STATUSES)}")
    row = {k: v for k, v in fields.items() if k in COLUMNS and v is not None}
    row["status"] = status
    row["id"] = fields.get("id") or slugify(fields["market"], fields["org"], fields["title"])
    for col in DATE_COLUMNS:
        if col in row and row[col] == "":
            row[col] = None
    return row


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--json", type=Path)
    for col in sorted(COLUMNS):
        p.add_argument(f"--{col.replace('_', '-')}", dest=col)
    args = vars(p.parse_args())
    fields = json.loads(args.pop("json").read_text()) if args.get("json") else {}
    fields.update({k: v for k, v in args.items() if v is not None and k != "json"})
    row = build_row(fields)
    upsert_roles([row], load_env(Path(__file__).resolve().parents[1]))
    print(f"Saved role {row['id']}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `uv run --with pytest pytest scripts/tests -q`
Expected: `4 passed`.

- [ ] **Step 7: Check the scripts against local Supabase**

```bash
# local keys from `supabase status`
SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=<local service_role key> \
  uv run scripts/add_role.py --title "Test role" --org "Acme" --market NL --fit Good
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c "select id, created_by from public.roles"
```
Expected: `Saved role nl-acme-test-role`; the row has `created_by = claude-script`.

- [ ] **Step 8: Commit**

```bash
git add scripts
git commit -m "feat: add service-key scripts for migration and adding roles

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Supabase client, session hook, sign-in screen and app shell

**Files:**
- Create: `src/lib/supabase.ts`, `src/hooks/useSession.ts`, `src/hooks/useSession.test.tsx`, `src/components/SignIn.tsx`, `src/components/SignIn.test.tsx`
- Modify: `src/App.tsx`, `src/main.tsx`, `index.html`

**Interfaces:**
- Consumes: `isAllowedEmail` (Task 2); `createRolesApi` (Task 3).
- Produces:
  - `supabase: SupabaseClient`
  - `SessionStatus = 'loading' | 'signedOut' | 'refused' | 'signedIn'`
  - `useSession(auth: SupabaseClient['auth']): { status: SessionStatus; session: Session | null; signIn(): Promise<void>; signOut(): Promise<void> }`
  - `SignIn({ refused, onSignIn }: { refused: boolean; onSignIn: () => void })`
  - `App` renders `<Pipeline api userEmail onSignOut onAuthError />`. `Pipeline` is created in Task 7; until then App renders a placeholder `<p>Signed in as …</p>`, which Task 7 replaces.

- [ ] **Step 1: Write the failing tests**

`src/hooks/useSession.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { useSession } from './useSession'

function fakeAuth(initial: Session | null) {
  let listener: (e: string, s: Session | null) => void = () => {}
  const auth = {
    getSession: vi.fn(async () => ({ data: { session: initial }, error: null })),
    onAuthStateChange: vi.fn((cb) => { listener = cb; return { data: { subscription: { unsubscribe: vi.fn() } } } }),
    signOut: vi.fn(async () => { listener('SIGNED_OUT', null); return { error: null } }),
    signInWithOAuth: vi.fn(async () => ({ data: {}, error: null })),
  }
  return { auth: auth as unknown as SupabaseClient['auth'], raw: auth, emit: (s: Session | null) => listener('SIGNED_IN', s) }
}
const session = (email: string) => ({ user: { email } }) as unknown as Session

describe('useSession', () => {
  it('signed out when there is no session', async () => {
    const { auth } = fakeAuth(null)
    const { result } = renderHook(() => useSession(auth))
    await waitFor(() => expect(result.current.status).toBe('signedOut'))
  })
  it('signed in for an inogen.ai account', async () => {
    const { auth } = fakeAuth(session('michael.snow@inogen.ai'))
    const { result } = renderHook(() => useSession(auth))
    await waitFor(() => expect(result.current.status).toBe('signedIn'))
  })
  it('refuses and signs out other accounts, and stays refused after the sign-out event', async () => {
    const { auth, raw } = fakeAuth(session('eve@example.com'))
    const { result } = renderHook(() => useSession(auth))
    await waitFor(() => expect(result.current.status).toBe('refused'))
    expect(raw.signOut).toHaveBeenCalled()
  })
  it('signIn uses the azure provider with the email scope', async () => {
    const { auth, raw } = fakeAuth(null)
    const { result } = renderHook(() => useSession(auth))
    await act(() => result.current.signIn())
    expect(raw.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'azure', options: { scopes: 'email', redirectTo: window.location.origin },
    })
  })
})
```

`src/components/SignIn.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SignIn } from './SignIn'

describe('SignIn', () => {
  it('calls onSignIn', async () => {
    const onSignIn = vi.fn()
    render(<SignIn refused={false} onSignIn={onSignIn} />)
    await userEvent.click(screen.getByRole('button', { name: 'Sign in with Microsoft' }))
    expect(onSignIn).toHaveBeenCalled()
  })
  it('explains a refusal', () => {
    render(<SignIn refused onSignIn={() => {}} />)
    expect(screen.getByText('This tracker is limited to InoGen accounts.')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm test -- src/hooks src/components/SignIn.test.tsx`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement**

`src/lib/supabase.ts`:

```ts
import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
if (!url || !anonKey) throw new Error('VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set (see .env.example).')

export const supabase = createClient(url, anonKey)
```

`src/hooks/useSession.ts`:

```ts
import { useCallback, useEffect, useState } from 'react'
import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { isAllowedEmail } from '../lib/auth'

export type SessionStatus = 'loading' | 'signedOut' | 'refused' | 'signedIn'

export function useSession(auth: SupabaseClient['auth']) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [refused, setRefused] = useState(false)

  useEffect(() => {
    let active = true
    const handle = (s: Session | null) => {
      if (!active) return
      if (s && !isAllowedEmail(s.user.email)) {
        setRefused(true)
        setSession(null)
        void auth.signOut()
      } else {
        setSession(s)
      }
      setLoading(false)
    }
    void auth.getSession().then(({ data }) => handle(data.session))
    const { data } = auth.onAuthStateChange((_event, s) => handle(s))
    return () => {
      active = false
      data.subscription.unsubscribe()
    }
  }, [auth])

  const signIn = useCallback(async () => {
    setRefused(false)
    await auth.signInWithOAuth({ provider: 'azure', options: { scopes: 'email', redirectTo: window.location.origin } })
  }, [auth])

  const signOut = useCallback(async () => {
    await auth.signOut()
  }, [auth])

  const status: SessionStatus = loading ? 'loading' : session ? 'signedIn' : refused ? 'refused' : 'signedOut'
  return { status, session, signIn, signOut }
}
```

`src/components/SignIn.tsx`:

```tsx
export function SignIn({ refused, onSignIn }: { refused: boolean; onSignIn: () => void }) {
  return (
    <main className="wrap signin">
      <h1>Contract Pipeline</h1>
      <p className="sub">Freelance roles tracked by the InoGen team. Sign in with your InoGen Microsoft account.</p>
      {refused && <p className="banner" role="alert">This tracker is limited to InoGen accounts.</p>}
      <button className="btn primary" onClick={onSignIn}>Sign in with Microsoft</button>
    </main>
  )
}
```

`src/App.tsx` (temporary shell until Task 7 adds Pipeline):

```tsx
import { supabase } from './lib/supabase'
import { useSession } from './hooks/useSession'
import { SignIn } from './components/SignIn'

export default function App() {
  const { status, session, signIn, signOut } = useSession(supabase.auth)
  if (status === 'loading') return <main className="wrap"><p className="notice">Loading…</p></main>
  if (status !== 'signedIn' || !session) return <SignIn refused={status === 'refused'} onSignIn={signIn} />
  return <main className="wrap"><p>Signed in as {session.user.email}</p><button className="btn" onClick={signOut}>Sign out</button></main>
}
```

`src/main.tsx`:

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
```

Create an empty `src/styles.css` now; Task 7 fills it in.

`index.html`: set `<title>Contract Pipeline · InoGen</title>` and add these to `<head>`:

```html
<meta name="robots" content="noindex">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700&family=Instrument+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap">
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm test -- src/hooks src/components/SignIn.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src index.html
git commit -m "feat: add Microsoft sign-in gate limited to inogen.ai

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Pipeline UI and styles

**Files:**
- Create:
  - `src/components/StageStrip.tsx`, `src/components/Filters.tsx`, `src/components/RoleRow.tsx`
  - `src/components/RoleEditor.tsx`, `src/components/RoleEditor.test.tsx`
  - `src/components/AddRoleDialog.tsx`
  - `src/components/Pipeline.tsx`, `src/components/Pipeline.test.tsx`
- Modify: `src/styles.css`, `src/App.tsx`

**Interfaces:**
- Consumes:
  - From `pipeline.ts`: `Filters`, `StageFilter`, `filterRoles`, `sortRoles`, `stageCounts`, `daysTo`, `deadlineTone`, `contractCountdown`, `formatDay`, `relativeTime`.
  - From `filterStorage.ts`: `loadFilters`, `saveFilters`.
  - From `auth.ts`: `displayName`.
  - From `roles.ts`: `RolesApi`, `RoleInput`, `RolePatch`, `applyChange`, `toRoleError`, `errorMessage`, `newRoleId`, `LiveStatus`.
- Produces: `Pipeline({ api, userEmail, onSignOut, onAuthError, now? }: { api: RolesApi; userEmail: string; onSignOut: () => void; onAuthError: () => void; now?: Date })`.

- [ ] **Step 1: Write the failing component tests**

`src/components/RoleEditor.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RoleEditor } from './RoleEditor'
import { makeRole } from '../test/factories'

const now = new Date(2026, 9, 6, 9)

describe('RoleEditor', () => {
  it('keeps an unsaved draft when a live update to the same role arrives', async () => {
    const role = makeRole({ id: 'r1', notes: 'old' })
    const { rerender } = render(<RoleEditor role={role} now={now} onSave={vi.fn()} onDelete={vi.fn()} />)
    const notes = screen.getByLabelText('Notes')
    await userEvent.clear(notes)
    await userEvent.type(notes, 'my draft')
    rerender(<RoleEditor role={{ ...role, rate: '€100/h', updatedBy: 'herman@inogen.ai' }} now={now} onSave={vi.fn()} onDelete={vi.fn()} />)
    expect(screen.getByLabelText('Notes')).toHaveValue('my draft')
  })
  it('resets when a different role is shown', async () => {
    const { rerender } = render(<RoleEditor role={makeRole({ id: 'r1', notes: 'one' })} now={now} onSave={vi.fn()} onDelete={vi.fn()} />)
    await userEvent.type(screen.getByLabelText('Notes'), ' edited')
    rerender(<RoleEditor role={makeRole({ id: 'r2', notes: 'two' })} now={now} onSave={vi.fn()} onDelete={vi.fn()} />)
    expect(screen.getByLabelText('Notes')).toHaveValue('two')
  })
  it('saves a cleared date as null', async () => {
    const onSave = vi.fn(async () => null)
    render(<RoleEditor role={makeRole({ deadline: '2026-10-18' })} now={now} onSave={onSave} onDelete={vi.fn()} />)
    await userEvent.clear(screen.getByLabelText('Deadline'))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ deadline: null }))
    expect(await screen.findByText('Saved')).toBeInTheDocument()
  })
  it('shows the save error', async () => {
    render(<RoleEditor role={makeRole()} now={now} onSave={async () => 'This role was deleted by someone else.'} onDelete={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('This role was deleted by someone else.')).toBeInTheDocument()
  })
  it('asks before deleting', async () => {
    const onDelete = vi.fn(async () => null)
    render(<RoleEditor role={makeRole()} now={now} onSave={vi.fn()} onDelete={onDelete} />)
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(onDelete).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Delete role' }))
    expect(onDelete).toHaveBeenCalled()
  })
  it('shows who last updated it', () => {
    render(<RoleEditor role={makeRole({ updatedBy: 'herman.wigge@inogen.ai', updatedAt: new Date(now.getTime() - 2 * 3_600_000).toISOString() })} now={now} onSave={vi.fn()} onDelete={vi.fn()} />)
    expect(screen.getByText('Updated by Herman, 2h ago')).toBeInTheDocument()
  })
})
```

`src/components/Pipeline.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Pipeline } from './Pipeline'
import { makeRole } from '../test/factories'
import { RoleError, type RoleChange, type LiveStatus, type RolesApi } from '../lib/roles'
import type { Role } from '../lib/types'

const now = new Date(2026, 9, 6, 9)

function fakeApi(roles: Role[]) {
  let push: (c: RoleChange) => void = () => {}
  let status: (s: LiveStatus) => void = () => {}
  const api: RolesApi = {
    list: vi.fn(async () => roles),
    create: vi.fn(async (input) => ({ ...makeRole(), ...input })),
    update: vi.fn(async (id, patch) => ({ ...roles.find((r) => r.id === id)!, ...patch } as Role)),
    remove: vi.fn(async () => {}),
    subscribe: vi.fn((onChange, onStatus) => { push = onChange; status = onStatus; return () => {} }),
  }
  return { api, push: (c: RoleChange) => act(() => push(c)), status: (s: LiveStatus) => act(() => status(s)) }
}

const props = { userEmail: 'michael.snow@inogen.ai', onSignOut: vi.fn(), onAuthError: vi.fn(), now }

describe('Pipeline', () => {
  beforeEach(() => localStorage.clear())

  it('shows roles sorted by stage', async () => {
    const { api } = fakeApi([makeRole({ id: 'a', title: 'Shortlisted role' }), makeRole({ id: 'b', title: 'Applied role', status: 'Applied' })])
    render(<Pipeline api={api} {...props} />)
    const titles = await screen.findAllByText(/role$/, { selector: '.role-t' })
    expect(titles.map((t) => t.textContent)).toEqual(['Applied role', 'Shortlisted role'])
  })

  it('reverts a failed status change and says why', async () => {
    const { api } = fakeApi([makeRole({ id: 'a', title: 'Role A' })])
    vi.mocked(api.update).mockRejectedValueOnce(new RoleError('down', 'network'))
    render(<Pipeline api={api} {...props} />)
    const select = await screen.findByLabelText('Status for Role A')
    await userEvent.selectOptions(select, 'Applied')
    await waitFor(() => expect(select).toHaveValue('Shortlist'))
    expect(screen.getByText("Couldn't save. Check your connection and try again.")).toBeInTheDocument()
  })

  it('signs out on an auth error', async () => {
    const { api } = fakeApi([makeRole({ id: 'a', title: 'Role A' })])
    vi.mocked(api.update).mockRejectedValueOnce(new RoleError('jwt', 'auth'))
    render(<Pipeline api={api} {...props} />)
    await userEvent.selectOptions(await screen.findByLabelText('Status for Role A'), 'Applied')
    await waitFor(() => expect(props.onAuthError).toHaveBeenCalled())
  })

  it('closes the editor when someone else deletes the open role', async () => {
    const { api, push } = fakeApi([makeRole({ id: 'a', title: 'Role A' })])
    render(<Pipeline api={api} {...props} />)
    await userEvent.click(await screen.findByText('Role A'))
    expect(screen.getByLabelText('Notes')).toBeInTheDocument()
    push({ type: 'delete', id: 'a' })
    await waitFor(() => expect(screen.queryByLabelText('Notes')).not.toBeInTheDocument())
  })

  it('applies live upserts from colleagues', async () => {
    const { api, push } = fakeApi([])
    render(<Pipeline api={api} {...props} />)
    await screen.findByText('No roles yet.')
    push({ type: 'upsert', role: makeRole({ id: 'n', title: 'New from Herman' }) })
    expect(await screen.findByText('New from Herman')).toBeInTheDocument()
  })

  it('shows the paused banner and reloads after reconnecting', async () => {
    const { api, status } = fakeApi([])
    render(<Pipeline api={api} {...props} />)
    await screen.findByText('No roles yet.')
    status('paused')
    expect(screen.getByText('Live updates paused. Reconnecting…')).toBeInTheDocument()
    status('live')
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2))
    expect(screen.queryByText('Live updates paused. Reconnecting…')).not.toBeInTheDocument()
  })

  it('adds a role', async () => {
    const { api } = fakeApi([])
    render(<Pipeline api={api} {...props} />)
    await screen.findByText('No roles yet.')
    await userEvent.click(screen.getByRole('button', { name: 'Add role' }))
    const dialog = screen.getByRole('dialog')
    await userEvent.type(within(dialog).getByLabelText('Role title'), 'ML Engineer')
    await userEvent.type(within(dialog).getByLabelText('Company or agency'), 'Acme')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add role' }))
    expect(api.create).toHaveBeenCalledWith(expect.objectContaining({ title: 'ML Engineer', org: 'Acme', status: 'Shortlist', market: 'UK' }))
    expect(await screen.findByText('ML Engineer')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm test -- src/components`
Expected: FAIL (RoleEditor and Pipeline modules not found).

- [ ] **Step 3: Implement the small components**

`src/components/StageStrip.tsx`:

```tsx
import type { StageFilter } from '../lib/pipeline'

const STAGES: Array<[StageFilter, string]> = [
  ['Active', 'Active'], ['Shortlist', 'Shortlist'], ['Applied', 'Applied'], ['Interviewing', 'Interviewing'],
  ['Offer', 'Offer'], ['Due14', 'Deadline ≤ 14 days'], ['Archive', 'Archived'],
]

export function StageStrip({ counts, value, onChange }: {
  counts: Record<StageFilter, number>; value: StageFilter; onChange: (s: StageFilter) => void
}) {
  return (
    <nav className="stages" aria-label="Filter by stage">
      {STAGES.map(([key, label]) => (
        <button key={key} className="stage" aria-pressed={value === key}
          onClick={() => onChange(value === key && key !== 'Active' ? 'Active' : key)}>
          <span className="n">{counts[key]}</span>
          <span className="l">{label}</span>
        </button>
      ))}
    </nav>
  )
}
```

`src/components/Filters.tsx`:

```tsx
import { FITS, MARKETS } from '../lib/types'
import type { Filters } from '../lib/pipeline'

export function FilterBar({ filters, onChange, onAdd }: {
  filters: Filters; onChange: (f: Filters) => void; onAdd: () => void
}) {
  return (
    <div className="toolbar">
      <div className="seg" role="group" aria-label="Market">
        {(['All', ...MARKETS] as const).map((m) => (
          <button key={m} aria-pressed={filters.market === m} onClick={() => onChange({ ...filters, market: m })}>{m}</button>
        ))}
      </div>
      <div className="seg" role="group" aria-label="Fit">
        {(['Any', ...FITS] as const).map((f) => (
          <button key={f} aria-pressed={filters.fit === f} onClick={() => onChange({ ...filters, fit: f })}>{f === 'Any' ? 'Any fit' : f}</button>
        ))}
      </div>
      <input id="q" type="search" aria-label="Search" placeholder="Search roles, companies, notes"
        value={filters.query} onChange={(e) => onChange({ ...filters, query: e.target.value })} />
      <button className="btn primary" onClick={onAdd}>Add role</button>
    </div>
  )
}
```

`src/components/RoleRow.tsx`:

```tsx
import type { ReactNode } from 'react'
import { STATUSES, type Role, type Status } from '../lib/types'
import { daysTo, deadlineTone, formatDay } from '../lib/pipeline'

export function RoleRow({ role, open, now, onToggle, onStatus, children }: {
  role: Role; open: boolean; now: Date; onToggle: () => void; onStatus: (s: Status) => void; children?: ReactNode
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
```

- [ ] **Step 4: Implement `src/components/RoleEditor.tsx`**

```tsx
import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import { CV_VERSIONS, FITS, type CvVersion, type Fit, type Role } from '../lib/types'
import type { RolePatch } from '../lib/roles'
import { displayName } from '../lib/auth'
import { relativeTime } from '../lib/pipeline'

interface Draft { nextStep: string; nextDate: string; rate: string; deadline: string; cv: string; fit: string; notes: string }

const draftFrom = (r: Role): Draft => ({
  nextStep: r.nextStep, nextDate: r.nextDate ?? '', rate: r.rate, deadline: r.deadline ?? '', cv: r.cv, fit: r.fit, notes: r.notes,
})

export function RoleEditor({ role, now, onSave, onDelete }: {
  role: Role; now: Date; onSave: (p: RolePatch) => Promise<string | null>; onDelete: () => Promise<string | null>
}) {
  const [draft, setDraft] = useState<Draft>(() => draftFrom(role))
  const [msg, setMsg] = useState('')
  const [confirming, setConfirming] = useState(false)

  // Reset only when a different role is shown, so a colleague's live edit never wipes this draft.
  useEffect(() => {
    setDraft(draftFrom(role))
    setMsg('')
    setConfirming(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role.id])

  const field = (k: keyof Draft) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setDraft((d) => ({ ...d, [k]: e.target.value }))

  async function submit(e: FormEvent) {
    e.preventDefault()
    setMsg('Saving…')
    const err = await onSave({
      nextStep: draft.nextStep.trim(), nextDate: draft.nextDate || null, rate: draft.rate.trim(),
      deadline: draft.deadline || null, cv: draft.cv as CvVersion, fit: draft.fit as Fit, notes: draft.notes,
    })
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
```

Each control sits inside its `<label>`. `.form` lays the labels out in two columns, or one at phone width; `.full` spans both.

- [ ] **Step 5: Implement `src/components/AddRoleDialog.tsx`**

```tsx
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
```

- [ ] **Step 6: Implement `src/components/Pipeline.tsx`**

```tsx
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Role, Status } from '../lib/types'
import {
  applyChange, errorMessage, toRoleError, type LiveStatus, type RoleInput, type RolePatch, type RolesApi,
} from '../lib/roles'
import { contractCountdown, filterRoles, sortRoles, stageCounts, type Filters } from '../lib/pipeline'
import { loadFilters, saveFilters } from '../lib/filterStorage'
import { StageStrip } from './StageStrip'
import { FilterBar } from './Filters'
import { RoleRow } from './RoleRow'
import { RoleEditor } from './RoleEditor'
import { AddRoleDialog } from './AddRoleDialog'

export function Pipeline({ api, userEmail, onSignOut, onAuthError, now = new Date() }: {
  api: RolesApi; userEmail: string; onSignOut: () => void; onAuthError: () => void; now?: Date
}) {
  const [roles, setRoles] = useState<Role[]>([])
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [live, setLive] = useState<LiveStatus | 'connecting'>('connecting')
  const [filters, setFilters] = useState<Filters>(() => loadFilters())
  const [openId, setOpenId] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [adding, setAdding] = useState(false)

  const fail = useCallback((e: unknown): string => {
    const err = toRoleError(e)
    if (err.kind === 'auth') onAuthError()
    return errorMessage(err)
  }, [onAuthError])

  const reload = useCallback(async () => {
    try {
      setRoles(await api.list())
      setLoadError('')
    } catch (e) {
      const err = toRoleError(e)
      if (err.kind === 'auth') onAuthError()
      else setLoadError("Couldn't load roles. Check your connection and reload the page.")
    } finally {
      setLoaded(true)
    }
  }, [api, onAuthError])

  useEffect(() => {
    void reload()
    let wasPaused = false
    return api.subscribe(
      (change) => setRoles((rs) => applyChange(rs, change)),
      (status) => {
        setLive(status)
        if (status === 'paused') wasPaused = true
        else if (wasPaused) { wasPaused = false; void reload() } // catch up on changes missed while offline
      },
    )
  }, [api, reload])

  useEffect(() => { saveFilters(filters) }, [filters])
  useEffect(() => {
    if (openId && loaded && !roles.some((r) => r.id === openId)) setOpenId(null)
  }, [roles, openId, loaded])

  const counts = useMemo(() => stageCounts(roles, now), [roles, now])
  const visible = useMemo(() => sortRoles(filterRoles(roles, filters, now), now), [roles, filters, now])

  async function changeStatus(id: string, status: Status) {
    const before = roles.find((r) => r.id === id)
    if (!before) return
    setRoles((rs) => rs.map((r) => (r.id === id ? { ...r, status } : r)))
    try {
      const saved = await api.update(id, { status })
      setRoles((rs) => applyChange(rs, { type: 'upsert', role: saved }))
      setNotice('')
    } catch (e) {
      setRoles((rs) => rs.map((r) => (r.id === id ? { ...r, status: before.status } : r)))
      setNotice(fail(e))
    }
  }

  async function save(id: string, patch: RolePatch): Promise<string | null> {
    try {
      const saved = await api.update(id, patch)
      setRoles((rs) => applyChange(rs, { type: 'upsert', role: saved }))
      return null
    } catch (e) {
      const err = toRoleError(e)
      if (err.kind === 'missing') setRoles((rs) => applyChange(rs, { type: 'delete', id }))
      return fail(err)
    }
  }

  async function remove(id: string): Promise<string | null> {
    try {
      await api.remove(id)
      setRoles((rs) => applyChange(rs, { type: 'delete', id }))
      return null
    } catch (e) {
      return fail(e)
    }
  }

  async function create(input: RoleInput): Promise<string | null> {
    try {
      const saved = await api.create(input)
      setRoles((rs) => applyChange(rs, { type: 'upsert', role: saved }))
      setAdding(false)
      setFilters((f) => ({ ...f, stage: 'Active' }))
      setOpenId(saved.id)
      return null
    } catch (e) {
      return fail(e)
    }
  }

  let body
  if (!loaded) body = <div className="empty"><b>Loading roles…</b></div>
  else if (loadError) body = <div className="empty"><b>{loadError}</b></div>
  else if (!roles.length) body = <div className="empty"><b>No roles yet.</b>Use Add role to log the first one.</div>
  else if (!visible.length) body = <div className="empty"><b>Nothing matches these filters.</b>Try All markets or another stage.</div>
  else body = visible.map((r) => (
    <RoleRow key={r.id} role={r} now={now} open={openId === r.id}
      onToggle={() => setOpenId((o) => (o === r.id ? null : r.id))}
      onStatus={(s) => void changeStatus(r.id, s)}>
      <RoleEditor role={r} now={now} onSave={(p) => save(r.id, p)} onDelete={() => remove(r.id)} />
    </RoleRow>
  ))

  return (
    <main className="wrap">
      <header className="top">
        <div>
          <h1>Contract Pipeline</h1>
          <p className="sub">Remote freelance roles across the UK, the Netherlands and wider Europe. Open a row to update its status, next step and notes.</p>
        </div>
        <div className="top-side">
          <div className="countdown"><b className="mono">{contractCountdown(now)}</b><span>days until the current<br />contract ends (31 Oct)</span></div>
          <div className="userbar"><span className="muted">{userEmail}</span><button className="btn" onClick={onSignOut}>Sign out</button></div>
        </div>
      </header>
      <StageStrip counts={counts} value={filters.stage} onChange={(stage) => setFilters((f) => ({ ...f, stage }))} />
      <FilterBar filters={filters} onChange={setFilters} onAdd={() => setAdding(true)} />
      {live === 'paused' && <p className="banner" role="status">Live updates paused. Reconnecting…</p>}
      <div className="ledger">
        <div className="cols" aria-hidden="true"><span>Role</span><span>Market</span><span>Terms</span><span>Deadline</span><span>Fit</span><span>Status</span></div>
        <div>{body}</div>
      </div>
      {notice && <p className="notice" role="alert">{notice}</p>}
      {adding && <AddRoleDialog onCreate={create} onClose={() => setAdding(false)} />}
    </main>
  )
}
```

Replace `src/App.tsx`:

```tsx
import { supabase } from './lib/supabase'
import { createRolesApi } from './lib/roles'
import { useSession } from './hooks/useSession'
import { SignIn } from './components/SignIn'
import { Pipeline } from './components/Pipeline'

const api = createRolesApi(supabase)

export default function App() {
  const { status, session, signIn, signOut } = useSession(supabase.auth)
  if (status === 'loading') return <main className="wrap"><p className="notice">Loading…</p></main>
  if (status !== 'signedIn' || !session) return <SignIn refused={status === 'refused'} onSignIn={signIn} />
  return <Pipeline api={api} userEmail={session.user.email ?? ''} onSignOut={signOut} onAuthError={signOut} />
}
```

- [ ] **Step 7: Write `src/styles.css`**

Copy lines 6–150 of `docs/reference/contract-pipeline.html` (everything inside `<style>…</style>`) into `src/styles.css`. Then make these changes:

1. Delete the `dialog { … }`, `dialog::backdrop { … }` and `dialog h2 { … }` rules.
2. Change the `.form` rule's columns to `grid-template-columns: repeat(2, minmax(0, 1fr));`. Leave it as written if it already says that.
3. Append:

```css
.next { color: var(--accent); }
.top-side { display: grid; gap: 10px; justify-items: end; }
.userbar { display: flex; gap: 10px; align-items: center; font-size: 13px; }
.banner { margin: 0; padding: 8px 12px; border-radius: 8px; background: var(--warn-soft); color: var(--warn); font-size: 14px; }
.who { font-size: 13px; color: var(--muted); }
.selectable { user-select: all; }
.form > label { display: grid; gap: 2px; align-content: start; }
.backdrop { position: fixed; inset: 0; background: rgb(10 12 18 / 0.45); display: grid; place-items: center; padding: 16px; z-index: 10; }
.modal { background: var(--surface); color: var(--ink); border: 1px solid var(--line); border-radius: 12px; padding: 20px; width: min(640px, 100%); max-height: calc(100vh - 32px); overflow: auto; }
.modal h2 { font-family: var(--f-display); margin: 0 0 14px; font-size: 22px; }
.signin { max-width: 560px; padding-block: 15vh 64px; }
@media (max-width: 820px) { .top-side { justify-items: start; } }
```

- [ ] **Step 8: Run all tests, lint and typecheck**

Run: `npm test && npm run lint && npm run typecheck`
Expected: all tests pass; no lint or type errors.

- [ ] **Step 9: Check it by eye against local Supabase**

```bash
cp .env.example .env.local   # set VITE_SUPABASE_URL=http://127.0.0.1:54321 and the local anon key from `supabase status`
npm run dev
```
Microsoft sign-in can't run locally without the Entra app (Task 10). To check the UI before then, sign in with a local password user. In Supabase Studio (http://127.0.0.1:54323 → Authentication → Add user), create `test@inogen.ai` with a password, and in the browser console run:
`await (await import('/src/lib/supabase.ts')).supabase.auth.signInWithPassword({ email: 'test@inogen.ai', password: '…' })`
Check the following, including in a narrow (400px) window:
- the rows render;
- a status change saves;
- the editor saves;
- two browser windows update each other live;
- dark mode looks right.

- [ ] **Step 10: Commit**

```bash
git add src
git commit -m "feat: add pipeline UI with live updates, editing and add-role dialog

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Playwright smoke tests

**Files:**
- Create: `playwright.config.ts`, `.env.e2e`, `e2e/smoke.spec.ts`

**Interfaces:**
- Consumes: the built app. Session storage key `sb-e2etest-auth-token`; supabase-js derives it from the hostname `e2etest.supabase.co`.

- [ ] **Step 1: Write the config, env and test**

`.env.e2e` (committed; fake values):

```
VITE_SUPABASE_URL=https://e2etest.supabase.co
VITE_SUPABASE_ANON_KEY=e2e-anon-key
```

`playwright.config.ts`:

```ts
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  use: { baseURL: 'http://localhost:4173' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: { command: 'npx vite --mode e2e --port 4173 --strictPort', url: 'http://localhost:4173', reuseExistingServer: !process.env.CI },
})
```

`e2e/smoke.spec.ts`:

```ts
import { test, expect } from '@playwright/test'

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
const exp = Math.floor(Date.now() / 1000) + 3600
const user = { id: 'u1', aud: 'authenticated', role: 'authenticated', email: 'michael.snow@inogen.ai', app_metadata: {}, user_metadata: {}, created_at: '2026-10-01T00:00:00Z' }
const session = {
  access_token: `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'u1', email: user.email, role: 'authenticated', exp })}.sig`,
  refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: exp, user,
}
const row = {
  id: 'nl-x', title: 'AI Engineer', org: 'Interex', market: 'NL', location: 'Den Haag', remote: '', rate: '', ir35: '',
  duration: '', posted: '2026-09-18', deadline: null, next_date: null, fit: 'Strong', status: 'Shortlist', why: '',
  caveat: '', url: '', contact: '', next_step: '', notes: '', cv: 'A', created_at: '2026-10-06T10:00:00Z',
  updated_at: '2026-10-06T10:00:00Z', created_by: 'claude-script', updated_by: 'claude-script',
}

test('signed-out visitors see only the sign-in screen', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Sign in with Microsoft' })).toBeVisible()
  await expect(page.getByText('AI Engineer')).toHaveCount(0)
})

test('a signed-in inogen.ai user sees the pipeline', async ({ page }) => {
  await page.addInitScript((s) => localStorage.setItem('sb-e2etest-auth-token', s), JSON.stringify(session))
  await page.route('https://e2etest.supabase.co/rest/v1/roles**', (r) => r.fulfill({ json: [row] }))
  await page.route('https://e2etest.supabase.co/auth/v1/**', (r) => r.fulfill({ json: user }))
  await page.goto('/')
  await expect(page.getByText('AI Engineer')).toBeVisible()
  await expect(page.getByLabel('Status for AI Engineer')).toHaveValue('Shortlist')
})
```

- [ ] **Step 2: Run the tests**

```bash
npx playwright install chromium
npm run e2e
```
Expected: 2 passed. If the second test shows the sign-in screen, check the key name. Run `Object.keys(localStorage)` in a normal dev session against `https://e2etest.supabase.co` and use the key supabase-js actually uses.

- [ ] **Step 3: Commit**

```bash
git add playwright.config.ts .env.e2e e2e
git commit -m "test: add Playwright smoke tests for sign-in gate and pipeline

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: CI, Pages deploy, CNAME and README

**Files:**
- Create: `.github/workflows/ci.yml`, `.github/workflows/pages.yml`, `public/CNAME`, `README.md`

- [ ] **Step 1: Write the workflows and CNAME**

`public/CNAME`:

```
jobfinder.inogen.ai
```

`.github/workflows/ci.yml`:

```yaml
name: CI
on:
  push:
  pull_request:
  workflow_call:
jobs:
  web:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test
      - run: npx playwright install --with-deps chromium
      - run: npm run e2e
  scripts:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v6
      - run: uv run --with pytest pytest scripts/tests -q
```

`.github/workflows/pages.yml`:

```yaml
name: Deploy to GitHub Pages
on:
  push:
    branches: [main]
  workflow_dispatch:
permissions:
  contents: read
  pages: write
  id-token: write
concurrency: { group: pages, cancel-in-progress: true }
jobs:
  ci:
    uses: ./.github/workflows/ci.yml
  build:
    needs: ci
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm run build
        env:
          VITE_SUPABASE_URL: ${{ vars.VITE_SUPABASE_URL }}
          VITE_SUPABASE_ANON_KEY: ${{ vars.VITE_SUPABASE_ANON_KEY }}
      - uses: actions/upload-pages-artifact@v3
        with: { path: dist }
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment: { name: github-pages, url: '${{ steps.deployment.outputs.page_url }}' }
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 2: Write `README.md`**

```markdown
# jobfinder.inogen.ai

Shared tracker for freelance roles, for InoGen accounts only. Static React app on GitHub Pages,
backed by Supabase (Postgres + Microsoft sign-in + realtime). Design: `docs/superpowers/specs/2026-10-06-jobfinder-design.md`.

## Develop

    npm install
    cp .env.example .env.local      # fill VITE_* values
    npm run dev
    npm test && npm run lint && npm run typecheck
    npm run e2e

Database (needs Docker):

    supabase start
    supabase db reset               # applies supabase/migrations
    supabase test db                # RLS tests

## Add a role from the command line

Needs `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env` (never commit it; the key bypasses RLS).

    uv run scripts/add_role.py --title "AI Engineer" --org "Acme" --market NL --fit Strong --url https://...

## Deploy

Every push to `main` runs CI and deploys to Pages. Repo variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
Schema changes: `supabase db push` against the linked project.

## Security model

- Entra app is single-tenant (inogen.ai only).
- RLS on `public.roles` admits only JWTs whose email domain is exactly `inogen.ai`.
- `seed/` and `.env` are git-ignored: exported roles contain recruiter contact details.
```

- [ ] **Step 3: Check the build works**

Run: `VITE_SUPABASE_URL=https://x.supabase.co VITE_SUPABASE_ANON_KEY=x npm run build && ls dist/CNAME`
Expected: the build succeeds and `dist/CNAME` exists.

- [ ] **Step 4: Commit**

```bash
git add .github public/CNAME README.md
git commit -m "ci: add CI and GitHub Pages deploy for jobfinder.inogen.ai

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Go live (shared setup with Mike)

Every step that creates something outside this machine needs Mike's go-ahead first. Steps marked **(Mike)** need his accounts.

- [ ] **Step 1: Create the Supabase project (Mike, or Claude with a token Mike provides)**

```bash
supabase login
supabase projects create jobfinder --region eu-central-1 --org-id <inogen org id>
supabase link --project-ref <project-ref>
supabase db push
```
Expected: the migration is applied. In the dashboard, Table Editor → `roles` should show RLS enabled.

- [ ] **Step 2: Register the Entra app (Mike, needs admin rights in the inogen.ai tenant)**

1. Go to Entra admin centre → App registrations → New registration.
2. Name it `jobfinder` and choose "Accounts in this organizational directory only".
3. Set the Web redirect URI to `https://<project-ref>.supabase.co/auth/v1/callback`.
4. Under Certificates & secrets, create a client secret.
5. Under Token configuration, add the optional claims `email` and `xms_edov` to the ID token.
6. In Supabase, go to Authentication → Providers → Azure and enable it. Enter:
   - the client id;
   - the secret;
   - Azure Tenant URL `https://login.microsoftonline.com/<tenant-id>`.
7. In Authentication → Providers → Email, **disable** the Email provider (and leave Phone off). Only Microsoft sign-ins are allowed.
8. In Authentication → URL Configuration, set Site URL to `https://jobfinder.inogen.ai`. Add `http://localhost:5173` to the redirect URLs.

- [ ] **Step 3: Create the GitHub repo and push (Claude, after Mike says yes)**

```bash
cd /Users/mike/Documents/Projects/jobfinder
gh repo create inogen-ai/jobfinder --public --source . --push
gh variable set VITE_SUPABASE_URL --body "https://<project-ref>.supabase.co" -R inogen-ai/jobfinder
gh variable set VITE_SUPABASE_ANON_KEY --body "<anon key>" -R inogen-ai/jobfinder
gh api -X POST repos/inogen-ai/jobfinder/pages -f build_type=workflow
gh workflow run pages.yml -R inogen-ai/jobfinder
```
Public is required for free GitHub Pages on an org without GitHub Team. The repo holds no secrets.

- [ ] **Step 4: DNS (Mike, GoDaddy)**

Add a record: type `CNAME`, host `jobfinder`, value `inogen-ai.github.io`. Once `dig +short jobfinder.inogen.ai` resolves, run:
`gh api -X PUT repos/inogen-ai/jobfinder/pages -f cname=jobfinder.inogen.ai -F https_enforced=true`

- [ ] **Step 5: Migrate the 35 roles (Claude)**

1. Export the artifact database with the `ArtifactData` tool: `action: "list"`, `url: https://claude.ai/artifact/UQ4LBXjMPcDc4thuNC3Vwy`, `collection: "roles"`, `query.limit: 1000`, `out_dir: /Users/mike/Documents/Projects/jobfinder/seed`.
2. Run:
```bash
uv run scripts/migrate_from_artifact.py seed/
```
Expected: `Upserted 35 roles.` Compare that with the export count. `seed/` stays git-ignored.

- [ ] **Step 6: Check it live**

- Sign in at `https://jobfinder.inogen.ai` with an inogen.ai account. Expect 35 roles, and the active ones shown by default.
- Sign in with a personal Microsoft account. Entra should refuse it. If it somehow gets through, the app should show "This tracker is limited to InoGen accounts."
- Open the site in two browsers and change a status in one. It should appear in the other within a few seconds.
- With no session, run `curl "https://<project-ref>.supabase.co/rest/v1/roles?select=id" -H "apikey: <anon key>"`. Expect `[]`.

- [ ] **Step 7: Retire the claude.ai tracker (only after Mike confirms)**

Ask Mike. Only on an explicit yes, delete `https://claude.ai/artifact/UQ4LBXjMPcDc4thuNC3Vwy` with the Artifact tool (`action: "delete"`). Update the memory file `freelance-search.md` to point to `jobfinder.inogen.ai` and `scripts/add_role.py`.
