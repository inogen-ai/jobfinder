import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DocumentsPanel, type DocsContext } from './DocumentsPanel'
import { makeRole } from '../test/factories'
import { GenerateError, type GenerateClient, type GenerateHandlers } from '../lib/generate'
import type { Doc, DocumentsApi } from '../lib/documents'

const doc = (over: Partial<Doc>): Doc => ({
  id: 'd1', roleId: 'r1', kind: 'cover_letter', title: 'Cover letter · 7 Oct, 14:02', body: 'Saved body', questions: '',
  instruction: '', model: 'claude-opus-5-5', createdAt: '2026-10-07T12:02:00Z', updatedAt: '2026-10-07T12:02:00Z', ...over,
})

function fakeDocs(initial: Doc[]): DocumentsApi & { store: Doc[] } {
  const store = [...initial]
  return {
    store,
    list: vi.fn(async () => [...store]),
    get: vi.fn(async (id) => store.find((d) => d.id === id)!),
    create: vi.fn(async (d) => { const n = doc({ id: `m${store.length}`, ...d }); store.unshift(n); return n }),
    update: vi.fn(async (id, patch) => { const i = store.findIndex((d) => d.id === id); store[i] = { ...store[i], ...patch }; return store[i] }),
    remove: vi.fn(async () => {}),
    countByRole: vi.fn(async () => ({})),
  }
}

function ctx(api: DocumentsApi, generate: GenerateClient['generate']): DocsContext {
  return { api, client: { generate, fetchPosting: vi.fn() }, profileReady: true, onOpenProfile: () => {} }
}

const props = { role: makeRole({ id: 'r1' }), onSaveJobDescription: vi.fn(async () => null), onCountChange: vi.fn() }

describe('DocumentsPanel', () => {
  it('lists drafts newest first and opens the newest', async () => {
    const api = fakeDocs([doc({ id: 'd2', title: 'Newer', body: 'New' }), doc({ id: 'd1', title: 'Older' })])
    render(<DocumentsPanel {...props} ctx={ctx(api, vi.fn())} />)
    const items = await screen.findAllByRole('button', { name: /Newer|Older/ })
    expect(items.map((b) => b.textContent)).toEqual(['Newer', 'Older'])
    expect(screen.getByLabelText('Draft')).toHaveValue('New')
  })
  it('streams a new draft, then shows the saved one and updates the count', async () => {
    const api = fakeDocs([])
    api.store.push(doc({ id: 'new', title: 'Recruiter email · now', body: 'Hi there', kind: 'pitch' }))
    const generate = vi.fn(async (_p: unknown, h: GenerateHandlers) => { h.onDelta('Hi '); h.onDelta('there'); return { documentId: 'new', model: 'm', truncated: false, jdTruncated: false } })
    api.list = vi.fn(async () => [])
    render(<DocumentsPanel {...props} ctx={ctx(api, generate)} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Recruiter email' }))
    await waitFor(() => expect(screen.getByLabelText('Draft')).toHaveValue('Hi there'))
    expect(screen.getByRole('button', { name: 'Recruiter email · now' })).toBeInTheDocument()
    expect(props.onCountChange).toHaveBeenCalledWith('r1', 1)
  })
  it('clears streamed text on reset', async () => {
    let handlers!: GenerateHandlers
    let finish!: () => void
    const generate = vi.fn((_p: unknown, h: GenerateHandlers) => { handlers = h; return new Promise<never>((_, reject) => { finish = () => reject(new GenerateError('refused')) }) })
    render(<DocumentsPanel {...props} ctx={ctx(fakeDocs([]), generate)} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Cover letter' }))
    act(() => { handlers.onDelta('declined text') })
    act(() => { handlers.onReset(); handlers.onDelta('fresh') })
    expect(screen.getByLabelText('Draft')).toHaveValue('fresh')
    await act(async () => finish())
  })
  it('Stop keeps the partial text and offers to save it', async () => {
    const api = fakeDocs([])
    const generate = vi.fn((_p: unknown, h: GenerateHandlers) => new Promise<never>((_, reject) => {
      h.onDelta('partial text')
      h.signal?.addEventListener('abort', () => reject(new GenerateError('stopped')))
    }))
    render(<DocumentsPanel {...props} ctx={ctx(api, generate)} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Tailored CV' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Stop' }))
    expect(await screen.findByText('Generation stopped early.')).toBeInTheDocument()
    expect(screen.getByLabelText('Draft')).toHaveValue('partial text')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(api.create).toHaveBeenCalledWith({ roleId: 'r1', kind: 'cv', title: 'Tailored CV · partial', body: 'partial text' })
  })
  it('an expired session signs out', async () => {
    const onAuthError = vi.fn()
    const generate = vi.fn(async () => { throw new GenerateError('unauthorized') })
    render(<DocumentsPanel {...props} ctx={{ ...ctx(fakeDocs([]), generate), onAuthError }} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Cover letter' }))
    await waitFor(() => expect(onAuthError).toHaveBeenCalled())
  })
  it('a failed generation says nothing was saved', async () => {
    const generate = vi.fn(async () => { throw new GenerateError('upstream') })
    render(<DocumentsPanel {...props} ctx={ctx(fakeDocs([]), generate)} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Cover letter' }))
    expect(await screen.findByText("Couldn't generate this draft. Nothing was saved.")).toBeInTheDocument()
    expect(screen.queryByLabelText('Draft')).not.toBeInTheDocument()
  })
  it('regenerate saves unsaved edits first', async () => {
    const api = fakeDocs([doc({ id: 'd1', body: 'Original' })])
    const generate = vi.fn(async () => { throw new GenerateError('upstream') })
    render(<DocumentsPanel {...props} ctx={ctx(api, generate)} />)
    const draft = await screen.findByLabelText('Draft')
    await userEvent.type(draft, ' plus my edit')
    await userEvent.type(screen.getByLabelText('Regenerate instruction'), 'shorter')
    await userEvent.click(screen.getByRole('button', { name: 'Regenerate' }))
    expect(api.update).toHaveBeenCalledWith('d1', { body: 'Original plus my edit' })
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ kind: 'cover_letter', instruction: 'shorter', previousDocumentId: 'd1' }), expect.anything())
    const updateOrder = vi.mocked(api.update).mock.invocationCallOrder[0]
    expect(updateOrder).toBeLessThan(generate.mock.invocationCallOrder[0])
  })
})
