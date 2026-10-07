import { createClient } from 'npm:@supabase/supabase-js@2.117.2'
import type { NewDocumentRow, Store } from './types.ts'

/** A Store that acts as the caller: their JWT goes on every request, so RLS applies. */
export function supabaseStore(url: string, anonKey: string, authorization: string): Store {
  const jwt = authorization.replace(/^Bearer\s+/i, '')
  const sb = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const countSince = async (table: string, iso: string) => {
    const { data, count, error } = await sb.from(table).select('created_at', { count: 'exact' })
      .gte('created_at', iso).order('created_at', { ascending: true }).limit(1)
    if (error) throw error
    return { count: count ?? 0, oldest: (data?.[0] as { created_at?: string } | undefined)?.created_at ?? null }
  }
  return {
    async getUser() {
      if (!jwt) return null
      const { data, error } = await sb.auth.getUser(jwt)
      if (error || !data.user) return null
      return { id: data.user.id, email: data.user.email ?? null, provider: (data.user.app_metadata?.provider as string | undefined) ?? null }
    },
    async getRole(id) {
      const { data, error } = await sb.from('roles')
        .select('title,org,location,remote,rate,ir35,duration,url,job_description')
        .eq('id', id).is('deleted_at', null).maybeSingle()
      if (error) throw error
      if (!data) return null
      const r = data as Record<string, string | null>
      return {
        title: r.title ?? '', org: r.org ?? '', location: r.location ?? '', remote: r.remote ?? '', rate: r.rate ?? '',
        ir35: r.ir35 ?? '', duration: r.duration ?? '', url: r.url ?? '', jobDescription: r.job_description ?? '',
      }
    },
    async getProfile() {
      const { data, error } = await sb.from('profiles').select('*').maybeSingle()
      if (error) throw error
      if (!data) return null
      const r = data as Record<string, string | null>
      return {
        headline: r.headline ?? '', cvText: r.cv_text ?? '', rate: r.rate ?? '', availableFrom: r.available_from,
        location: r.location ?? '', preferences: r.preferences ?? '', alwaysMention: r.always_mention ?? '', neverMention: r.never_mention ?? '',
      }
    },
    async getDocumentBody(id) {
      const { data, error } = await sb.from('documents').select('body').eq('id', id).is('deleted_at', null).maybeSingle()
      if (error) throw error
      return (data as { body: string } | null)?.body ?? null
    },
    countDocumentsSince: (iso) => countSince('documents', iso),
    async insertDocument(d: NewDocumentRow) {
      const { data, error } = await sb.from('documents').insert({
        role_id: d.roleId, kind: d.kind, title: d.title, body: d.body, questions: d.questions, instruction: d.instruction,
        model: d.model, input_tokens: d.inputTokens, output_tokens: d.outputTokens,
      }).select('id').single()
      if (error) throw error
      return (data as { id: string }).id
    },
    countFetchesSince: (iso) => countSince('fetch_log', iso),
    async insertFetch(roleId) {
      const { error } = await sb.from('fetch_log').insert({ role_id: roleId })
      if (error) throw error
    },
  }
}
