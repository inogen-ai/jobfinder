import { supabase } from './lib/supabase'
import { createRolesApi } from './lib/roles'
import { useSession } from './hooks/useSession'
import { SignIn } from './components/SignIn'
import { Pipeline } from './components/Pipeline'

const api = createRolesApi(supabase)

export default function App() {
  const { status, session, signIn, signOut } = useSession(supabase.auth)
  if (status === 'loading') return <main className="wrap"><p className="notice">Loading…</p></main>
  if (status !== 'signedIn' || !session) return <SignIn refused={status === 'refused'} onSignIn={signIn} />
  return <Pipeline api={api} userEmail={session.user.email ?? ''} onSignOut={signOut} onAuthError={signOut} />
}
