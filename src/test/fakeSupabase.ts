import type { SupabaseClient } from '@supabase/supabase-js'

/** Chainable fake of supabase.from(...): every method returns the builder; awaiting it yields `result`. */
export function fakeSb(result: { data: unknown; error: unknown }, opts: { userId?: string } = {}) {
  const calls: Array<[string, unknown[]]> = []
  const builder: unknown = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'then') return (resolve: (v: unknown) => void) => resolve(result)
      return (...args: unknown[]) => { calls.push([String(prop), args]); return builder }
    },
  })
  const auth = {
    getSession: async () => ({ data: { session: opts.userId ? { user: { id: opts.userId } } : null } }),
  }
  const client = {
    from: (t: string) => { calls.push(['from', [t]]); return builder },
    rpc: (fn: string, args?: unknown) => { calls.push(['rpc', [fn, args]]); return builder },
    auth,
  } as unknown as SupabaseClient
  return { client, calls }
}
