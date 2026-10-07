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
