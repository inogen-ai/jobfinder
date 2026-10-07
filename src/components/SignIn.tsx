export function SignIn({ refused, message, onSignIn }: { refused: boolean; message?: string; onSignIn: () => void }) {
  return (
    <main className="wrap signin">
      <h1>Contract Pipeline</h1>
      <p className="sub">Freelance roles tracked by the InoGen team. Sign in with your InoGen Microsoft account.</p>
      {refused && <p className="banner" role="alert">This tracker is limited to InoGen accounts.</p>}
      {!refused && message && <p className="banner" role="alert">{message}</p>}
      <button className="btn primary" onClick={onSignIn}>Sign in with Microsoft</button>
    </main>
  )
}
