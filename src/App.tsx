import { supabase } from './lib/supabase'
import { useSession } from './hooks/useSession'
import { SignIn } from './components/SignIn'

export default function App() {
  const { status, session, signIn, signOut } = useSession(supabase.auth)
  if (status === 'loading') return <main className="wrap"><p className="notice">Loading…</p></main>
  if (status !== 'signedIn' || !session) return <SignIn refused={status === 'refused'} onSignIn={signIn} />
  return <main className="wrap"><p>Signed in as {session.user.email}</p><button className="btn" onClick={signOut}>Sign out</button></main>
}
