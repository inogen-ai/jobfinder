export function SignIn({ refused, onSignIn }: { refused: boolean; onSignIn: () => void }) {
  return (
    <main className="wrap signin">
      <h1>Contract Pipeline</h1>
      <p className="sub">Freelance roles tracked by the InoGen team. Sign in with your InoGen Microsoft account.</p>
      {refused && <p className="banner" role="alert">This tracker is limited to InoGen accounts.</p>}
      <button className="btn primary" onClick={onSignIn}>Sign in with Microsoft</button>
    </main>
  )
}
