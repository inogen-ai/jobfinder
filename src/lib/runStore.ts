import type { DocKind } from './documents'
import { GenerateError, type GenerateClient, type GenerateParams, type GenerateResult } from './generate'

export interface RunState {
  kind: DocKind
  text: string
  busy: boolean
  outcome: 'running' | 'done' | 'failed'
  result: GenerateResult | null
  error: GenerateError | null
}

/**
 * Generations in progress, kept above the screens so a draft keeps streaming when its role is collapsed
 * or the user opens their profile. One run per role. State objects are replaced, never mutated, so
 * `get` is safe for useSyncExternalStore.
 */
export class RunStore {
  private readonly client: GenerateClient
  private readonly states = new Map<string, RunState>()
  private readonly controllers = new Map<string, AbortController>()
  private readonly listeners = new Set<() => void>()
  private readonly doneListeners = new Set<(roleId: string) => void>()

  constructor(client: GenerateClient) {
    this.client = client
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }

  /** Called when a run saves a draft, whether or not any panel is showing it. */
  onDone = (fn: (roleId: string) => void): (() => void) => {
    this.doneListeners.add(fn)
    return () => { this.doneListeners.delete(fn) }
  }

  get = (roleId: string): RunState | null => this.states.get(roleId) ?? null

  private patch(roleId: string, next: Partial<RunState>) {
    const current = this.states.get(roleId)
    if (!current) return
    this.states.set(roleId, { ...current, ...next })
    this.listeners.forEach((fn) => fn())
  }

  async start(roleId: string, params: Omit<GenerateParams, 'roleId'>): Promise<GenerateResult> {
    this.controllers.get(roleId)?.abort()
    const controller = new AbortController()
    this.controllers.set(roleId, controller)
    this.states.set(roleId, { kind: params.kind, text: '', busy: true, outcome: 'running', result: null, error: null })
    this.listeners.forEach((fn) => fn())
    try {
      const result = await this.client.generate({ roleId, ...params }, {
        signal: controller.signal,
        onDelta: (t) => this.patch(roleId, { text: (this.states.get(roleId)?.text ?? '') + t }),
        onReset: () => this.patch(roleId, { text: '' }),
      })
      this.patch(roleId, { busy: false, outcome: 'done', result })
      this.doneListeners.forEach((fn) => fn(roleId))
      return result
    } catch (e) {
      const error = e instanceof GenerateError ? e : new GenerateError('upstream')
      this.patch(roleId, { busy: false, outcome: 'failed', error })
      throw error
    } finally {
      if (this.controllers.get(roleId) === controller) this.controllers.delete(roleId)
    }
  }

  stop(roleId: string): void {
    this.controllers.get(roleId)?.abort()
  }

  stopAll(): void {
    for (const c of this.controllers.values()) c.abort()
  }

  clear(roleId: string): void {
    if (this.states.delete(roleId)) this.listeners.forEach((fn) => fn())
  }
}
