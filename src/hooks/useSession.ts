import { useCallback, useEffect, useState } from 'react'
import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { isAllowedEmail } from '../lib/auth'

export type SessionStatus = 'loading' | 'signedOut' | 'refused' | 'signedIn'

export function useSession(auth: SupabaseClient['auth']) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [refused, setRefused] = useState(false)

  useEffect(() => {
    let active = true
    const handle = (s: Session | null) => {
      if (!active) return
      if (s && !isAllowedEmail(s.user.email)) {
        setRefused(true)
        setSession(null)
        void auth.signOut()
      } else {
        setSession(s)
      }
      setLoading(false)
    }
    void auth.getSession().then(({ data }) => handle(data.session))
    const { data } = auth.onAuthStateChange((_event, s) => handle(s))
    return () => {
      active = false
      data.subscription.unsubscribe()
    }
  }, [auth])

  const signIn = useCallback(async () => {
    setRefused(false)
    await auth.signInWithOAuth({ provider: 'azure', options: { scopes: 'email', redirectTo: window.location.origin } })
  }, [auth])

  const signOut = useCallback(async () => {
    await auth.signOut()
  }, [auth])

  const status: SessionStatus = loading ? 'loading' : session ? 'signedIn' : refused ? 'refused' : 'signedOut'
  return { status, session, signIn, signOut }
}
