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
