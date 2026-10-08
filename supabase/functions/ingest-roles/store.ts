import { createClient } from 'npm:@supabase/supabase-js@2.117.2'
import type { AdminStore, RoleRecord } from './handler.ts'

/** Server-side store using the project's service key (never leaves the function). */
export function adminStore(url: string, serviceKey: string): AdminStore {
  const sb = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  return {
    async listRoles() {
      const { data, error } = await sb.from('roles')
        .select('id,title,org,market,url,status,deadline,notes,next_step').is('deleted_at', null).limit(5000)
      if (error) throw error
      return data as RoleRecord[]
    },
    async insertRoles(rows) {
      const { error } = await sb.from('roles').insert(rows)
      if (error) throw error
    },
    async closeRole(id, notes) {
      const { error } = await sb.from('roles').update({ status: 'Closed', notes }).eq('id', id).eq('status', 'Shortlist').eq('notes', '').eq('next_step', '')
      if (error) throw error
    },
  }
}
