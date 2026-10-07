import { describe, it, expect } from 'vitest'
import { fakeSb } from '../test/fakeSupabase'
import { createDocumentsApi, rowToDoc, DOC_KIND_LABEL, type DocumentRow } from './documents'

const row: DocumentRow = {
  id: 'd1', user_id: 'u1', role_id: 'r1', kind: 'cover_letter', title: 'Cover letter · 7 Oct, 14:02', body: '# Hi',
  questions: '', instruction: '', model: 'claude-opus-5-5', input_tokens: 10, output_tokens: 20,
  created_at: '2026-10-07T12:02:00Z', updated_at: '2026-10-07T12:02:00Z', deleted_at: null,
}

describe('documents', () => {
  it('maps rows and labels kinds', () => {
    expect(rowToDoc(row)).toMatchObject({ id: 'd1', roleId: 'r1', kind: 'cover_letter', body: '# Hi' })
    expect(DOC_KIND_LABEL.pitch).toBe('Recruiter email')
  })
  it('list is newest first, excludes soft-deleted, scoped to the role', async () => {
    const { client, calls } = fakeSb({ data: [row], error: null })
    await createDocumentsApi(client).list('r1')
    expect(calls).toContainEqual(['eq', ['role_id', 'r1']])
    expect(calls).toContainEqual(['is', ['deleted_at', null]])
    expect(calls).toContainEqual(['order', ['created_at', { ascending: false }]])
  })
  it('create inserts a manual draft', async () => {
    const { client, calls } = fakeSb({ data: row, error: null })
    await createDocumentsApi(client).create({ roleId: 'r1', kind: 'pitch', title: 'Recruiter email · partial', body: 'x' })
    expect(calls.find(([m]) => m === 'insert')?.[1][0]).toEqual({ role_id: 'r1', kind: 'pitch', title: 'Recruiter email · partial', body: 'x', model: 'manual' })
  })
  it('remove soft-deletes', async () => {
    const { client, calls } = fakeSb({ data: null, error: null })
    await createDocumentsApi(client).remove('d1')
    expect(calls.map(([m]) => m)).not.toContain('delete')
    expect(calls.find(([m]) => m === 'update')?.[1][0]).toEqual({ deleted_at: expect.any(String) })
  })
  it('countByRole tallies live drafts per role', async () => {
    const { client } = fakeSb({ data: [{ role_id: 'r1' }, { role_id: 'r1' }, { role_id: 'r2' }], error: null })
    expect(await createDocumentsApi(client).countByRole()).toEqual({ r1: 2, r2: 1 })
  })
  it('maps errors', async () => {
    const { client } = fakeSb({ data: null, error: { code: 'PGRST116', message: '0 rows' } })
    await expect(createDocumentsApi(client).get('nope')).rejects.toMatchObject({ kind: 'missing' })
  })
})
