import { describe, it, expect } from 'vitest'
import { fakeSb } from '../test/fakeSupabase'
import { createProfileApi, isProfileReady, EMPTY_PROFILE, rowToProfile, profileToRow, type ProfileRow } from './profile'

const row: ProfileRow = {
  user_id: 'u1', headline: 'AI engineer', cv_text: 'CV text', rate: '€100/h', available_from: '2026-11-01',
  location: 'Voorschoten', preferences: 'Remote', always_mention: 'GCP', never_mention: 'IKEA reorg',
  updated_at: '2026-10-07T10:00:00Z',
}

describe('profile', () => {
  it('maps rows', () => {
    const p = rowToProfile(row)
    expect(p.cvText).toBe('CV text')
    expect(p.availableFrom).toBe('2026-11-01')
    expect(profileToRow({ ...p, availableFrom: '' }, 'u1')).toMatchObject({ user_id: 'u1', cv_text: 'CV text', available_from: null })
  })
  it('is ready only with CV text', () => {
    expect(isProfileReady(null)).toBe(false)
    expect(isProfileReady({ ...EMPTY_PROFILE, cvText: '  ' })).toBe(false)
    expect(isProfileReady({ ...EMPTY_PROFILE, cvText: 'x' })).toBe(true)
  })
  it('get returns null when there is no row', async () => {
    const { client } = fakeSb({ data: null, error: null })
    expect(await createProfileApi(client).get()).toBeNull()
  })
  it('save upserts on user_id for the signed-in user', async () => {
    const { client, calls } = fakeSb({ data: row, error: null }, { userId: 'u1' })
    await createProfileApi(client).save(rowToProfile(row))
    const upsert = calls.find(([m]) => m === 'upsert')
    expect(upsert?.[1][0]).toMatchObject({ user_id: 'u1', cv_text: 'CV text' })
    expect(upsert?.[1][1]).toEqual({ onConflict: 'user_id' })
  })
  it('save without a session is an auth error', async () => {
    const { client } = fakeSb({ data: row, error: null })
    await expect(createProfileApi(client).save(EMPTY_PROFILE)).rejects.toMatchObject({ kind: 'auth' })
  })
})
