import { describe, it, expect, vi } from 'vitest'
import { RunStore } from './runStore'
import { GenerateError, type GenerateClient, type GenerateHandlers } from './generate'

function client(generate: GenerateClient['generate']): GenerateClient {
  return { generate, fetchPosting: vi.fn() }
}

describe('RunStore', () => {
  it('tracks a run independently of any component and notifies subscribers', async () => {
    let h!: GenerateHandlers
    let finish!: () => void
    const store = new RunStore(client((_p, handlers) => new Promise((resolve) => {
      h = handlers
      finish = () => resolve({ documentId: 'd1', model: 'm', truncated: false, jdTruncated: false })
    })))
    const seen = vi.fn()
    const finished = vi.fn()
    store.subscribe(seen)
    store.onDone(finished)
    const done = store.start('r1', { kind: 'cv' })
    h.onDelta('Hello ')
    h.onDelta('world')
    expect(store.get('r1')).toMatchObject({ kind: 'cv', text: 'Hello world', busy: true, outcome: 'running' })
    h.onReset()
    expect(store.get('r1')?.text).toBe('')
    finish()
    await expect(done).resolves.toMatchObject({ documentId: 'd1' })
    expect(store.get('r1')).toMatchObject({ busy: false, outcome: 'done', result: { documentId: 'd1' } })
    expect(seen).toHaveBeenCalled()
    expect(finished).toHaveBeenCalledWith('r1')
  })
  it('stop aborts the run and keeps the partial text as failed', async () => {
    const store = new RunStore(client((_p, h) => new Promise((_, reject) => {
      h.onDelta('partial')
      h.signal?.addEventListener('abort', () => reject(new GenerateError('stopped')))
    })))
    const run = store.start('r1', { kind: 'pitch' }).catch((e) => e)
    store.stop('r1')
    expect((await run).code).toBe('stopped')
    expect(store.get('r1')).toMatchObject({ busy: false, outcome: 'failed', text: 'partial', error: { code: 'stopped' } })
  })
  it('a superseded run cannot touch the newer run for the same role', async () => {
    const handlers: GenerateHandlers[] = []
    const rejecters: Array<() => void> = []
    const store = new RunStore(client((_p, h) => new Promise((_, reject) => {
      handlers.push(h)
      rejecters.push(() => reject(new GenerateError('stopped')))
    })))
    const first = store.start('r1', { kind: 'cv' }).catch(() => {})
    const second = store.start('r1', { kind: 'pitch' }).catch(() => {})
    handlers[0].onDelta('old text')
    rejecters[0]()
    await first
    expect(store.get('r1')).toMatchObject({ kind: 'pitch', busy: true, outcome: 'running', text: '' })
    handlers[1].onDelta('new')
    expect(store.get('r1')?.text).toBe('new')
    rejecters[1]()
    await second
  })
  it('clearAll forgets every run (sign-out)', async () => {
    const store = new RunStore(client(async () => { throw new GenerateError('upstream') }))
    await store.start('a', { kind: 'cv' }).catch(() => {})
    await store.start('b', { kind: 'cv' }).catch(() => {})
    store.clearAll()
    expect(store.get('a')).toBeNull()
    expect(store.get('b')).toBeNull()
  })
  it('clear forgets a run; stopAll aborts every run', async () => {
    const aborted: string[] = []
    const store = new RunStore(client((p, h) => new Promise((_, reject) => {
      h.signal?.addEventListener('abort', () => { aborted.push(p.roleId); reject(new GenerateError('stopped')) })
    })))
    const a = store.start('a', { kind: 'cv' }).catch(() => {})
    const b = store.start('b', { kind: 'cv' }).catch(() => {})
    store.stopAll()
    await Promise.all([a, b])
    expect(aborted.sort()).toEqual(['a', 'b'])
    store.clear('a')
    expect(store.get('a')).toBeNull()
    expect(store.get('b')).not.toBeNull()
  })
})
