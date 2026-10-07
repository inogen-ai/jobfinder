import type { SupabaseClient } from '@supabase/supabase-js'
import { RoleError, toRoleError } from './roles'

export interface Profile {
  headline: string
  cvText: string
  rate: string
  availableFrom: string | null
  location: string
  preferences: string
  alwaysMention: string
  neverMention: string
}

export interface ProfileRow {
  user_id: string; headline: string; cv_text: string; rate: string; available_from: string | null
  location: string; preferences: string; always_mention: string; never_mention: string; updated_at: string
}

export const EMPTY_PROFILE: Profile = {
  headline: '', cvText: '', rate: '', availableFrom: null, location: '', preferences: '', alwaysMention: '', neverMention: '',
}

export const isProfileReady = (p: Profile | null): boolean => !!p && p.cvText.trim().length > 0

export function rowToProfile(r: ProfileRow): Profile {
  return {
    headline: r.headline, cvText: r.cv_text, rate: r.rate, availableFrom: r.available_from, location: r.location,
    preferences: r.preferences, alwaysMention: r.always_mention, neverMention: r.never_mention,
  }
}

export function profileToRow(p: Profile, userId: string): Omit<ProfileRow, 'updated_at'> {
  return {
    user_id: userId, headline: p.headline, cv_text: p.cvText, rate: p.rate, available_from: p.availableFrom || null,
    location: p.location, preferences: p.preferences, always_mention: p.alwaysMention, never_mention: p.neverMention,
  }
}

export interface ProfileApi {
  get(): Promise<Profile | null>
  save(p: Profile): Promise<Profile>
}

export function createProfileApi(sb: SupabaseClient): ProfileApi {
  return {
    async get() {
      const { data, error } = await sb.from('profiles').select('*').maybeSingle()
      if (error) throw toRoleError(error)
      return data ? rowToProfile(data as ProfileRow) : null
    },
    async save(p) {
      const { data: s } = await sb.auth.getSession()
      const userId = s.session?.user.id
      if (!userId) throw new RoleError('no session', 'auth')
      const { data, error } = await sb.from('profiles').upsert(profileToRow(p, userId), { onConflict: 'user_id' }).select().single()
      if (error) throw toRoleError(error)
      return rowToProfile(data as ProfileRow)
    },
  }
}
