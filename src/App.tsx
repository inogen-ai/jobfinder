import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from './lib/supabase'
import { createRolesApi } from './lib/roles'
import { createProfileApi, isProfileReady } from './lib/profile'
import { createDocumentsApi } from './lib/documents'
import { createGenerateClient } from './lib/generate'
import { RunStore } from './lib/runStore'
import { useSession } from './hooks/useSession'
import { SignIn } from './components/SignIn'
import { Pipeline } from './components/Pipeline'
import { ProfilePage } from './components/ProfilePage'

const api = createRolesApi(supabase)
const profileApi = createProfileApi(supabase)
const docsApi = createDocumentsApi(supabase)
const genClient = createGenerateClient({
  functionsUrl: `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`,
  anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
  getToken: async () => (await supabase.auth.getSession()).data.session?.access_token ?? '',
})
// Lives outside the component tree, so drafts keep generating across role collapse and the profile page.
const runs = new RunStore(genClient)

export default function App() {
  const { status, session, signIn, signOut } = useSession(supabase.auth)
  const [view, setView] = useState<'pipeline' | 'profile'>('pipeline')
  const [profileReady, setProfileReady] = useState(false)
  const [signedOutMessage, setSignedOutMessage] = useState('')

  const leave = useCallback(async () => { runs.stopAll(); setSignedOutMessage(''); await signOut() }, [signOut])
  const expire = useCallback(async () => {
    runs.stopAll()
    setSignedOutMessage('Your session has ended. Sign in again.')
    await signOut()
  }, [signOut])

  useEffect(() => {
    if (status !== 'signedIn') return
    profileApi.get().then((p) => setProfileReady(isProfileReady(p))).catch(() => setProfileReady(false))
  }, [status])

  const docs = useMemo(() => ({ api: docsApi, client: genClient, runs, profileReady, onOpenProfile: () => setView('profile'), onAuthError: expire }), [profileReady, expire])

  if (status === 'loading') return <main className="wrap"><p className="notice">Loading…</p></main>
  if (status !== 'signedIn' || !session) return <SignIn refused={status === 'refused'} message={signedOutMessage} onSignIn={signIn} />
  if (view === 'profile') {
    return <ProfilePage api={profileApi} onBack={() => setView('pipeline')} onSaved={(p) => setProfileReady(isProfileReady(p))} />
  }
  return <Pipeline api={api} docs={docs} userEmail={session.user.email ?? ''} onSignOut={leave} onAuthError={expire} />
}
