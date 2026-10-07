import type { SupabaseClient } from '@supabase/supabase-js'
import { toRoleError } from './roles'

export const DOC_KINDS = ['cover_letter', 'pitch', 'cv', 'answers'] as const
export type DocKind = (typeof DOC_KINDS)[number]
export const DOC_KIND_LABEL: Record<DocKind, string> = {
  cover_letter: 'Cover letter', pitch: 'Recruiter email', cv: 'Tailored CV', answers: 'Application answers',
}

export interface Doc {
  id: string; roleId: string; kind: DocKind; title: string; body: string; questions: string
  instruction: string; model: string; createdAt: string; updatedAt: string
}

export interface DocumentRow {
  id: string; user_id: string; role_id: string; kind: string; title: string; body: string; questions: string
  instruction: string; model: string; input_tokens: number; output_tokens: number
  created_at: string; updated_at: string; deleted_at: string | null
}

export interface NewDoc { roleId: string; kind: DocKind; title: string; body: string }

export function rowToDoc(r: DocumentRow): Doc {
  return {
    id: r.id, roleId: r.role_id, kind: r.kind as DocKind, title: r.title, body: r.body, questions: r.questions,
    instruction: r.instruction, model: r.model, createdAt: r.created_at, updatedAt: r.updated_at,
  }
}

export interface DocumentsApi {
  list(roleId: string): Promise<Doc[]>
  get(id: string): Promise<Doc>
  create(d: NewDoc): Promise<Doc>
  update(id: string, patch: { body?: string; title?: string }): Promise<Doc>
  remove(id: string): Promise<void>
  countByRole(): Promise<Record<string, number>>
}

export function createDocumentsApi(sb: SupabaseClient): DocumentsApi {
  const one = async (q: PromiseLike<{ data: unknown; error: unknown }>) => {
    const { data, error } = await q
    if (error) throw toRoleError(error)
    return rowToDoc(data as DocumentRow)
  }
  return {
    async list(roleId) {
      const { data, error } = await sb.from('documents').select('*').eq('role_id', roleId).is('deleted_at', null)
        .order('created_at', { ascending: false })
      if (error) throw toRoleError(error)
      return (data as DocumentRow[]).map(rowToDoc)
    },
    get: (id) => one(sb.from('documents').select('*').eq('id', id).is('deleted_at', null).single()),
    create: (d) => one(sb.from('documents')
      .insert({ role_id: d.roleId, kind: d.kind, title: d.title, body: d.body, model: 'manual' }).select().single()),
    update: (id, patch) => one(sb.from('documents').update(patch).eq('id', id).select().single()),
    async remove(id) {
      const { error } = await sb.from('documents').update({ deleted_at: new Date().toISOString() }).eq('id', id)
      if (error) throw toRoleError(error)
    },
    async countByRole() {
      const { data, error } = await sb.from('documents').select('role_id').is('deleted_at', null)
      if (error) throw toRoleError(error)
      const out: Record<string, number> = {}
      for (const r of data as Array<{ role_id: string }>) out[r.role_id] = (out[r.role_id] ?? 0) + 1
      return out
    },
  }
}
