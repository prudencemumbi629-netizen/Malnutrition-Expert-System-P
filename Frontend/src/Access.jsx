import { useEffect, useState } from 'react'
import { supabase, supabaseConfigurationError } from './supabase.js'

function EmailSignIn() {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [error, setError] = useState('')

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setFeedback('')
    setError('')
    try {
      const { error: failure } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { shouldCreateUser: false, emailRedirectTo: window.location.origin },
      })
      if (failure) throw failure
      setFeedback('Check your email for your sign-in link.')
    } catch {
      setError('Could not send a sign-in link. Check that you are using your invited email address and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="sheet form-body access-form" onSubmit={submit}>
      <div className="field">
        <label htmlFor="access-email">Invited email address</label>
        <input id="access-email" type="email" autoComplete="email" required disabled={busy}
          value={email} onChange={event => setEmail(event.target.value)} />
      </div>
      <button className="button-primary" type="submit" disabled={busy}>
        {busy ? 'Sending link…' : 'Send sign-in link'}
      </button>
      {feedback && <p role="status">{feedback}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </form>
  )
}

export default function Access({ children }) {
  const [session, setSession] = useState(undefined)
  const [signOutError, setSignOutError] = useState('')

  useEffect(() => {
    if (!supabase) return
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, current) => {
      setSession(current)
    })
    return () => subscription.unsubscribe()
  }, [])

  async function signOut() {
    setSignOutError('')
    const { error } = await supabase.auth.signOut({ scope: 'local' })
    if (error) setSignOutError('Unable to sign out. Try again.')
  }

  if (session) return children(session, signOut, signOutError)
  return (
    <main className="workspace access-page">
      <div className="intro">
        <h1>Project FYM research workspace</h1>
        <p>Sign in with the email address you were invited with. We’ll send you a link.</p>
      </div>
      {supabaseConfigurationError
        ? <p className="error" role="alert">{supabaseConfigurationError}</p>
        : session === undefined ? <p role="status">Checking your sign-in…</p> : <EmailSignIn />}
    </main>
  )
}
